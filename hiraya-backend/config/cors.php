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

    'allowed_origins' => ['*'], // Gawing wildcard muna para tanggapin ang kahit anong port/host

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    'supports_credentials' => false, // Set to false kapag wildcard '*' ang allowed_origins

];
