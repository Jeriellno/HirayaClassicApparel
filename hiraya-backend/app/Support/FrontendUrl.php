<?php

namespace App\Support;

use RuntimeException;

/**
 * Links that leave the server in an e-mail (admin invitations, password resets)
 * point at the FRONTEND (the SPA), whose origin comes ONLY from trusted
 * configuration: `FRONTEND_URL` (config('app.frontend_url')). Never from the
 * request's Host / Origin / X-Forwarded-* headers, which a caller controls.
 *
 *   local       FRONTEND_URL=http://localhost:5173           (http allowed)
 *   production  FRONTEND_URL=https://<deployed-frontend>     (https required)
 *
 * In production a missing, http or localhost origin is REFUSED instead of
 * mailing a link nobody outside this machine can open — the reported
 * "invitation links point to localhost" failure. The fallback to APP_URL (the
 * API host) is also refused in production: in this split deployment the API
 * host does not serve the SPA routes.
 */
class FrontendUrl
{
    private const LOCAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'];

    public static function base(): string
    {
        $raw = rtrim(trim((string) config('app.frontend_url')), '/');
        $parts = parse_url($raw) ?: [];
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));

        $isOrigin = $raw !== ''
            && in_array($scheme, ['http', 'https'], true)
            && $host !== ''
            && empty($parts['path'])
            && ! isset($parts['query'], $parts['fragment'], $parts['user']);

        if (! $isOrigin) {
            throw new RuntimeException(
                'FRONTEND_URL must be the frontend origin only, e.g. https://your-frontend.example (no path).'
            );
        }

        if (app()->isProduction()) {
            if (! config('app.frontend_url_configured')) {
                throw new RuntimeException('FRONTEND_URL is not set on this server, so e-mailed links cannot be built.');
            }
            if ($scheme !== 'https' || in_array($host, self::LOCAL_HOSTS, true)) {
                throw new RuntimeException(
                    'FRONTEND_URL must be the deployed HTTPS frontend in production (it is currently ' . $raw . ').'
                );
            }
        }

        return $raw;
    }

    /** An absolute link to a frontend route, e.g. to('/accept-invitation', [...]). */
    public static function to(string $path, array $query = []): string
    {
        return self::base() . '/' . ltrim($path, '/') . ($query ? '?' . http_build_query($query) : '');
    }
}
