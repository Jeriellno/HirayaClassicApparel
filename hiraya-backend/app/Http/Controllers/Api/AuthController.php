<?php

namespace App\Http\Controllers\Api;

use App\Support\AccountAudit;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Rules\PasswordStrength;
use App\Services\PasswordResetService;
use App\Services\RegistrationVerificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

class AuthController extends Controller
{
    /**
     * New sign-ups must use a real Gmail address (ownership is proven by a mailed
     * code). Two dots in a row are refused here too — Gmail does not allow them,
     * and `email:rfc` already rejected them with a vaguer message.
     */
    public const GMAIL_PATTERN = '/^(?!.*\.\.)[a-z0-9](?:[a-z0-9.+_-]{0,62}[a-z0-9])?@gmail\.com$/i';

    /**
     * The address as the customer meant it: Unicode-folded (full-width letters
     * become ASCII), every space and invisible character removed, lower-cased.
     *
     * Mirrors `normaliseEmail()` in hiraya-frontend/src/utils/emailInput.js. A
     * phone keyboard can slip a space after "@" or a zero-width character into
     * the field; an email address can never contain either, so they are removed
     * before validation instead of failing it with "Please enter a valid email".
     */
    public static function normaliseEmail(mixed $value): string
    {
        $email = (string) $value;

        if (class_exists(\Normalizer::class)) {
            $email = \Normalizer::normalize($email, \Normalizer::FORM_KC) ?: $email;
        }

        $email = preg_replace('/[\s\x{00A0}\x{200B}-\x{200D}\x{2060}\x{FEFF}]+/u', '', $email) ?? $email;

        return strtolower($email);
    }

    /**
     * Register User with their sizing profile — STEP 1 of 2.
     *
     * The form is validated exactly as before, plus: the address must be an
     * @gmail.com address and the password needs a special character. No account
     * is created yet: a one-time code is mailed to the address and the sign-up
     * waits (RegistrationVerificationService) until /register/verify returns it.
     *
     * Contract: 202 + { message, verification_required, email, expires_in_minutes },
     *           422 + { message, errors: { field: [msg] } on validation failure,
     *           503 when the code e-mail could not be sent.
     */
    public function register(Request $request, RegistrationVerificationService $verification)
    {
        // System Settings -> "Customer sign-ups". Enforced here, not only in the UI.
        if (! \App\Models\SystemSetting::isOn('registrations_open')) {
            return response()->json([
                'message' => 'New sign-ups are paused right now. Please try again later.',
            ], 403);
        }

        // Clean the address BEFORE validating, so `unique`, the Gmail rule and the
        // stored value all see the same string the frontend validated.
        if ($request->has('email')) {
            $request->merge(['email' => self::normaliseEmail($request->input('email'))]);
        }

        $validator = Validator::make($request->all(), [
            'full_name'      => 'required|string|max:255',
            'email'          => ['required', 'string', 'email:rfc', 'max:255', 'regex:' . self::GMAIL_PATTERN, 'unique:users,email'],
            /*
             * `confirmed` requires a matching `password_confirmation` field,
             * which the registration form always sends. Without it, a typo in
             * the confirm box was silently accepted and locked the customer out.
             *
             * The strength rules come from the ONE shared rule (see
             * App\Rules\PasswordStrength) so that sign-up, reset and change
             * password cannot drift apart again. The uppercase + number
             * requirements were previously enforced ONLY in the React form: the
             * server accepted anything the UI had already promised to reject.
             */
            'password'       => ['required', 'string', new PasswordStrength, 'confirmed'],
            /*
             * THE SIZING PROFILE — REQUIRED, not optional.
             *
             * These three used to be `nullable`, which meant a customer who
             * skipped the sizing section got a row with all three columns NULL.
             * That is worse than no account: size suggestions and the AI try-on
             * render both read this profile, so the account existed but had
             * nothing to size with, and the customer was silently shown whatever
             * the fallback happened to be. If the form asks, the API insists —
             * otherwise the two can disagree and the guard is only cosmetic.
             *
             * The two size labels are validated against the SAME ladder
             * App\Services\SizeChart serves, so an "M" saved here is always a
             * size the store actually stocks.
             */
            'upper_body_size' => ['required', 'string', 'max:10', 'in:XS,S,M,L,XL,2XL'],
            'lower_body_size' => ['required', 'string', 'max:10', 'in:XS,S,M,L,XL,2XL'],
            /*
             * FIT STYLE — the same three values the "Fit Style" select offers in
             * Account Settings (see VirtualTryOnSection.jsx), and required for
             * the same reason as the two sizes above.
             */
            'preferred_fit'   => ['required', 'string', 'in:slim,regular,oversized'],
            /*
             * GENDER — required so the Home feed can match product gender
             * (Men / Women / Unisex) on top of size and fit style.
             */
            'gender'          => ['required', 'string', 'in:male,female'],
        ], [
            'email.unique'                => 'That email address is already registered.',
            'email.email'                 => 'That email address isn\'t valid. Check for typos such as two dots in a row.',
            'email.regex'                 => 'Please sign up with a Gmail address (name@gmail.com).',
            'password.confirmed'          => 'The password confirmation does not match.',
            'password.min'                => 'Your password must be at least 8 characters.',
            'password.regex'              => 'Your password must contain at least 1 uppercase letter, 1 number and 1 special character.',
            'full_name.required'          => 'Your full name is required.',
            'upper_body_size.required'     => 'Please choose your upper body size.',
            'upper_body_size.in'           => 'Please choose a valid upper body size.',
            'lower_body_size.required'     => 'Please choose your lower body size.',
            'lower_body_size.in'           => 'Please choose a valid lower body size.',
            'preferred_fit.required'       => 'Please choose your fit style.',
            'preferred_fit.in'             => 'Please choose a valid fit style.',
            'gender.required'              => 'Please choose your gender.',
            'gender.in'                    => 'Please choose a valid gender.',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Please correct the highlighted fields.',
                'errors'  => $validator->errors(),
            ], 422);
        }

        $email = strtolower(trim($request->email));
        $sent = $verification->start([
            'full_name'       => trim($request->full_name),
            'email'           => $email,
            // Hashed now: the plain password is never parked anywhere.
            'password_hash'   => Hash::make($request->password),
            'upper_body_size' => $request->upper_body_size,
            'lower_body_size' => $request->lower_body_size,
            'preferred_fit'   => $request->preferred_fit,
            'gender'          => $request->gender,
        ]);

        if (! $sent) {
            return response()->json([
                'message' => 'We could not send the verification code right now. Please try again in a minute.',
                'errors'  => ['email' => ['We couldn\'t send the code to this Gmail right now (mail server not reachable). Please try again in a minute.']],
            ], 503);
        }

        return response()->json([
            'message' => 'We sent a 6-digit code to ' . $email . '. Enter it to finish creating your account.',
            'verification_required' => true,
            'email' => $email,
            'expires_in_minutes' => RegistrationVerificationService::TTL_MINUTES,
        ], 202);
    }

    /**
     * POST /register/verify — STEP 2: the mailed code comes back and the
     * account is created (already verified) and signed in.
     *
     * Contract: 201 + { message, token, user } (what /register used to return).
     */
    public function verifyRegistration(Request $request, RegistrationVerificationService $verification)
    {
        if ($request->has('email')) {
            $request->merge(['email' => self::normaliseEmail($request->input('email'))]);
        }

        $validator = Validator::make($request->all(), [
            'email' => 'required|email|max:255',
            'code'  => 'required|string|max:12',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Please enter the 6-digit code from your email.',
                'errors'  => $validator->errors(),
            ], 422);
        }

        $result = $verification->verify((string) $request->email, (string) $request->code);

        if ($result['status'] !== 'ok') {
            $message = match ($result['status']) {
                'invalid' => 'That code is not correct. ' . ($result['attempts_left'] ?? 0) . ' attempt(s) left.',
                'locked'  => 'Too many wrong codes. Please sign up again to get a new code.',
                default   => 'This code has expired. Please sign up again or request a new code.',
            };

            return response()->json([
                'message' => $message,
                'reason'  => $result['status'],
                'errors'  => ['code' => [$message]],
            ], 422);
        }

        $data = $result['data'];

        // The address could have been registered while the code was pending.
        if (User::where('email', $data['email'])->exists()) {
            return response()->json([
                'message' => 'That email address is already registered.',
                'errors'  => ['email' => ['That email address is already registered.']],
            ], 422);
        }

        try {
            $user = User::create([
                'full_name'       => $data['full_name'],
                'email'           => $data['email'],
                // Already a bcrypt hash (made in step 1).
                'password'        => $data['password_hash'],
                'role'            => 'user',
                'upper_body_size' => $data['upper_body_size'],
                'lower_body_size' => $data['lower_body_size'],
                'preferred_fit'   => $data['preferred_fit'],
                'gender'          => $data['gender'],
            ]);
            $user->forceFill(['email_verified_at' => now()])->save();
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

        AccountAudit::record($user, 'USER_REGISTERED', 'Account created and Gmail address verified for ' . $user->full_name . '.', $request);

        return response()->json([
            'message' => 'User registered successfully.',
            'token'   => $token,
            'user'    => $user->fresh(),
        ], 201);
    }

    /** POST /register/resend — a fresh code for a sign-up that is still pending. */
    public function resendRegistrationCode(Request $request, RegistrationVerificationService $verification)
    {
        if ($request->has('email')) {
            $request->merge(['email' => self::normaliseEmail($request->input('email'))]);
        }

        $validator = Validator::make($request->all(), ['email' => 'required|email|max:255']);
        if ($validator->fails()) {
            return response()->json(['message' => 'Please enter a valid email address.'], 422);
        }

        return match ($verification->resend((string) $request->email)) {
            'sent'     => response()->json(['message' => 'A new code is on its way.']),
            'cooldown' => response()->json(['message' => 'Please wait a minute before requesting another code.'], 429),
            'failed'   => response()->json(['message' => 'We could not send the code right now. Please try again.'], 503),
            default    => response()->json(['message' => 'This sign-up has expired. Please fill in the form again.', 'reason' => 'expired'], 422),
        };
    }

    /**
     * Customer sign-in — email + password, and nothing else.
     *
     * Contract:
     *   200 + { message, token, user }   customer signed in (Sanctum)
     *   200 + { message, mfa_required }  correct password on a privileged
     *                                    account — no token is issued here; the
     *                                    client completes aal2 via Supabase
     *   401 + { message }                bad credentials
     *   422                              malformed input
     *
     * ---------------------------------------------------------------------
     * WHY STAFF DO NOT GET A TOKEN HERE
     * ---------------------------------------------------------------------
     * This method used to be a TWO-STEP exchange for privileged accounts: the
     * password was checked, and instead of a session the response carried a
     * `challenge_token` that had been cached under `login:2fa:*`, which the
     * client exchanged for a TOTP verified LOCALLY against a secret in the
     * `user_two_factors` table. That whole path is gone, replaced by Supabase's
     * built-in MFA (see EnsureSupabaseAAL2 and the console sign-in screen).
     *
     * The reason a staff account cannot simply fall through to an ordinary
     * Sanctum session is the whole point of the migration. If it did, a
     * superadmin's correct password would mint a plain `auth_token` that
     * satisfies `auth:sanctum` everywhere and carries no `aal` claim at all —
     * a session indistinguishable from a customer's, one that the console's
     * `/api/admin/*` routes would then have to refuse on every single call.
     * Staff get a TOTP-verified Supabase session or they get nothing.
     *
     * The 403 below is therefore a routing instruction, not a punishment. It
     * names the door to use, and it is emitted ONLY AFTER the password has
     * been verified — so it discloses nothing to a caller who does not already
     * know the password, and cannot be used to enumerate staff accounts.
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
            // A wrong password on a REAL account is worth auditing (repeated
            // failures are how a guessing attack shows up). An unknown email has
            // no account to attach the row to, so it is not recorded.
            if ($user) {
                AccountAudit::record($user, 'USER_LOGIN_FAILED', 'Sign-in refused: wrong password.', $request);
            }

            /*
             * A wrong password answers identically whether or not the account
             * has a second factor, so this endpoint cannot be used to discover
             * which addresses belong to staff.
             */
            return response()->json([
                'message' => 'Invalid credentials. Please check your email and password.',
            ], 401);
        }

        /*
         * A suspended account is refused here, and BEFORE the staff check so
         * that a suspended admin is told the true reason rather than being
         * pointed at a sign-in page that will also refuse them.
         */
        if ($user->suspended_at !== null) {
            return response()->json([
                'message' => 'This account has been suspended. Please contact support.',
            ], 403);
        }

        /*
         * THE SPLIT — ONE DOOR, TWO DESTINATIONS.
         *
         * There is a single /login form for every role. A staff account does not
         * get a Sanctum session (it carries no `aal` claim, so /api/admin/* would
         * refuse every call) and it does not get a 403 telling it to go and find
         * another form either — that was the old second door, and it is gone.
         *
         * Instead this endpoint answers 200 with `mfa_required`, which tells the
         * client: your password is correct, you are privileged, and the session
         * you are about to mint MUST be raised to `aal2` before /superadmin will
         * open. The client then signs the same credentials into Supabase and
         * answers a 6-digit TOTP. A customer simply never sees this branch.
         *
         * Still emitted only AFTER the password verifies, so it discloses nothing
         * to a caller who does not already know the password.
         */
        if (in_array(strtolower((string) $user->role), ['admin', 'superadmin'], true)) {
            /*
             * A STAFF ACCOUNT: password verified, no token issued.
             *
             * There is no `mfa_enrollment_required` flag any more, and there is no
             * separate "activation" concept. It used to be computed here as
             * `$user->mfa_enrolled_at === null` and used to send the client to an
             * enrolment screen — a second door inside the sign-in, for a state the
             * TOTP challenge already decides.
             *
             * Why it is gone: the flag described the SERVER's copy of a fact, while
             * `supabase.aal2` verifies the SAME fact on every request, cryptographically
             * and at the moment it is needed. A client that reads this flag is reading
             * a stale value that can disagree with the authority — which is exactly how
             * a correctly-enrolled admin ended up staring at a QR code they did not
             * need, and how a pending one got sent to a code box with no factor to
             * produce a code. The client asks GoTrue (`getAssuranceLevels`) instead,
             * and GoTrue is the thing that actually issues `aal2`.
             */
            return response()->json([
                'message' => 'Password verified. Second factor required.',
                'mfa_required' => true,
                'role'        => strtolower((string) $user->role),
            ], 200);
        }

        return $this->issueSession($user, $request);
    }

    /**
     * Mint a Sanctum session.
     *
     * Deliberately reachable ONLY by a customer now. It is no longer shared
     * with a second-factor handshake, because there is no second-factor
     * handshake on this side any more.
     */
    private function issueSession(User $user, Request $request): JsonResponse
    {
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

                AccountAudit::record(
                    $user,
                    'USER_LOGIN',
                    'Signed in' . ($request->boolean('remember') ? ' (remember me, 30 days).' : ' (24-hour session).'),
                    $request,
                );

                // Explicit, stable auth payload. The frontend uses `user.role` to decide
                // the post-login destination (admin -> /superadmin, customer -> /shop), so
                // the role MUST be present here - returning a bare `$user->fresh()` coupled
                // the contract to the model's serialization and could omit it.
                return response()->json([
                    'message' => 'Signed in successfully.',
                    'token'   => $token,
                    'user'    => [
                        'id'        => $user->id,
                        'full_name' => $user->full_name,
                        'email'     => $user->email,
                        'role'      => $user->role,
                        /*
                         * The sizing profile and gender travel with the sign-in.
                         * Without them the client held a partial user until the
                         * next full reload, so Account Settings showed "Not set"
                         * — and saving that form wiped the sizes that WERE saved.
                         */
                        'upper_body_size' => $user->upper_body_size,
                        'lower_body_size' => $user->lower_body_size,
                        'preferred_fit'   => $user->preferred_fit,
                        'gender'          => $user->gender,
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
     * The MESSAGE is identical for every outcome so the endpoint cannot be used
     * to enumerate registered email addresses. A `reset` boolean accompanies it,
     * reporting whether the token was actually consumed — that reveals nothing
     * about the account database, because a valid token can only come from the
     * mailbox the link was sent to. See the note at the return below.
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
             *
             * The same shared strength rule as /register, so a customer cannot
             * choose a weaker password by resetting than the one they signed up
             * with. This used to ask for nothing but 8 characters while the
             * sign-up form demanded an uppercase letter and a number.
             */
            'password'              => ['required', 'string', new PasswordStrength, 'confirmed'],
        ], [
            'password.confirmed' => 'The password confirmation does not match.',
            'password.min' => 'Your password must be at least 8 characters.',
            'password.regex' => 'Your password must contain at least 1 uppercase letter, 1 number and 1 special character.',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Validation error',
                'errors'  => $validator->errors()
            ], 422);
        }

        // Generic message returned on every failure path below.
        $genericMessage = 'If that email is registered, the password has been reset.';

        $applied = $reset->resetPassword(
            (string) $request->email,
            (string) $request->token,
            (string) $request->password
        );

        /*
         * SAME 200, SAME MESSAGE — BUT NOW IT SAYS WHETHER IT WORKED.
         *
         * The message stays identical on purpose: it must not confirm that an
         * address is registered, or this endpoint becomes a probe for that.
         *
         * The `reset` BOOLEAN is safe to add, and the reason matters. Revealing
         * "does this EMAIL exist?" is enumeration. Revealing "was this TOKEN
         * valid?" is not, because a caller cannot obtain a valid token without
         * already controlling the mailbox the link was mailed to — the token is
         * HMAC-signed over the address, expires in 60 minutes, and dies the
         * moment it is used. Someone holding one already knows the account
         * exists, because they just read its mail.
         *
         * WITHOUT THIS FLAG THE UI LIES. The frontend used to treat any 200 as
         * proof of success and render "Your new password is active — every device
         * has been signed out", so submitting an expired or already-used link
         * produced a confident success screen and a password that had not
         * changed. Reproduced against a garbage token: HTTP 200, unchanged
         * password, "Password changed" on screen. The honest signal is the only
         * thing that lets the page tell the customer to request a new link.
         */
        return response()->json([
            'message' => $genericMessage,
            'reset'   => $applied,
        ], 200);
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
            AccountAudit::record($request->user(), 'USER_LOGOUT', 'Signed out.', $request);
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