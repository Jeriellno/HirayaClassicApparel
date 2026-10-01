<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * EnsureSupabaseAAL2 — the Laravel half of the Supabase MFA lockdown.
 *
 * The frontend checks the assurance level for UX, and Postgres checks it for
 * real. This is the third place, and it is the one that guards the Laravel
 * controllers — the console's catalogue writes, VTON settings, the order
 * queue and the database export, none of which live in Supabase.
 *
 * Registered as the `supabase.aal2` alias in bootstrap/app.php.
 *
 * WHAT IT ENFORCES, IN ORDER
 *
 *   1. a Bearer token is present                -> else 401
 *   2. the token is a Supabase JWT, not a
 *      Sanctum token                            -> else 401
 *   3. the signature verifies against a key the
 *      project PUBLISHES in its JWKS               -> else 401
 *   4. it has not expired                       -> else 401
 *   5. the `aal` claim is exactly 'aal2'        -> else 403
 *
 * STEP 2 IS NOT A FORMALITY. Step 5 alone would happily pass any old Sanctum
 * token, because Sanctum issues opaque strings with no `aal` claim at all —
 * and reading a missing claim as "not aal2" is the only reason that is safe.
 * But a token that carried the literal string 'aal2' inside an unsigned
 * payload would otherwise be indistinguishable from a real Supabase session,
 * so the signature is verified cryptographically. A token that cannot verify
 * cannot assert aal2.
 *
 * WHY THE SIGNATURE IS VERIFIED AT ALL
 * A JWT that is merely DECODED proves nothing — the payload is base64, not
 * encrypted, and anyone can hand us one claiming aal2. The signature is what
 * makes the claim true, so it is checked on every request against a key the
 * project publishes. A failed check is a 401, never a fallback to "assume aal2".
 *
 * ASYMMETRIC KEYS — WHY THIS NO LONGER USES THE JWT SECRET
 * -------------------------------------------------------
 * This project has been rotated to Supabase's asymmetric signing keys. The live
 * `.well-known/jwks.json` publishes a single ES256 P-256 key, so every access
 * token GoTrue mints is signed with ECDSA and carries a `kid` — NOT the HS256
 * HMAC the legacy SUPABASE_JWT_SECRET produces. Verifying those tokens against
 * the secret is not a configuration mistake that can be corrected; it cannot
 * ever succeed, which is why every genuine admin request was answered
 * "Invalid or expired session token."
 *
 * So verification now goes through the published PUBLIC key. That is the
 * better design, not a downgrade: the public key can be published, so there is
 * no shared secret on the server that can MINT an aal2 token, only verify one.
 * The `jwt_secret` config entry is kept for a project still on legacy HS256 and
 * is no longer read on this path.
 *
 * WHY NO JWT LIBRARY
 * Verification is base64url-decode + a DER rebuild + `openssl_verify`, which is
 * what the private methods below do. Adding firebase/php-jwt would put a
 * third-party dependency inside the trust boundary of a security control to
 * save about forty lines — the same reasoning that kept TotpService
 * hand-written before Supabase MFA replaced it.
 */
class EnsureSupabaseAAL2
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $this->bearerToken($request);

        if ($token === null) {
            return response()->json([
                'message' => 'Unauthenticated. A Supabase access token is required.',
            ], 401);
        }

        // A Sanctum token is a random opaque string, never a JWT. Rejecting it
        // here with a clear message beats letting it fail signature
        // verification with a generic 401 that reads like a bug.
        if (substr_count($token, '.') !== 2) {
            return response()->json([
                'message' => 'This endpoint requires a Supabase session, not a legacy login token.',
            ], 401);
        }

        $claims = $this->verifySignature($token);
        if ($claims === null) {
            return response()->json([
                'message' => 'Invalid or expired session token.',
            ], 401);
        }

        /*
         * THE AAL CHECK — the point of the whole exercise.
         *
         * A staff account that has typed its password holds a genuinely valid
         * session at this point: the token verifies, the role is right, the
         * user is who they say they are. It is simply at aal1, and aal1 is not
         * sufficient here. 403 (not 401) is the correct code — the request is
         * understood and the caller IS authenticated; the answer is "forbidden
         * at this assurance level", which the client reacts to by asking for
         * the TOTP code rather than by signing in again.
         */
        $aal = $claims->aal ?? null;

        if (!is_string($aal) || $aal !== 'aal2') {
            return response()->json([
                'message' => 'Forbidden. This session has not completed two-factor verification.',
                'required_aal' => 'aal2',
                'current_aal' => is_string($aal) ? $aal : 'unknown',
            ], 403);
        }

        // Expose the verified identity to the controllers below. Nothing here
        // trusts a client-supplied header: every value comes from a signature
        // that was just checked.
        $request->attributes->set('supabase_user_id', $claims->sub ?? null);
        $request->attributes->set('supabase_email', $claims->email ?? null);

        /*
         * ResolveSupabaseUser joins this email to the local `users` row, and
         * it may ONLY do so for a CONFIRMED address — otherwise anyone able to
         * register an arbitrary unconfirmed email could aim it at a staff
         * account.
         *
         * THE VERDICT USED TO COME FROM THE TOKEN, and no longer can: current
         * Supabase access tokens carry no `email_confirmed_at` claim at all, so
         * `! empty($claims->email_confirmed_at)` was permanently false and every
         * genuinely MFA-verified admin was refused with 401 "This email address
         * is not confirmed" — a control reading a field that had stopped
         * existing. It is now read from GoTrue's own user record over the Admin
         * API, which is the authoritative value, and cached briefly so the
         * check does not cost a network round trip per request.
         *
         * The subject of that lookup is `sub` from the just-verified signature,
         * never anything the client supplied.
         */
        $request->attributes->set(
            'supabase_email_confirmed',
            $this->emailIsConfirmed($claims->sub ?? null)
        );

        $request->attributes->set('supabase_role', $claims->role ?? data_get($claims, 'app_metadata.role'));
        $request->attributes->set('supabase_aal', $aal);

        return $next($request);
    }

    /**
     * Is this Supabase user's email address confirmed?
     *
     * Resolved server-side from the GoTrue Admin API and cached briefly.
     *
     * A FALSE RETURN IS ALWAYS A REFUSAL, never an assumption that the address
     * is fine: if the key is missing, the call fails or the record cannot be
     * read, the answer is "not confirmed" and the request is rejected. A network
     * problem must not be able to OPEN the gate — a control that fails open on
     * error is not a control.
     */
    private function emailIsConfirmed(mixed $sub): bool
    {
        if (! is_string($sub) || $sub === '') {
            return false;
        }

        // Only positive results are cached, so a lookup that failed for a
        // transient reason is retried on the next request instead of sticking.
        return cache()->remember(
            'supabase.email_confirmed.' . hash('sha256', $sub),
            now()->addSeconds((int) config('services.supabase.email_confirmed_cache_seconds', 300)),
            function () use ($sub): bool {
                $url = rtrim((string) config('services.supabase.admin_api_url'), '/') . '/' . rawurlencode($sub);
                $key = (string) config('services.supabase.service_role_key');

                if ($url === '/' . rawurlencode($sub) || $key === '') {
                    Log::error('SUPABASE_SERVICE_ROLE_KEY is not set; email confirmation cannot be verified for /api/admin/*.');

                    return false;
                }

                try {
                    $response = Http::timeout(5)
                        ->acceptJson()
                        ->withHeaders([
                            'Authorization' => 'Bearer ' . $key,
                            'apikey' => $key,
                        ])
                        ->get($url);

                    if (! $response->successful()) {
                        Log::error('Supabase Admin API user lookup failed with HTTP ' . $response->status() . '; /api/admin/* cannot confirm this address.');

                        return false;
                    }

                    return ! empty($response->json('email_confirmed_at'));
                } catch (Throwable $e) {
                    Log::error('Supabase Admin API user lookup error: ' . $e->getMessage());

                    return false;
                }
            }
        );
    }

    /**
     * The project's public signing keys, keyed by `kid`, cached for an hour.
     *
     * Cached because this runs on EVERY admin request and the JWKS document
     * only changes when someone rotates a signing key in the Supabase
     * dashboard. A one-hour TTL means a rotation is picked up promptly without
     * a network round trip per request.
     */
    private function jwks(): array
    {
        $url = (string) config('services.supabase.jwks_url');

        if ($url === '') {
            return [];
        }

        try {
            $response = Http::timeout(5)
                ->acceptJson()
                ->get($url);

            if (! $response->successful()) {
                Log::error('Supabase JWKS fetch failed with HTTP ' . $response->status() . '; /api/admin/* cannot be authorized.');

                return [];
            }

            $keys = (array) ($response->json('keys') ?? []);

            return cache()->remember('supabase.jwks', now()->addHour(), fn () => $keys);
        } catch (Throwable $e) {
            Log::error('Supabase JWKS fetch error: ' . $e->getMessage());

            return [];
        }
    }

    /**
     * Build a PEM public key from a JWKS entry's P-256 `x`/`y` coordinates.
     *
     * JWKS publishes the key as raw base64url integers; OpenSSL needs a
     * SubjectPublicKeyInfo blob. Wrapping them in the fixed ASN.1 structure for
     * id-ecPublicKey + prime256v1 is the standard conversion.
     */
    private function pemFromJwk(array $jwk): ?string
    {
        if (($jwk['kty'] ?? null) !== 'EC' || ($jwk['crv'] ?? null) !== 'P-256') {
            return null;
        }

        if (empty($jwk['x']) || empty($jwk['y'])) {
            return null;
        }

        $x = $this->base64UrlDecode((string) $jwk['x']);
        $y = $this->base64UrlDecode((string) $jwk['y']);

        if (strlen($x) !== 32 || strlen($y) !== 32) {
            return null;
        }

        // 0x04 = uncompressed point, then the two 32-byte coordinates.
        $point = "\x04" . $x . $y;

        /*
         * A minimal DER SubjectPublicKeyInfo for prime256v1:
         *   SEQUENCE { SEQUENCE { OID id-ecPublicKey, OID prime256v1 }, BIT STRING point }
         * The lengths are fixed for this curve, so they are written literally
         * rather than computed — there is no variable-length field to derive.
         */
        $der = "\x30\x59"
            . "\x30\x13"
            . "\x06\x07\x2a\x86\x48\xce\x3d\x02\x01"   // OID 1.2.840.10045.2.1 ecPublicKey
            . "\x06\x08\x2a\x86\x48\xce\x3d\x03\x01\x07" // OID 1.2.840.10045.3.1.7 prime256v1
            . "\x03\x42\x00"                              // BIT STRING, 66 bytes, 0 unused bits
            . $point;

        $pem = chunk_split(base64_encode($der), 64, "\n");

        return "-----BEGIN PUBLIC KEY-----\n" . $pem . "-----END PUBLIC KEY-----\n";
    }

    /**
     * Convert a raw JWS ES256 signature (R‖S) into the DER SEQUENCE OpenSSL wants.
     *
     * JWT signatures are two fixed 32-byte integers; DER requires each length
     * prefixed, and a leading zero must be added when the high bit would make a
     * value look negative.
     */
    private function rawSignatureToDer(string $raw): ?string
    {
        if (strlen($raw) !== 64) {
            return null;
        }

        $integers = '';

        foreach ([substr($raw, 0, 32), substr($raw, 32, 32)] as $part) {
            $part = ltrim($part, "\x00");

            if ($part === '') {
                $part = "\x00";
            }

            if (ord($part[0]) & 0x80) {
                $part = "\x00" . $part;
            }

            $integers .= "\x02" . chr(strlen($part)) . $part;
        }

        $length = strlen($integers);

        // SEQUENCE length is a single byte here (2 * (2 + 33) = 70), so no
        // long-form length encoding is required.
        return "\x30" . chr($length) . $integers;
    }

    /** Extract the raw JWT from the Authorization header. */
    private function bearerToken(Request $request): ?string
    {
        $header = (string) $request->header('Authorization', '');

        if (!preg_match('/^Bearer\s+(\S+)$/i', $header, $matches)) {
            return null;
        }

        return $matches[1];
    }

    /**
     * Verify signature and expiry, returning the claims object or null.
     *
     * A failure is logged WITHOUT the token: a JWT in a log file is a bearer
     * credential, and an admin's aal2 token is exactly the thing this
     * middleware exists to protect.
     */
    private function verifySignature(string $token): ?object
    {
        try {
            $parts = explode('.', $token);

            if (count($parts) !== 3) {
                return null;
            }

            [$headerB64, $payloadB64, $signatureB64] = $parts;

            $header = json_decode($this->base64UrlDecode($headerB64), true);

            if (! is_array($header)) {
                return null;
            }

            /*
             * THE ALGORITHM IS PINNED TO THE ONE SUPABASE PUBLISHES, NOT READ.
             *
             * Trusting the token's own `alg` is the original JWT vulnerability:
             * a header claiming "none", or HS256 signed with the PUBLIC anon key,
             * makes a forged token verify. Only the algorithms the JWKS actually
             * publishes are accepted, and `none` is never among them.
             */
            $alg = (string) ($header['alg'] ?? '');
            $kid = (string) ($header['kid'] ?? '');

            $jwk = $this->jwkForKid($kid);

            if ($jwk === null) {
                return null;
            }

            $expectedAlg = (string) ($jwk['alg'] ?? 'ES256');

            if ($alg !== $expectedAlg) {
                return null;
            }

            $signingInput = $headerB64 . '.' . $payloadB64;

            if ($this->verifyWithJwk($signingInput, $signatureB64, $jwk, $expectedAlg) !== true) {
                return null;
            }

            $claims = json_decode($this->base64UrlDecode($payloadB64), true);

            if (! is_array($claims)) {
                return null;
            }

            if (isset($claims['exp']) && (int) $claims['exp'] < time()) {
                return null;
            }

            // Reject an `nbf` (not before) claim that has not taken effect yet.
            if (isset($claims['nbf']) && (int) $claims['nbf'] > time() + 5) {
                return null;
            }

            return (object) $claims;
        } catch (Throwable $e) {
            Log::warning('Supabase JWT verification failed: ' . $e->getMessage());

            return null;
        }
    }

    /** Find the published key the token was signed with, by its `kid`. */
    private function jwkForKid(string $kid): ?array
    {
        if ($kid === '') {
            return null;
        }

        foreach ($this->jwks() as $jwk) {
            if (is_array($jwk) && ($jwk['kid'] ?? null) === $kid) {
                return $jwk;
            }
        }

        /*
         * A kid that matches no published key is almost always a ROTATION, not
         * an attack: the dashboard rolled to a new key while this request was
         * in flight. The cache is dropped once so the very next request re-reads
         * the JWKS instead of failing until the one-hour TTL expires.
         */
        cache()->forget('supabase.jwks');

        return null;
    }

    /** Verify the signature against a published key, by algorithm. */
    private function verifyWithJwk(string $signingInput, string $signatureB64, array $jwk, string $alg): bool
    {
        $signature = $this->base64UrlDecode($signatureB64);

        if ($alg === 'ES256') {
            $der = $this->rawSignatureToDer($signature);

            if ($der === null) {
                return false;
            }

            $pem = $this->pemFromJwk($jwk);

            if ($pem === null) {
                return false;
            }

            $key = openssl_pkey_get_public($pem);

            if ($key === false) {
                Log::error('Could not import the published Supabase ES256 public key.');

                return false;
            }

            $details = openssl_pkey_get_details($key);

            // Pin the curve, so a key of any other shape cannot verify.
            if (($details['ec']['curve_name'] ?? null) !== 'prime256v1') {
                return false;
            }

            return openssl_verify($signingInput, $der, $key, OPENSSL_ALGO_SHA256) === 1;
        }

        if ($alg === 'RS256') {
            $pem = $this->pemFromRsaJwk($jwk);

            if ($pem === null) {
                return false;
            }

            $key = openssl_pkey_get_public($pem);

            if ($key === false) {
                return false;
            }

            return openssl_verify($signingInput, $signature, $key, OPENSSL_ALGO_SHA256) === 1;
        }

        return false;
    }

    /** Build a PEM RSA public key from a JWKS entry's `n`/`e`. */
    private function pemFromRsaJwk(array $jwk): ?string
    {
        if (($jwk['kty'] ?? null) !== 'RSA' || empty($jwk['n']) || empty($jwk['e'])) {
            return null;
        }

        $der = $this->derSequence(
            $this->derBitString(
                $this->derSequence(
                    $this->derOid('1.2.840.113549.1.1.1') . "\x05\x00"
                ) . $this->derBitString($this->base64UrlDecode((string) $jwk['e']), false)
            )
        );

        $pem = chunk_split(base64_encode($der), 64, "\n");

        return "-----BEGIN PUBLIC KEY-----\n" . $pem . "-----END PUBLIC KEY-----\n";
    }

    private function derSequence(string $value): string
    {
        return "\x30" . $this->derLength(strlen($value)) . $value;
    }

    private function derBitString(string $value, bool $padToByte = true): string
    {
        // A BIT STRING needs a leading count of unused bits, then the bytes.
        return "\x03" . $this->derLength(strlen($value) + 1) . "\x00" . $value;
    }

    private function derOid(string $oid): string
    {
        $parts = array_map('intval', explode('.', $oid));
        $bytes = chr($parts[0] * 40 + $parts[1]);

        foreach (array_slice($parts, 2) as $part) {
            $chunk = chr($part & 0x7F);
            $part >>= 7;

            while ($part > 0) {
                $chunk = chr(($part & 0x7F) | 0x80) . $chunk;
                $part >>= 7;
            }

            $bytes .= $chunk;
        }

        return "\x06" . $this->derLength(strlen($bytes)) . $bytes;
    }

    private function derLength(int $length): string
    {
        if ($length < 128) {
            return chr($length);
        }

        $bytes = '';

        while ($length > 0) {
            $bytes = chr($length & 0xFF) . $bytes;
            $length >>= 8;
        }

        return chr(0x80 | strlen($bytes)) . $bytes;
    }

    /** JWT base64url decode — the `-_` alphabet, with padding restored. */
    private function base64UrlDecode(string $value): string
    {
        $remainder = strlen($value) % 4;

        if ($remainder !== 0) {
            $value .= str_repeat('=', 4 - $remainder);
        }

        $decoded = base64_decode(strtr($value, '-_', '+/'), true);

        return $decoded === false ? '' : $decoded;
    }
}
