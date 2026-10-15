<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SystemSetting;
use App\Models\TryOnSession;
use App\Services\StylePhotoAnalyzer;
use App\Services\StylistLookbookService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\Rule;

/**
 * AI STYLIST — the visible, photo-first stylist in the Studio.
 *
 *   1. analyze-photo   Gemini DESCRIBES the photo (undertone, what is worn, where
 *                      the torso/legs/feet are). Async: 202 + polling, per the
 *                      project rule for AI calls.
 *   2. profile         The customer CONFIRMS the undertone and picks an occasion
 *                      and a collection (womenswear / menswear / both).
 *   3. lookbook        RULES choose up to three complete looks from the catalog,
 *                      each piece with the reasons that chose it.
 *   4. verdict         After the render, the same rules check fit, color and
 *                      occasion, and suggest what completes the look.
 *
 * Every route is customer-scoped (auth:sanctum); nothing here is staff-only.
 */
class StylistController extends Controller
{
    public function __construct(
        private StylePhotoAnalyzer $analyzer,
        private StylistLookbookService $lookbook,
    ) {
    }

    /** GET /api/stylist/profile */
    public function profile(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'gender' => $user->gender,
            'upper_body_size' => $user->upper_body_size,
            'lower_body_size' => $user->lower_body_size,
            'preferred_fit' => $user->preferred_fit,
            'style_preference' => $user->style_preference,
            'effective_preference' => StylistLookbookService::preferenceFor($user),
            'style_profile' => $user->style_profile,
            'occasions' => collect((array) config('stylist.occasions', []))
                ->map(fn ($o, $key) => ['key' => $key, 'label' => $o['label'] ?? $key])
                ->values(),
        ]);
    }

    /** PUT /api/stylist/profile — save what the customer confirmed. */
    public function updateProfile(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'undertone' => ['nullable', Rule::in(StylePhotoAnalyzer::UNDERTONES)],
            'preference' => ['nullable', Rule::in(StylistLookbookService::PREFERENCES)],
            'occasion' => ['nullable', Rule::in(array_keys((array) config('stylist.occasions', [])))],
        ]);

        $user = $request->user();
        $profile = (array) ($user->style_profile ?? []);

        if (array_key_exists('undertone', $validated)) {
            $profile['undertone'] = $validated['undertone'];
            $profile['confirmed_at'] = now()->toIso8601String();
        }
        if (! empty($validated['occasion'])) {
            $profile['last_occasion'] = $validated['occasion'];
        }

        $user->forceFill([
            'style_profile' => $profile,
            'style_preference' => $validated['preference'] ?? $user->style_preference,
        ])->save();

        return response()->json([
            'style_preference' => $user->style_preference,
            'effective_preference' => StylistLookbookService::preferenceFor($user),
            'style_profile' => $user->style_profile,
        ]);
    }

    /**
     * POST /api/stylist/analyze-photo — start (or reuse) the photo description.
     *
     * Answers 202 at once; the Gemini call runs after the response is sent and
     * the client polls GET /analyze-photo/{hash}. A photo already described for
     * this customer is answered from cache (no second model call).
     */
    public function analyzePhoto(Request $request): JsonResponse
    {
        if (! SystemSetting::isOn('ai_engine_active')) {
            return response()->json(['message' => 'The AI stylist is paused right now. Please try again later.'], 503);
        }

        $validated = $request->validate([
            'image' => ['required', 'string', 'max:' . (7 * 1024 * 1024)],
        ]);
        $image = $validated['image'];

        if (! preg_match('/^data:image\/(png|jpe?g|webp);base64,/', $image)) {
            return response()->json(['message' => 'Upload a JPG, PNG or WebP photo.'], 422);
        }

        $hash = hash('sha256', $image);
        $key = $this->analysisKey($request->user()->id, $hash);
        $entry = Cache::get($key);

        if (is_array($entry) && in_array($entry['status'] ?? null, ['done', 'failed'], true)) {
            return response()->json(['hash' => $hash] + $entry);
        }

        if (is_array($entry) && ($entry['status'] ?? null) === 'processing'
            && now()->timestamp - (int) ($entry['started_at'] ?? 0) < 90) {
            return response()->json(['hash' => $hash, 'status' => 'processing'], 202);
        }

        $ttl = now()->addMinutes((int) config('stylist.analysis_ttl_minutes', 120));
        Cache::put($key, ['status' => 'processing', 'started_at' => now()->timestamp], $ttl);

        $analyzer = $this->analyzer;
        dispatch(function () use ($analyzer, $image, $key, $ttl) {
            $result = $analyzer->analyse($image);
            Cache::put($key, $result ? ['status' => 'done', 'result' => $result] : ['status' => 'failed'], $ttl);
        })->afterResponse();

        return response()->json(['hash' => $hash, 'status' => 'processing'], 202);
    }

    /** GET /api/stylist/analyze-photo/{hash} — poll the description. */
    public function analysisStatus(Request $request, string $hash): JsonResponse
    {
        if (! preg_match('/^[a-f0-9]{64}$/', $hash)) {
            return response()->json(['status' => 'missing'], 404);
        }

        $entry = Cache::get($this->analysisKey($request->user()->id, $hash));

        if (! is_array($entry)) {
            return response()->json(['hash' => $hash, 'status' => 'missing'], 404);
        }

        // A processing marker older than 90 s means the worker died: report failure.
        if (($entry['status'] ?? null) === 'processing' && now()->timestamp - (int) ($entry['started_at'] ?? 0) > 90) {
            return response()->json(['hash' => $hash, 'status' => 'failed']);
        }

        return response()->json(['hash' => $hash] + $entry, ($entry['status'] ?? null) === 'processing' ? 202 : 200);
    }

    /** POST /api/stylist/lookbook — the rules choose the looks. */
    public function lookbook(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'occasion' => ['required', Rule::in(array_keys((array) config('stylist.occasions', [])))],
            'preference' => ['nullable', Rule::in(StylistLookbookService::PREFERENCES)],
            'undertone' => ['nullable', Rule::in(StylePhotoAnalyzer::UNDERTONES)],
        ]);

        return response()->json($this->lookbook->build(
            $request->user(),
            $validated['occasion'],
            $validated['preference'] ?? null,
            $validated['undertone'] ?? null,
        ));
    }

    /** POST /api/stylist/verdict — check a finished render (owner-scoped). */
    public function verdict(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'session_id' => ['required', 'string', 'max:80'],
            'occasion' => ['nullable', Rule::in(array_keys((array) config('stylist.occasions', [])))],
            'undertone' => ['nullable', Rule::in(StylePhotoAnalyzer::UNDERTONES)],
            'pieces' => ['required', 'array', 'min:1', 'max:4'],
            'pieces.*.id' => ['required', 'integer'],
            'pieces.*.color' => ['nullable', 'string', 'max:50'],
            'pieces.*.size' => ['nullable', 'string', 'max:10'],
        ]);

        $user = $request->user();
        $session = TryOnSession::where('session_id', $validated['session_id'])
            ->where('user_id', $user->id)
            ->where('status', TryOnSession::STATUS_COMPLETED)
            ->first();

        if (! $session) {
            return response()->json(['message' => 'That fitting was not found.'], 404);
        }

        // Only pieces that were actually part of this render may be judged.
        $rendered = collect((array) ($session->garment_metadata_json ?? []))
            ->pluck('product_id')->filter()->map(fn ($id) => (int) $id)->all();
        $pieces = array_values(array_filter(
            $validated['pieces'],
            fn ($p) => $rendered === [] || in_array((int) $p['id'], $rendered, true)
        ));

        if ($pieces === []) {
            return response()->json(['message' => 'Those pieces were not part of this fitting.'], 422);
        }

        $profile = (array) ($user->style_profile ?? []);

        return response()->json($this->lookbook->verdict(
            $user,
            $pieces,
            $validated['occasion'] ?? ($profile['last_occasion'] ?? 'everyday'),
            $validated['undertone'] ?? ($profile['undertone'] ?? null),
        ));
    }

    private function analysisKey(int $userId, string $hash): string
    {
        return 'stylist-analysis:' . $userId . ':' . $hash;
    }
}
