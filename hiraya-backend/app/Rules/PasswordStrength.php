<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * The ONE password rule the whole application enforces.
 *
 * WHY A SHARED RULE EXISTS
 * -----------------------
 * Password strength used to be declared in three separate places and each one
 * was different:
 *
 *   POST /register            'required|string|min:8|confirmed'
 *   POST /reset-password-direct 'required|string|min:8|confirmed'
 *   PUT  /user/password       Password::min(8) + different:current_password
 *
 * ...and the REGISTER page added two rules the server never checked at all:
 * "at least 1 uppercase letter" and "at least 1 number or symbol". So a
 * password that the sign-up form refused was accepted verbatim by the API, and
 * the reset flow asked for nothing but a length. Three screens, three contracts.
 *
 * THE CONSEQUENCE: whatever a customer typed into Register was not a promise the
 * server had made. Anything they later chose on /reset could be weaker than
 * the one they first registered with, and a weak password stayed valid forever
 * because no endpoint ever re-checked it.
 *
 * Declaring the rule once removes the possibility of drift: if the policy
 * changes, it changes here and all three endpoints change with it.
 *
 * THE POLICY ITSELF
 * -----------------
 *   - at least 8 characters   (unchanged; the one rule every endpoint already had)
 *   - at least 1 uppercase    (from Register — was client-side only)
 *   - at least 1 number       (from Register — was client-side only)
 *   - at least 1 special char (anything that is not a letter or digit, e.g.
 *                              ! @ # $ % _ - . ) — added for NEW passwords only;
 *                              existing passwords keep working because sign-in
 *                              never re-validates strength.
 *
 * Uppercase-and-number rather than a wide symbol set: it is the policy the UI
 * already advertised to customers, so enforcing it server-side makes the form's
 * promise true instead of changing what people were told. Note this is
 * deliberately NOT `Password::mixedCase()->numbers()` from Laravel's fluent
 * builder — that pair would forbid an all-lowercase-with-number password, which
 * is not the rule Register ever displayed.
 */
class PasswordStrength implements ValidationRule
{
    public const MIN_LENGTH = 8;

    /**
     * @param  string|null  $messageLabel  Overrides the name used in failure
     *                                    messages. The change-password endpoint
     *                                    names the field `new_password`, which
     *                                    would otherwise leak into the copy.
     */
    public function __construct(private readonly ?string $messageLabel = null)
    {
    }

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (!is_string($value)) {
            return;
        }

        $label = $this->messageLabel ?? str_replace('_', ' ', $attribute);

        if (mb_strlen($value) < self::MIN_LENGTH) {
            $fail("The {$label} must be at least " . self::MIN_LENGTH . ' characters.');
        }

        if (!preg_match('/[A-Z]/', $value)) {
            $fail("The {$label} must contain at least 1 uppercase letter.");
        }

        if (!preg_match('/[0-9]/', $value)) {
            $fail("The {$label} must contain at least 1 number.");
        }

        if (!preg_match('/[^A-Za-z0-9]/', $value)) {
            $fail("The {$label} must contain at least 1 special character (e.g. ! @ # $ %).");
        }
    }

    /**
     * The same checks as a plain rule string, for any call site that needs one.
     * Prefer the rule OBJECT (`new PasswordStrength`) — it reports each missing
     * requirement separately, which is far more useful than a single regex.
     */
    public static function rule(): string
    {
        return 'required|string|min:' . self::MIN_LENGTH . '|regex:/[A-Z]/|regex:/[0-9]/|regex:/[^A-Za-z0-9]/';
    }
}
