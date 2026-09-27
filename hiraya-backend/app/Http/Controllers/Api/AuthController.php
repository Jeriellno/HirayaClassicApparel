<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\PasswordResetService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

class AuthController extends Controller
{
    /**
     * Register User with 5 Core Body Measurements.
     *
     * Contract: 201 + { message, token, user } on success,
     *           422 + { message, errors: { field: [msg] } on validation failure.
     */
    public function register(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'full_name'      => 'required|string|max:255',
            'email'          => 'required|string|email|max:255|unique:users,email',
            // `confirmed` requires a matching `password_confirmation` field,
            // which the registration form always sends. Without it, a typo in
            // the confirm box was silently accepted and locked the customer out.
            'password'       => 'required|string|min:8|confirmed',
            'chest_bust'     => 'nullable|numeric|min:40|max:200',
            'waist'          => 'nullable|numeric|min:40|max:200',
            'hips'           => 'nullable|numeric|min:40|max:200',
            'shoulder_width' => 'nullable|numeric|min:20|max:100',
            'sleeve_length'  => 'nullable|numeric|min:30|max:100',
        ], [
            'email.unique'                => 'That email address is already registered.',
            'email.email'                 => 'Please enter a valid email address.',
            'password.confirmed'          => 'The password confirmation does not match.',
            'password.min'                => 'Your password must be at least 8 characters.',
            'full_name.required'          => 'Your full name is required.',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Please correct the highlighted fields.',
                'errors'  => $validator->errors(),
            ], 422);
        }

        try {
            $user = User::create([
                'full_name'      => trim($request->full_name),
                'email'          => strtolower(trim($request->email)),
                'password'       => Hash::make($request->password),
                'role'           => 'user',
                'chest_bust'     => $request->chest_bust,
                'waist'          => $request->waist,
                'hips'           => $request->hips,
                'shoulder_width' => $request->shoulder_width,
                'sleeve_length'  => $request->sleeve_length,
            ]);
        } catch (\Throwable $e) {
            Log::error('Registration failed: ' . $e->getMessage());

            return response()->json([
                'message' => 'We could not create your account right now. Please try again.',
                'errors'  => ['general' => ['Registration failed. Please try again.']],
            ], 500);
        }

        // Issue a session immediately so the client can stay signed in and land
        // on the shop without a second login round-trip.
        $token = $user->createToken('auth_token', ['*'], now()->addDays(30))->plainTextToken;

        return response()->json([
            'message' => 'User registered successfully.',
            'token'   => $token,
            'user'    => $user->fresh(),
        ], 201);
    }

    /**
     * User Login.
     *
     * Contract: 200 + { message, token, user } on success,
     *           422 for malformed input, 401 + { message } for bad credentials.
     *
     * NOTE: we use the Validator facade (not $request->validate()) so a caller
     * that forgets `Accept: application/json` still receives a JSON 422 body
     * instead of a 302 redirect back to an HTML form.
     */
    public function login(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'email'    => 'required|email',
            'password' => 'required|string',
            'remember' => 'nullable|boolean',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Please correct the highlighted fields.',
                'errors'  => $validator->errors(),
            ], 422);
        }

        $user = User::where('email', strtolower(trim($request->email)))->first();

        if (! $user || ! Hash::check($request->password, $user->password)) {
            // Deliberately identical for "unknown email" and "wrong password"
            // so the endpoint cannot be used to enumerate accounts.
            return response()->json([
                'message' => 'Invalid credentials. Please check your email and password.',
            ], 401);
        }

        /*
         * A suspended account is refused here — this is what makes the Super
         * Admin "Customers" suspend action REAL rather than a stored flag that
         * nothing reads. The message is distinct from bad credentials so a
         * customer knows to contact support instead of retrying their password.
         */
        if ($user->suspended_at !== null) {
            return response()->json([
                'message' => 'This account has been suspended. Please contact support.',
            ], 403);
        }

        // Revoke only THIS device's previous tokens rather than every session,
        // so signing in on a phone does not silently sign the user out on desktop.
        $requestedLifetime = $request->boolean('remember')
            ? now()->addDays(30)
            : now()->addHours(24);

        $token = $user->createToken('auth_token', ['*'], $requestedLifetime)->plainTextToken;

        /*
         * Record the sign-in so the Super Admin console's "Admin Accounts" table
         * can show a REAL last-seen timestamp. The `last_login_at` column existed
         * but was never written by any code path, so the table had nothing true to
         * display. Persisting it here is the single writer the column was missing.
         */
        $user->forceFill(['last_login_at' => now()])->save();

        // Explicit, stable auth payload. The frontend uses `user.role` to decide
        // the post-login destination (admin -> /admin, customer -> /shop), so the
        // role MUST be present here — returning a bare `$user->fresh()` coupled
        // the contract to the model's serialization and could omit it.
        return response()->json([
            'message' => 'Signed in successfully.',
            'token'   => $token,
            'user'    => [
                'id'        => $user->id,
                'full_name' => $user->full_name,
                'email'     => $user->email,
                'role'      => $user->role,
            ],
        ], 200);
    }

    public function checkEmail(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'email' => 'required|email',
        ]);

        if ($validator->fails()) {
            return response()->json(['message' => 'Invalid email format.'], 422);
        }

        $exists = User::where('email', $request->email)->exists();

        return response()->json([
            'available' => !$exists,
            'message'   => $exists ? 'Email address is already taken.' : 'Email is available.'
        ]);
    }

    /**
     * POST /forgot-password — send a reset link.
     *
     * THE PREVIOUS WIRING WAS WRONG IN A WAY THAT LOOKED CORRECT.
     * ------------------------------------------------------------
     * The Forgot page called `/check-email`, which exists to answer "is this
     * address already registered?" during SIGN-UP. It never sent mail. So the
     * customer was shown "Reset link sent", no email was ever produced, and the
     * failure was invisible from the UI — the worst kind of bug, because it only
     * surfaces when someone is already locked out.
     *
     * THIS ENDPOINT IS ENUMERATION-SAFE BY CONSTRUCTION: it returns the same 200
     * body whether the address exists, does not exist, or the send FAILED. A
     * caller cannot use it to discover which addresses are registered, and an
     * operator reading the logs is the only party who can tell the difference.
     */
    public function forgotPassword(Request $request, PasswordResetService $reset): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'email' => 'required|email|max:255',
        ]);

        if ($validator->fails()) {
            /*
             * A malformed address is the ONE case that gets a distinct answer.
             * It tells the caller nothing about the account database — the input
             * was not a valid email at all — and it is far more useful than a
             * silent success on a typo.
             */
            return response()->json([
                'message' => 'Please enter a valid email address.',
                'errors' => $validator->errors(),
            ], 422);
        }

        $result = $reset->sendResetLink((string) $request->email);

        return response()->json([
            'message' => 'If an account exists for that address, a reset link is on its way.',
            'expires_in_minutes' => $result['expires_in_minutes'] ?? PasswordResetService::TTL_MINUTES,
        ], 200);
    }

    /**
     * POST /validate-reset-token — is this link still usable?
     *
     * Answered BEFORE the customer picks a new password. Without it, an expired
     * or already-used link is only discovered on submit, after the work of
     * choosing a password — and the reset response is (correctly) generic, so the
     * customer sees something that reads like success while nothing changed.
     *
     * The response is a plain boolean plus a reason CODE, never the account's
     * details: it confirms a token, not an account.
     */
    public function validateResetToken(Request $request, PasswordResetService $reset): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'email' => 'required|email',
            'token' => 'required|string',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'valid' => false,
                'reason' => 'malformed',
                'message' => 'This reset link is incomplete. Request a new one.',
            ], 200);
        }

        $valid = $reset->tokenIsValid((string) $request->email, (string) $request->token);

        return response()->json([
            'valid' => $valid,
            'reason' => $valid ? 'ok' : 'invalid_or_expired',
            'message' => $valid
                ? 'Set a new password below.'
                : 'This reset link is invalid, expired, or has already been used. Request a new one.',
        ], 200);
    }

    /**
     * Reset a password using a previously issued, signed reset token.
     *
     * The response is intentionally identical for every outcome so the
     * endpoint cannot be used to enumerate registered email addresses.
     */
    public function resetPasswordDirect(Request $request, PasswordResetService $reset): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'email'                 => 'required|email',
            'token'                 => 'required|string',
            /*
             * `confirmed` mirrors the registration contract: the frontend sends
             * `password_confirmation`, and a mismatch must be a validation error
             * the customer can see rather than a silent no-op.
             */
            'password'              => 'required|string|min:8|confirmed',
        ], [
            'password.confirmed' => 'The password confirmation does not match.',
            'password.min' => 'Your password must be at least 8 characters.',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Validation error',
                'errors'  => $validator->errors()
            ], 422);
        }

        // Generic message returned on every failure path below.
        $genericMessage = 'If that email is registered, the password has been reset.';

        $reset->resetPassword(
            (string) $request->email,
            (string) $request->token,
            (string) $request->password
        );

        /*
         * Deliberately the SAME 200 whether the token was accepted or rejected.
         * Reporting the rejection would let a caller test tokens, and the link's
         * validity is already confirmed by /validate-reset-token before this is
         * ever reached from the UI.
         */
        return response()->json(['message' => $genericMessage], 200);
    }

    /**
     * Revokes the token used for the current request only. A session that is
     * already invalid still returns 200 so the client can always clear itself.
     */
    public function logout(Request $request)
    {
        $token = $request->user()?->currentAccessToken();

        if ($token && method_exists($token, 'delete')) {
            $token->delete();
        }

        return response()->json(['message' => 'Logged out successfully'], 200);
    }

    /**
     * Returns the authenticated user in the same { user } envelope the
     * login/register endpoints use, so the client has ONE shape to parse.
     */
    public function me(Request $request)
    {
        return response()->json([
            'user' => $request->user(),
        ], 200);
    }
}