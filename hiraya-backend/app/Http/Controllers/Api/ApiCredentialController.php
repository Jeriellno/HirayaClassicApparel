<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ApiCredential;
use App\Services\ApiCredentialStore;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * THE API MANAGEMENT PANEL — server side.
 *
 * WHAT THIS ADDS
 * --------------
 * `ApiStatusController` already showed whether a key was configured, masked, and
 * whether the vendor was reachable. It deliberately refused to change anything,
 * and rotating a key still meant editing `.env` on disk. These endpoints are the
 * other half: add, activate, verify and retire a credential from the console.
 *
 * WHY STORING A SECRET OVER HTTP IS ACCEPTABLE HERE, CAREFULLY
 * ------------------------------------------------------------
 * The route sits behind `auth:sanctum` + `superadmin` (see routes/api.php), the
 * secret is encrypted at rest before it touches the database, and it is never
 * echoed back — every response carries a masked hint only. That is the same trust
 * boundary the existing `PATCH /admin/accounts` and settings writes already sit
 * behind.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * There is no endpoint that returns a stored key in full. Not for a superadmin,
 * not "just this once". A panel that can display a live credential is a panel that
 * will eventually put one in a screenshot, a browser extension, or a support
 * thread. The console shows enough to tell keys apart and nothing more.
 *
 * EVERY WRITE IS AUDITED WITH THE ACTING USER, because a credential is one of the
 * few things in this application that can be used to impersonate Hiraya itself.
 */
class ApiCredentialController extends Controller
{
    /**
     * GET /api/admin/api-credentials
     *
     * The panel's data: every stored credential (masked), which one is active per
     * provider, and — importantly — whether each provider is actually being served
     * from the database or still from `.env`. Reporting "env" honestly matters:
     * it is the difference between "we manage this key" and "someone edited a file
     * six months ago".
     */
    public function index(): JsonResponse
    {
        try {
            $credentials = ApiCredential::query()
                ->orderBy('provider')
                ->orderByDesc('is_active')
                ->orderByDesc('id')
                ->get();
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'The API credential store is not available. Run: php artisan migrate',
                'credentials' => [],
                'overview' => [],
            ], 503);
        }

        return response()->json([
            'credentials' => $credentials->map(fn(ApiCredential $c) => $c->toPanelArray())->all(),
            'overview' => ApiCredentialStore::overview(),
            'providers' => ApiCredentialStore::PROVIDERS,
            'checked_at' => now()->toIso8601String(),
        ]);
    }

    /**
     * POST /api/admin/api-credentials
     *
     * Add a key and (by default) make it the active one.
     *
     * Takes effect on the NEXT REQUEST — no `config:clear`, no worker restart —
     * which is the entire point of holding the active key in the database rather
     * than in a file the app reads once at boot.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'provider' => 'required|string|in:' . implode(',', ApiCredentialStore::PROVIDERS),
            'label' => 'nullable|string|max:120',
            'secret' => 'required|string|max:500',
            'activate' => 'sometimes|boolean',
            /*
             * Optional, and only meaningful for vendors that issue short-lived
             * tokens. When supplied it is what lets `hiraya:refresh-api-keys`
             * rotate BEFORE the key dies instead of discovering the failure.
             */
            'expires_at' => 'nullable|date',
        ]);

        try {
            [$ok, $error] = ApiCredentialStore::store(
                $validated['provider'],
                trim((string) ($validated['label'] ?? '')),
                (string) $validated['secret'],
                (bool) ($validated['activate'] ?? true),
            );
        } catch (\Throwable $e) {
            /* A decrypt/DB failure must not echo the submitted secret. */
            Log::error('Storing an API credential failed: ' . $e->getMessage(), [
                'provider' => $validated['provider'],
                'by_user_id' => $request->user()?->id,
            ]);

            return response()->json(['message' => 'The key could not be stored.'], 500);
        }

        if (!$ok) {
            return response()->json(['message' => $error], 422);
        }

        $row = ApiCredential::query()
            ->where('provider', $validated['provider'])
            ->orderByDesc('id')
            ->first();

        if (!empty($validated['expires_at'])) {
            $row->forceFill(['expires_at' => $validated['expires_at']])->save();
        }

        Log::info('API credential added from the console', [
            'provider' => $validated['provider'],
            'label' => $row->label,
            'credential_id' => $row->id,
            'activated' => (bool) ($validated['activate'] ?? true),
            'by_user_id' => $request->user()?->id,
        ]);

        return response()->json([
            'message' => 'Key stored'
                . (($validated['activate'] ?? true) ? ' and is now active.' : '.'),
            'credential' => $row->toPanelArray(),
            'overview' => ApiCredentialStore::overview(),
        ], 201);
    }

    /**
     * POST /api/admin/api-credentials/{id}/activate
     *
     * Promote this key. The "switch to the spare" action, and the one an operator
     * reaches for when a vendor has quietly invalidated a key.
     */
    public function activate(Request $request, int $id): JsonResponse
    {
        $row = ApiCredential::find($id);

        if (!$row) {
            return response()->json(['message' => 'That credential no longer exists.'], 404);
        }

        if ($row->retired_at !== null) {
            return response()->json(['message' => 'That key was retired and cannot be reactivated.'], 422);
        }

        ApiCredentialStore::promote($row);

        return response()->json([
            'message' => "{$row->label} is now the active key for {$row->provider}.",
            'credential' => $row->fresh()->toPanelArray(),
            'overview' => ApiCredentialStore::overview(),
        ]);
    }

    /**
     * POST /api/admin/api-credentials/{id}/verify
     *
     * Exercise the key against its vendor NOW, and record the verdict.
     *
     * Delegates to exactly the same logic as the scheduled command, so a key
     * checked by a person and one checked by the scheduler produce identical
     * history — the panel can never disagree with the automation.
     */
    public function verify(Request $request, int $id): JsonResponse
    {
        $row = ApiCredential::find($id);

        if (!$row) {
            return response()->json(['message' => 'That credential no longer exists.'], 404);
        }

        $result = \Illuminate\Support\Facades\Artisan::call('hiraya:refresh-api-keys', ['--verify' => true]);

        $fresh = $row->fresh();

        return response()->json([
            'message' => $fresh->last_status === ApiCredential::STATUS_VALID
                ? 'The key is accepted by the provider.'
                : ($fresh->last_message ?? 'Verification finished.'),
            'credential' => $fresh->toPanelArray(),
            'overview' => ApiCredentialStore::overview(),
            'output' => trim(\Illuminate\Support\Facades\Artisan::output()),
        ]);
    }

    /**
     * DELETE /api/admin/api-credentials/{id}
     *
     * Retire without deleting, so the record of what was in play survives an
     * investigation. Refuses to leave a provider with no working key.
     */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $row = ApiCredential::find($id);

        if (!$row) {
            return response()->json(['message' => 'That credential no longer exists.'], 404);
        }

        [$ok, $error] = ApiCredentialStore::retire($row);

        if (!$ok) {
            return response()->json(['message' => $error], 422);
        }

        return response()->json([
            'message' => "{$row->label} was retired.",
            'overview' => ApiCredentialStore::overview(),
        ]);
    }
}
