<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your settings for cross-origin resource sharing
    | or "CORS". This determines what cross-origin operations may execute
    | in web browsers. You are free to adjust these settings as needed.
    |
    | To learn more: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
    |
    */

    /*
     * `vendor/imgly/*` MUST be listed here.
     *
     * The in-browser background-removal engine fetches its ONNX model + WASM
     * runtime from the backend's `public/vendor/imgly/` directory. The SPA runs
     * on a different origin (localhost:5173) than the API (127.0.0.1:8000), so
     * those are cross-origin requests. Because this path sat outside the CORS
     * config, the browser blocked every asset fetch —
     *
     *   Access to fetch at '.../vendor/imgly/resources.json' from origin
     *   'http://localhost:5173' has been blocked by CORS policy
     *
     * which made background removal fail immediately and keep the admin's
     * original photo. The assets are plain static files, so allowing GET here
     * exposes nothing that is not already public.
     */
    'paths' => ['api/*', 'sanctum/csrf-cookie', 'vendor/imgly/*'],

    'allowed_methods' => ['*'],

    /*
     * Set CORS_ALLOWED_ORIGINS (comma-separated, e.g.
     * "https://hiraya.example,https://console.hiraya.example") in production.
     * Unset keeps the wildcard for local / LAN demos; auth is a bearer token,
     * not a cookie, so the wildcard never exposes a session on its own.
     */
    'allowed_origins' => array_values(array_filter(array_map('trim', explode(',', (string) env('CORS_ALLOWED_ORIGINS', '*'))))),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    'supports_credentials' => false, // Set to false kapag wildcard '*' ang allowed_origins

];
