<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;

class UserController extends Controller
{
    /**
     * Return the authenticated user's 5 Core Body Measurements.
     *
     * The shape of the response is identical to the registration payload
     * and to the AI Try-On module so the frontend can hydrate any of
     * the three surfaces (Register, Account Settings, AiTryOn) from the
     * same object.
     */
    public function getMeasurements(Request $request)
    {
        $user = $request->user();

        /*
         * Defensive: this route is behind `auth:sanctum`, so a resolved user is
         * expected. Returning empty measurements (rather than throwing on null)
         * keeps a token that expired mid-session from producing a 500 — the
         * client renders blank fields and can re-authenticate.
         */
        if (! $user) {
            return response()->json([
                'chest_bust'     => null,
                'waist'          => null,
                'hips'           => null,
                'shoulder_width' => null,
                'sleeve_length'  => null,
            ]);
        }

        return response()->json([
            'chest_bust'     => $user->chest_bust,
            'waist'          => $user->waist,
            'hips'           => $user->hips,
            'shoulder_width' => $user->shoulder_width,
            'sleeve_length'  => $user->sleeve_length,
        ]);
    }

    /**
     * Overwrite the authenticated user's 5 Core Body Measurements.
     *
     * PUT semantics: the request payload fully replaces the existing
     * record, so any field omitted from the request is nulled out.
     * This guarantees only the latest measurements remain stored.
     */
    public function updateMeasurements(Request $request)
    {
        $validated = $request->validate([
            'chest_bust'     => 'nullable|numeric|min:40|max:200',
            'waist'          => 'nullable|numeric|min:40|max:200',
            'hips'           => 'nullable|numeric|min:40|max:200',
            'shoulder_width' => 'nullable|numeric|min:20|max:100',
            'sleeve_length'  => 'nullable|numeric|min:30|max:100',
        ], [
            'chest_bust.between' => 'Chest/Bust must be a valid measurement (40-200).',
            'waist.between'      => 'Waist must be a valid measurement (40-200).',
            'hips.between'       => 'Hips must be a valid measurement (40-200).',
        ]);

        $user = $request->user();

        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        // Force overwrite — only the 5 standardized fields are persisted.
        $user->update([
            'chest_bust'     => $validated['chest_bust']     ?? null,
            'waist'          => $validated['waist']          ?? null,
            'hips'           => $validated['hips']           ?? null,
            'shoulder_width' => $validated['shoulder_width'] ?? null,
            'sleeve_length'  => $validated['sleeve_length']  ?? null,
        ]);

        return response()->json([
            'message'      => 'Measurements updated successfully.',
            'user'         => $user->fresh(),
            'measurements' => [
                'chest_bust'     => $user->chest_bust,
                'waist'          => $user->waist,
                'hips'           => $user->hips,
                'shoulder_width' => $user->shoulder_width,
                'sleeve_length'  => $user->sleeve_length,
            ],
        ]);
    }
}
