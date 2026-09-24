<?php

use Illuminate\Foundation\Application;
use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

/*
 * SERVE EXISTING STATIC FILES DIRECTLY (PHP's built-in dev server only).
 *
 * The dev server is started as
 *
 *   php -S 127.0.0.1:8000 -t public/index.php
 *
 * and passing a ROUTER SCRIPT makes PHP send EVERY request here — including
 * `/storage/catalog/<file>.jpg`. That route does not exist in Laravel, so each
 * catalog image answered 403 and every product card rendered the "NO IMAGE"
 * placeholder (the files were sitting on disk the whole time).
 *
 * Returning `false` tells the built-in server "this is a real file, serve it
 * yourself". That is exactly the rule the production `.htaccess` already
 * applies with `RewriteCond %{REQUEST_FILENAME} !-f`, so dev and production
 * now agree on what `/storage/...` means.
 *
 * Guarded to the CLI server: under FPM/Apache the request is already resolved
 * against the filesystem before this file is reached, and `false` as a router
 * return value is meaningless there.
 */
if (PHP_SAPI === 'cli-server') {
    $requested = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

    /*
     * Resolve the request INSIDE `public/` and refuse anything that escapes it
     * (`/../`, encoded traversal). The check is done on the UNRESOLVED path.
     *
     * It must NOT be done on `realpath()`: `public/storage` is a JUNCTION to
     * `storage/app/public`, so realpath() rewrites
     * `public/storage/catalog/x.jpg` into `storage/app/public/catalog/x.jpg`,
     * which no longer starts with the `public/` root and was rejected — the
     * guard silently fell through to Laravel and the image 403'd anyway.
     * The lexical path is what actually lives under the docroot.
     */
    $candidate = __DIR__ . $requested;
    $publicRoot = __DIR__ . DIRECTORY_SEPARATOR;

    if (
        is_file($candidate)
        && str_starts_with(str_replace('\\', '/', $candidate), str_replace('\\', '/', $publicRoot))
    ) {
        return false;
    }
}

// Determine if the application is in maintenance mode...
if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

// Register the Composer autoloader...
require __DIR__.'/../vendor/autoload.php';

// Bootstrap Laravel and handle the request...
/** @var Application $app */
$app = require_once __DIR__.'/../bootstrap/app.php';

$app->handleRequest(Request::capture());
