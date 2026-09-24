<?php

namespace App\Providers;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureHttpCaBundle();
    }

    /**
     * Point every outbound HTTPS request at an explicit CA bundle.
     *
     * WHY THIS EXISTS
     * ---------------
     * On a Windows PHP install (XAMPP/Laragon/Herd/standalone), php.ini often
     * leaves `curl.cainfo` / `openssl.cafile` empty. cURL then has NO trust
     * store, and EVERY outbound TLS call fails with:
     *
     *   cURL error 60: SSL certificate ... unable to get local issuer
     *   certificate (20)
     *
     * This is not specific to one service — it broke the Gemini garment
     * analysis (`analyze-image`) AND the Supabase Storage uploads/deletes at the
     * same time, and the Gemini path mis-reported it as a bogus 504 "took too
     * long". A retry cannot fix a trust-store problem; only supplying a real CA
     * bundle can.
     *
     * Setting `HTTP_CA_BUNDLE` in .env to a `cacert.pem` path fixes it for every
     * `Http::` call at once, WITHOUT editing php.ini or disabling verification.
     * The `verify` option is only overridden when the file actually exists, so
     * an unset/mistyped value changes nothing and production is untouched.
     *
     * READ VIA config(), NOT env(): under `php artisan config:cache` (the
     * production path) `env()` returns null outside the config/*.php files, so
     * reading the variable directly here silently dropped the bundle and every
     * TLS call failed with "cURL error 60". The value is declared in
     * config/services.php (`http.ca_bundle`) precisely so it survives caching.
     */
    private function configureHttpCaBundle(): void
    {
        $caBundle = config('services.http.ca_bundle');

        if (empty($caBundle)) {
            return;
        }

        /*
         * `.env` values are usually written relative to the project root
         * (`storage/certs/cacert.pem`), which is NOT the process working
         * directory, so resolve relative paths against base_path() first.
         */
        if (!$this->isAbsolutePath($caBundle)) {
            $caBundle = base_path($caBundle);
        }

        if (!is_file($caBundle)) {
            return;
        }

        Http::globalOptions([
            'verify' => $caBundle,
        ]);
    }

    /**
     * Windows drive paths (C:\...), UNC paths (\\server\share) and POSIX
     * absolute paths (/x) are all treated as already-absolute.
     *
     * Deliberately NOT a regex: an earlier attempt used a `/`-delimited
     * pattern containing a literal `/`, which PCRE read as the closing
     * delimiter and exploded with "Unknown modifier ']'". That ran inside
     * boot(), so it 500'd EVERY request. Plain string checks cannot fail
     * that way.
     */
    private function isAbsolutePath(string $path): bool
    {
        // UNC path, e.g. \\server\share
        if (str_starts_with($path, '\\\\')) {
            return true;
        }

        // POSIX absolute path, e.g. /var/www
        if (str_starts_with($path, '/')) {
            return true;
        }

        // Windows drive path, e.g. C:\xampp or C:/xampp
        if (strlen($path) >= 3 && ctype_alpha($path[0]) && $path[1] === ':') {
            return $path[2] === '\\' || $path[2] === '/';
        }

        return false;
    }
}
