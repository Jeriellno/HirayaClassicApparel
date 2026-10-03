<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Application Name
    |--------------------------------------------------------------------------
    |
    | This value is the name of your application, which will be used when the
    | framework needs to place the application's name in a notification or
    | other UI elements where an application name needs to be displayed.
    |
    */

    'name' => env('APP_NAME', 'Laravel'),

    /*
    |--------------------------------------------------------------------------
    | Application Environment
    |--------------------------------------------------------------------------
    |
    | This value determines the "environment" your application is currently
    | running in. This may determine how you prefer to configure various
    | services the application utilizes. Set this in your ".env" file.
    |
    */

    'env' => env('APP_ENV', 'production'),

    /*
    |--------------------------------------------------------------------------
    | Application Debug Mode
    |--------------------------------------------------------------------------
    |
    | When your application is in debug mode, detailed error messages with
    | stack traces will be shown on every error that occurs within your
    | application. If disabled, a simple generic error page is shown.
    |
    */

    'debug' => (bool) env('APP_DEBUG', false),

    /*
    |--------------------------------------------------------------------------
    | Application URL
    |--------------------------------------------------------------------------
    |
    | This URL is used by the console to properly generate URLs when using
    | the Artisan command line tool. You should set this to the root of
    | the application so that it's available within Artisan commands.
    |
    */

    'url' => env('APP_URL', 'http://localhost'),

    /*
     * The frontend's public origin. Password-reset links are built from this, NOT
     * from APP_URL: in a split deployment the API host and the SPA host differ, and
     * a reset link pointing at the API returns JSON instead of the reset form.
     * Falls back to APP_URL so a single-host deployment needs no extra setting.
     */
    'frontend_url' => env('FRONTEND_URL', env('APP_URL', 'http://localhost')),

    // Whether FRONTEND_URL is set explicitly. Production refuses to e-mail links
    // built from the APP_URL fallback (the API host does not serve the SPA).
    'frontend_url_configured' => filled(env('FRONTEND_URL')),

    /*
     * DEV AUTH BYPASS — OPT-IN, OFF BY DEFAULT.
     *
     * Used ONLY by the Super Admin console controllers, which are otherwise
     * gated on a superadmin token. The console is sometimes developed on a
     * machine with no Supabase session available, and this flag lets those write
     * paths work there.
     *
     * WHY IT DEFAULTS TO FALSE, AND WHY IT IS NOT `!isProduction()`
     * -------------------------------------------------------------------
     * The controllers previously computed this inline as `!app()->isProduction()`.
     * That is a NEGATIVE test, so it was TRUE — bypass ON — for `local`,
     * `testing`, `staging`, `development`, a misspelling such as `prodution`, and
     * any deployment that left `APP_ENV` unset or empty. Only the exact string
     * `production` disabled it.
     *
     * `AdminAccountController` provisions, promotes and revokes staff accounts,
     * so in every one of those environments the `isSuperAdmin` guard silently
     * stopped applying. A flag that must be set DELIBERATELY means forgetting
     * about it fails closed (the console asks for a token) rather than open.
     *
     * The flag is ALSO ignored when the app is in production (see the
     * controllers), so setting it there cannot re-open the hole.
     */
    'allow_dev_auth_bypass' => (bool) env('ALLOW_DEV_AUTH_BYPASS', false),

    /*
    |--------------------------------------------------------------------------
    | Application Timezone
    |--------------------------------------------------------------------------
    |
    | Here you may specify the default timezone for your application, which
    | will be used by the PHP date and date-time functions. The timezone
    | is set to "UTC" by default as it is suitable for most use cases.
    |
    */

    'timezone' => 'UTC',

    /*
    |--------------------------------------------------------------------------
    | Application Locale Configuration
    |--------------------------------------------------------------------------
    |
    | The application locale determines the default locale that will be used
    | by Laravel's translation / localization methods. This option can be
    | set to any locale for which you plan to have translation strings.
    |
    */

    'locale' => env('APP_LOCALE', 'en'),

    'fallback_locale' => env('APP_FALLBACK_LOCALE', 'en'),

    'faker_locale' => env('APP_FAKER_LOCALE', 'en_US'),

    /*
    |--------------------------------------------------------------------------
    | Encryption Key
    |--------------------------------------------------------------------------
    |
    | This key is utilized by Laravel's encryption services and should be set
    | to a random, 32 character string to ensure that all encrypted values
    | are secure. You should do this prior to deploying the application.
    |
    */

    'cipher' => 'AES-256-CBC',

    'key' => env('APP_KEY'),

    'previous_keys' => [
        ...array_filter(
            explode(',', (string) env('APP_PREVIOUS_KEYS', ''))
        ),
    ],

    /*
    |--------------------------------------------------------------------------
    | Maintenance Mode Driver
    |--------------------------------------------------------------------------
    |
    | These configuration options determine the driver used to determine and
    | manage Laravel's "maintenance mode" status. The "cache" driver will
    | allow maintenance mode to be controlled across multiple machines.
    |
    | Supported drivers: "file", "cache"
    |
    */

    'maintenance' => [
        'driver' => env('APP_MAINTENANCE_DRIVER', 'file'),
        'store' => env('APP_MAINTENANCE_STORE', 'database'),
    ],

];
