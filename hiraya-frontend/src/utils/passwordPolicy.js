/**
 * THE PASSWORD POLICY — one definition, used by every screen that asks for a
 * password.
 *
 * WHY IT IS EXTRACTED
 * -------------------
 * Register and ResetPassword each declared their own idea of an acceptable
 * password, and they did not agree. Register required 8 characters, an uppercase
 * letter and a number; ResetPassword required 8 characters and nothing else. So
 * a customer who registered with "Str0ngPass" was told they could reset to
 * "abcdefgh" and the form accepted it.
 *
 * That is not only an inconsistency. The backend enforced `min:8` on BOTH
 * routes while the uppercase + number requirements existed only in Register's
 * React state — the server never checked them. A weak password typed straight
 * into the API was accepted, and it stayed valid forever because no endpoint
 * re-validated it.
 *
 * The rule now lives in ONE place on the client (here, mirrored by
 * `App\Rules\PasswordStrength` on the server), so the three password screens —
 * register, reset, change password — can no longer drift apart.
 */

/** Minimum number of characters. */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * The individual requirements, in display order.
 *
 * `test` is a plain predicate so each screen can render its own checklist, and
 * `message` is what the screen shows when that requirement is unmet.
 */
export const PASSWORD_REQUIREMENTS = [
    {
        id: 'length',
        label: 'At least 8 characters',
        test: (value) => value.length >= PASSWORD_MIN_LENGTH,
        message: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
    },
    {
        id: 'uppercase',
        label: 'At least 1 uppercase letter',
        test: (value) => /[A-Z]/.test(value),
        message: 'Include at least 1 uppercase letter.',
    },
    {
        id: 'number',
        label: 'At least 1 number',
        test: (value) => /[0-9]/.test(value),
        message: 'Include at least 1 number.',
    },
];

/**
 * Every requirement met? This is the gate the submit button uses, and it
 * matches what the server will accept.
 */
export const meetsPasswordPolicy = (value) =>
    PASSWORD_REQUIREMENTS.every((requirement) => requirement.test(value || ''));

/**
 * The FIRST unmet requirement, as a sentence for a field-level error message.
 * Returns '' when the password is acceptable, so callers can render
 * `{passwordError && <p>{passwordError}</p>}` without extra branching.
 */
export const passwordPolicyError = (value) => {
    if (!value) return 'A new password is required.';

    const unmet = PASSWORD_REQUIREMENTS.find((requirement) => !requirement.test(value));
    return unmet ? unmet.message : '';
};
