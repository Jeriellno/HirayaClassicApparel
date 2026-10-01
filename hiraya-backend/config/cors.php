<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your settings for cross-origin resource sharing
    | or "CORS". This determines what cross-origin operations may execute
    | in web browsers.
    |
    */

    /*
    | Pinapayagan ang lahat ng API routes, authentication endpoints, 
    | at ang static assets para sa imgly background-removal engine.
    */
    'paths' => [
        'api/*',
        'login',
        'logout',
        'register',
        'sanctum/csrf-cookie',
        'vendor/imgly/*',
    ],

    'allowed_methods' => ['*'],

    /*
    | Kunin ang frontend URL mula sa .env o Render environment variables.
    | May fallback din sa local dev at production Render URLs.
    */
    'allowed_origins' => array_filter([
        env('FRONTEND_URL', 'https://hirayaclassicapparel-1.onrender.com'),
        'https://hirayaclassicapparel-1.onrender.com',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:3000',
    ]),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    'supports_credentials' => true,

];