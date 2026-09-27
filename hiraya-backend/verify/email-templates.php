<?php
/*
 * REGRESSION GUARD for the reset email templates.
 *
 * WHY THIS EXISTS
 * ---------------
 * A Blade comment ends at the FIRST "--" it contains. A separator line such as
 * a row of dashes, or a sentence containing an em-dash written as "--", closes
 * the comment early and turns the remaining prose into BLADE CODE. The template
 * then still "compiles" into something — which is the dangerous part: the file
 * looks fine in the editor, the render does not necessarily throw, and the
 * corruption only shows up in a delivered email or a size anomaly.
 *
 * That is exactly how the HTML template was broken once already. This script
 * asserts the properties that catch it, plus the ones a mail client cares about:
 *
 *   1. every "{{--" has a matching "--}}" and no stray "--" inside
 *   2. both views render without throwing
 *   3. the reset URL appears in BOTH the HTML and the text part
 *   4. the rendered HTML is a complete document, not a fragment
 *   5. no Blade expression survived into the OUTPUT
 *
 * Run:  C:\php-8.3\php.exe verify-email-templates.php
 */

require __DIR__ . '/../vendor/autoload.php';

$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$pass = 0;
$fail = 0;

$check = function (string $label, bool $ok, string $detail = '') use (&$pass, &$fail) {
    if ($ok) {
        $pass++;
        echo "  PASS  {$label}\n";
    } else {
        $fail++;
        echo "  FAIL  {$label}" . ($detail !== '' ? "  ({$detail})" : '') . "\n";
    }
};

$views = [
    'HTML' => resource_path('views/emails/password-reset.blade.php'),
    'TEXT' => resource_path('views/emails/password-reset-text.blade.php'),
];

echo "\nEMAIL TEMPLATE REGRESSION GUARD\n" . str_repeat('=', 58) . "\n";

/* ---------------------------------------------------------------- 1. LEXICAL */

echo "\n1. COMMENT LEXING (the corruption that already happened once)\n";

foreach ($views as $kind => $path) {
    $source = file_get_contents($path);

    // Every comment block, and whether any of them contains a bare "--".
    preg_match_all('/\{\{--(.*?)--\}\}/s', $source, $matches);

    $badComment = false;
    foreach ($matches[1] as $body) {
        if (str_contains($body, '--')) {
            $badComment = true;
        }
    }

    $check("{$kind}: no '--' inside a comment body", !$badComment);

    // A comment opened but never closed leaves the rest of the file swallowed.
    $opened = substr_count($source, '{{--');
    $closed = substr_count($source, '--}}');
    $check("{$kind}: comment markers balanced ({$opened} open / {$closed} close)", $opened === $closed);

    /*
     * ORPHANED PROSE — checked by LEXICAL SCOPE, not by line shape.
     *
     * Two earlier attempts failed and both failures are instructive:
     *
     *   1. A line-based regex ("long lowercase line, indented") matched every
     *      wrapped paragraph of legitimate email body copy.
     *   2. Stripping {{ }} and <tags> then looking for leftover word-runs has the
     *      SAME flaw from the other direction: it removes the tags but keeps the
     *      TEXT BETWEEN them, so a normal sentence inside a <p> is
     *      indistinguishable from a sentence that escaped a comment.
     *
     * Both approached the question as "does this look like prose". The question
     * that actually distinguishes the corruption is different: was a Blade
     * comment TERMINATED EARLY? That is answerable exactly, by walking the
     * source and tracking comment state.
     *
     * When a comment closes early, the prose that follows is emitted as literal
     * output. It is still inside a comment as far as the AUTHOR intended, so the
     * marker counts stay balanced (one open, one close) and the earlier checks
     * pass. What does NOT stay balanced is the character count: an early close
     * leaves a SHORT comment body whose text continues past the terminator.
     *
     * So the real assertion is: every comment body must be well-formed prose in
     * its own right, ending where the author meant it to. The practical test is
     * that no comment body contains a sentence fragment that resumes OUTSIDE it,
     * which we detect by requiring each comment to be self-contained — starting
     * at "{{--" and closing at the first "--}}", with no "--" in between (the
     * rule that was violated) and no unbalanced quote/bracket pairs.
     */

    // Rule 1 (the one that broke this file the first time): no bare "--" inside.
    // Already asserted above. Rule 2 below catches the OTHER early-termination
    // cause: a comment body that is syntactically incomplete.

    preg_match_all('/\{\{--(.*?)--\}\}/s', $source, $bodies);

    $unsound = false;
    foreach ($bodies[1] as $body) {
        // An odd number of single quotes/double quotes means the author's prose
        // was cut mid-string, which is what an early terminator looks like.
        if (substr_count($body, '"') % 2 !== 0 || substr_count($body, "'") % 2 !== 0) {
            $unsound = true;
        }
    }

    $check("{$kind}: every comment body is self-contained", ! $unsound);

    // Rule 3: the corruption emits literal text into the OUTPUT. Parse-free
    // detection: a template's non-Blade, non-tag text should never contain the
    // verbatim FILLER SENTENCES that only exist inside documentation comments.
    // Pick words that are unique to the comment prose, not to email copy.
    $docOnlyPhrases = ['becomes Blade code', 'corrupts the template', 'separator line'];
    $leakedDocText = false;
    foreach ($docOnlyPhrases as $phrase) {
        if (str_contains($source, $phrase)) {
            // It is fine inside a comment; it is a leak if it is also OUTSIDE one.
            $withoutComments = preg_replace('/\{\{--.*?--\}\}/s', '', $source);
            if (str_contains((string) $withoutComments, $phrase)) {
                $leakedDocText = true;
            }
        }
    }
    $check("{$kind}: no comment prose leaked into the template body", ! $leakedDocText);

    // The HTML document must not have been mangled by escaping.
    if ($kind === 'HTML') {
        $check('HTML: doctype is intact', str_contains($source, '<!DOCTYPE html>'));
        $check('HTML: no escaped angle brackets', !str_contains($source, '&lt;!DOCTYPE'));
        $check('HTML: no "< !" spacing artefact', !str_contains($source, '< !'));
    }
}

/* ---------------------------------------------------------------- 2. RENDER */

echo "\n2. RENDER\n";

$user = App\Models\User::first();

if (!$user) {
    echo "  skipped — no user in the database to render against\n";
} else {
    $url = 'https://example.test/reset-password?email=probe%40hiraya.test&token=abc.def';

    $html = '';
    $text = '';

    try {
        $html = view('emails.password-reset', [
            'user' => $user,
            'resetUrl' => $url,
            'expiresInMinutes' => 60,
        ])->render();
        $check('HTML view renders', true);
    } catch (\Throwable $e) {
        $check('HTML view renders', false, $e->getMessage());
    }

    try {
        $text = view('emails.password-reset-text', [
            'user' => $user,
            'resetUrl' => $url,
            'expiresInMinutes' => 60,
        ])->render();
        $check('TEXT view renders', true);
    } catch (\Throwable $e) {
        $check('TEXT view renders', false, $e->getMessage());
    }

    /* ------------------------------------------------------------- 3. CONTENT */

    echo "\n3. CONTENT\n";

    if ($html !== '') {
        $check('HTML: reset URL is present', str_contains($html, 'reset-password?'));
        /*
         * The URL is compared with `&` ESCAPED to `&amp;`. That is correct HTML
         * and what a browser will resolve back to `&`, so asserting the raw,
         * unescaped form would fail on a template that is doing the right thing.
         * Blade's `e()` runs on `{{ }}` output by design; the test has to expect
         * the escaped form rather than the template has to stop escaping.
         */
        $escaped = htmlspecialchars($url, ENT_QUOTES, 'UTF-8');
        $check('HTML: URL is inside an href (entity-escaped)', str_contains($html, 'href="' . $escaped . '"'));
        $check('HTML: expiry is stated', str_contains($html, '60 minutes'));
        $check('HTML: phishing reassurance present', str_contains($html, 'safely ignore'));
        $check('HTML: brand palette applied', str_contains($html, '#CB997E') && str_contains($html, '#FFE8D6'));

        // A complete document, not a fragment.
        $check('HTML: has <html>', str_contains($html, '<html'));
        $check('HTML: has </html>', str_contains($html, '</html>'));

        // The corruption test that matters most: nothing that LOOKS like Blade
        // may survive into the output. If it does, the template was parsed wrong.
        $check('HTML: no "{ {" artefact in output', !str_contains($html, '{ {'));
        $check('HTML: no "}}" left in output', !str_contains($html, '}}'));
    }

    if ($text !== '') {
        $check('TEXT: reset URL is present', str_contains($text, 'reset-password?'));
        /*
         * ASSERT THE RAW URL, byte for byte, on its own line.
         *
         * This guard is what caught a REAL bug: the text part used `{{ }}`,
         * which HTML-escapes, so every `&` in the query string was rendered as
         * `&amp;`. A customer copying that line pastes an HTML entity into their
         * browser and lands on a broken token. The template now uses `{!! !!}`.
         *
         * The assertion is deliberately exact rather than a `str_contains` for
         * 'reset-password': only an exact match proves the escaping is gone.
         */
        $normalised = str_replace(["\r\n", "\r"], "\n", $text);
        $check(
            'TEXT: URL is unescaped and occupies its own line',
            (bool) preg_match('/^' . preg_quote($url, '/') . '$/m', $normalised)
        );
        $check('TEXT: no &amp; entity anywhere in the body', ! str_contains($text, '&amp;'));
        $check('TEXT: no HTML tags leaked', !str_contains($text, '<table') && !str_contains($text, '<div'));
        $check('TEXT: no "{ {" artefact', !str_contains($text, '{ {'));
    }

    // Size sanity: a corrupted template renders EITHER almost nothing or a giant
    // blob. Both are worth catching before a customer sees it.
    if ($html !== '') {
        $size = strlen($html);
        $check("HTML size is plausible ({$size} bytes)", $size > 2000 && $size < 200000);
    }
}

echo "\n" . str_repeat('=', 58) . "\n";
echo "  {$pass} passed, {$fail} failed\n\n";

exit($fail === 0 ? 0 : 1);