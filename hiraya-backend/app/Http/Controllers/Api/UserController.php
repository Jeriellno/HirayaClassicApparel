<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;

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

    /**
     * Change the authenticated user's password.
     *
     * Requires the CURRENT password to be re-entered and verified against the
     * stored hash — the same contract the Account Settings "Security & Password"
     * section presents to the user. The new password must differ from the old
     * one, and all devices' tokens are revoked afterwards so the change takes
     * effect immediately (the frontend redirects to login on 401).
     */
    public function changePassword(Request $request)
    {
        $user = $request->user();

        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $validated = $request->validate([
            'current_password' => ['required', 'string'],
            'new_password'     => [
                'required',
                'string',
                Password::min(8),
                'different:current_password',
            ],
        ], [
            'current_password.required' => 'Your current password is required to change it.',
            'new_password.min'          => 'New password must be at least 8 characters.',
            'new_password.different'    => 'New password must be different from your current password.',
        ]);

        if (! Hash::check($validated['current_password'], $user->password)) {
            return response()->json([
                'message' => 'The current password you entered is incorrect.',
                'errors'  => ['current_password' => ['The current password you entered is incorrect.']],
            ], 422);
        }

        $user->update([
            'password' => Hash::make($validated['new_password']),
        ]);

        // Invalidate every existing token so the new password takes effect
        // immediately. The client is expected to sign the user back in.
        $user->tokens()->delete();

        return response()->json([
            'message' => 'Password updated successfully. Please sign in again with your new password.',
        ]);
    }

    /**
     * Permanently delete the authenticated user's account (Danger Zone).
     *
     * Requires the CURRENT password as proof of ownership. After deletion every
     * token is revoked so no other device can keep a dead session alive.
     *
     * NOTE ON FOREIGN KEYS: cart items, orders and other child rows cascade or
     * are soft-orphanned by the schema's own FK rules; if a hard FK blocks the
     * delete, the 409-style error below surfaces it to the client instead of
     * throwing an unhandled 500.
     */
    public function deleteAccount(Request $request)
    {
        $user = $request->user();

        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $validated = $request->validate([
            'password' => ['required', 'string'],
        ], [
            'password.required' => 'Please enter your current password to confirm account deletion.',
        ]);

        if (! Hash::check($validated['password'], $user->password)) {
            return response()->json([
                'message' => 'The password you entered is incorrect.',
                'errors'  => ['password' => ['The password you entered is incorrect.']],
            ], 422);
        }

        try {
            $user->tokens()->delete();
            $user->delete();
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'message' => 'Your account could not be deleted because it still has linked records (e.g. orders). Contact support to remove them first.',
            ], 409);
        }

        return response()->json([
            'message' => 'Your account has been permanently deleted.',
        ]);
    }
}
