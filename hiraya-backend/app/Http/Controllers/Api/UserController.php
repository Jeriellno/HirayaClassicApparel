<?php

namespace App\Http\Controllers\Api;

use App\Support\AccountAudit;
use App\Http\Controllers\Controller;
use App\Rules\PasswordStrength;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class UserController extends Controller
{
    /**
     * Return the authenticated user's sizing profile.
     *
     * The shape is identical to the registration payload and to the AI Try-On
     * module so the frontend can hydrate any of the three surfaces (Register,
     * Account Settings, AiTryOn) from the same object.
     *
     * These replaced the 5 Core Body Measurements (chest_bust/waist/hips/
     * shoulder_width/sleeve_length). Centimetres are no longer stored per
     * customer — they are resolved from the size chart for these labels, so
     * there is exactly one set of numbers in the system.
     */
    public function getSizes(Request $request)
    {
        $user = $request->user();

        /*
         * Defensive: this route is behind `auth:sanctum`, so a resolved user is
         * expected. Returning empty sizes (rather than throwing on null) keeps a
         * token that expired mid-session from producing a 500 — the client
         * renders the defaults and can re-authenticate.
         */
        if (! $user) {
            return response()->json([
                'upper_body_size' => null,
                'lower_body_size' => null,
            ]);
        }

        return response()->json([
            'upper_body_size' => $user->upper_body_size,
            'lower_body_size' => $user->lower_body_size,
        ]);
    }

    /**
     * Overwrite the authenticated user's sizing profile.
     *
     * PUT semantics: the request payload fully replaces the existing record, so
     * any field omitted from the request is nulled out. This guarantees only the
     * latest sizes remain stored.
     *
     * `in:` mirrors the size ladder App\Services\SizeChart publishes, so a
     * saved label is always one the size suggester can resolve.
     */
    public function updateSizes(Request $request)
    {
        $validated = $request->validate([
            'upper_body_size' => ['nullable', 'string', 'max:10', 'in:XS,S,M,L,XL,2XL'],
            'lower_body_size' => ['nullable', 'string', 'max:10', 'in:XS,S,M,L,XL,2XL'],
        ], [
            'upper_body_size.in' => 'Please choose a valid upper body size.',
            'lower_body_size.in' => 'Please choose a valid lower body size.',
        ]);

        $user = $request->user();

        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $before = ($user->upper_body_size ?: '—') . ' / ' . ($user->lower_body_size ?: '—');

        // Force overwrite — only the two sizing fields are persisted.
        $user->update([
            'upper_body_size' => $validated['upper_body_size'] ?? null,
            'lower_body_size' => $validated['lower_body_size'] ?? null,
        ]);

        AccountAudit::record(
            $user,
            'USER_SIZES_UPDATED',
            'Saved sizes (top / bottom): ' . $before . ' -> '
                . ($user->upper_body_size ?: '—') . ' / ' . ($user->lower_body_size ?: '—') . '.',
            $request,
        );

        return response()->json([
            'message' => 'Sizes updated successfully.',
            'user'    => $user->fresh(),
            'sizes'   => [
                'upper_body_size' => $user->upper_body_size,
                'lower_body_size' => $user->lower_body_size,
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
                new PasswordStrength('new password'),
                'different:current_password',
            ],
        ], [
            'current_password.required' => 'Your current password is required to change it.',
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

        AccountAudit::record($user, 'USER_PASSWORD_CHANGED', 'Password changed; every session was signed out.', $request);

        return response()->json([
            'message' => 'Password updated successfully. Please sign in again with your new password.',
        ]);
    }

    /**
     * Permanently delete the authenticated user's account (Danger Zone).
     *
     * Re-authentication: the CURRENT password is required. Then, in one
     * transaction:
     *
     *   - try-on renders are force-deleted through Eloquent, so their encrypted
     *     objects are removed from the private renders bucket too (a plain FK
     *     cascade would orphan them);
     *   - bag items, reviews and the profile row go with the account (FK cascade);
     *   - ORDERS ARE RETAINED as business/financial records: the FK sets
     *     orders.user_id to NULL, and the order keeps only the delivery snapshot
     *     needed for the transaction history;
     *   - notifications and every API token are removed, so all sessions end.
     *
     * An account with an order still in progress cannot be deleted yet (the
     * store still has to verify, ship or deliver it) — the customer is told
     * exactly why instead of being silently redirected.
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

        $openOrder = $user->orders()
            ->whereNotIn('order_status', ['delivered', 'rejected'])
            ->value('id');
        if ($openOrder) {
            return response()->json([
                'message' => 'Your order #' . $openOrder . ' is still in progress. You can delete your account once all your orders are delivered or cancelled.',
                'reason'  => 'open_orders',
            ], 409);
        }

        $userId = $user->id;
        $email = $user->email;

        try {
            \Illuminate\Support\Facades\DB::transaction(function () use ($user) {
                // Removes each render's encrypted stored object (model hook).
                \App\Models\TryOnSession::withTrashed()
                    ->where('user_id', $user->id)
                    ->select(['id', 'result_image_path'])
                    ->each(fn ($session) => $session->forceDelete());

                $user->notifications()->delete();
                $user->tokens()->delete();
                $user->delete();
            });
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'message' => 'Your account could not be deleted right now. Nothing was removed — please try again or contact support.',
            ], 500);
        }

        // Written AFTER the delete succeeds; the row keeps the account id in
        // `subject_user_id`, so the history outlives the account.
        try {
            AccountAudit::record($user, 'USER_ACCOUNT_DELETED', 'Customer deleted their own account (' . $email . ', #' . $userId . '); orders kept as business records.', $request);
        } catch (\Throwable $e) {
            report($e);
        }

        return response()->json([
            'message' => 'Your account has been permanently deleted.',
            'deleted' => true,
        ]);
    }
}
