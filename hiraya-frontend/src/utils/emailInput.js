/*
 * EMAIL INPUT CLEANUP — shared by Register, Login and Forgot Password.
 *
 * A customer typing a perfectly valid Gmail address was told "Please enter a
 * valid email address." The address was fine; what the field held was not.
 * Phone keyboards insert things nobody can see:
 *
 *   - a space after "@" or "." (auto-spacing / autocorrect: "juan@ gmail.com")
 *   - zero-width characters from copy-paste (U+200B, U+200C, U+200D, U+2060, U+FEFF)
 *   - a no-break space at the end (U+00A0)
 *   - full-width letters from some IMEs ("ｇmail.com")
 *
 * An email address can never legitimately contain any of these, so they are
 * removed instead of reported. NFKC folds full-width letters into plain ASCII.
 * The server applies the same cleanup (AuthController::normaliseEmail), so the
 * two sides validate exactly the same string.
 */
// Built from code points so the source file itself contains no invisible characters:
// no-break space, zero-width space / non-joiner / joiner, word joiner, BOM.
const INVISIBLE = [0x00a0, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff].map((c) => String.fromCharCode(c)).join('');
const INVISIBLE_OR_SPACE = new RegExp(`[\\s${INVISIBLE}]+`, 'g');

/** The address as the customer meant it: no spaces or invisible characters. */
export const cleanEmail = (value) =>
    String(value ?? '')
        .normalize('NFKC')
        .replace(INVISIBLE_OR_SPACE, '');

/** The form the server stores and compares: cleaned + lowercase. */
export const normaliseEmail = (value) => cleanEmail(value).toLowerCase();

/*
 * Attributes that stop phone keyboards from capitalising, autocorrecting or
 * spell-checking an email field (the source of the hidden spaces above).
 */
export const EMAIL_INPUT_PROPS = {
    type: 'email',
    inputMode: 'email',
    autoComplete: 'email',
    autoCapitalize: 'none',
    autoCorrect: 'off',
    spellCheck: false,
};
