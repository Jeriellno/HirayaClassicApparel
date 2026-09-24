<?php

use Illuminate\Support\Str;

/*
 * `PDO::ATTR_TIMEOUT` is used by the pgsql connection below to bound the
 * libpq connect handshake. The class is only present when the pdo extension
 * is loaded, so fall back to the documented constant value instead of
 * hard-crashing config loading on an environment without PDO (e.g. a CI
 * container that only runs `artisan config:cache`).
 */
if (! defined('PDO::ATTR_TIMEOUT')) {
    define('PDO::ATTR_TIMEOUT', 2);
}

return [

    /*
    |--------------------------------------------------------------------------
    | Default Database Connection Name
    |--------------------------------------------------------------------------
    |
    | Here you may specify which of the database connections below you wish
    | to use as your default connection for database operations.
    |
    */

    'default' => env('DB_CONNECTION', 'pgsql'),

    /*
    |--------------------------------------------------------------------------
    | Database Connections
    |--------------------------------------------------------------------------
    |
    | Below are all of the database connections defined for your application.
    |
    */

    'connections' => [

        'sqlite' => [
            'driver' => 'sqlite',
            'url' => env('DB_URL'),
            'database' => env('DB_DATABASE', database_path('database.sqlite')),
            'prefix' => '',
            'foreign_key_constraints' => env('DB_FOREIGN_KEYS', true),
            'busy_timeout' => null,
            'journal_mode' => null,
            'synchronous' => null,
            'transaction_mode' => 'DEFERRED',
        ],

        'pgsql' => [
            'driver' => 'pgsql',
            'url' => env('DB_URL'),
            'host' => env('DB_HOST', '127.0.0.1'),
            'port' => env('DB_PORT', '5432'),
            'database' => env('DB_DATABASE', 'forge'),
            'username' => env('DB_USERNAME', 'forge'),
            'password' => env('DB_PASSWORD', ''),
            'charset' => env('DB_CHARSET', 'utf8'),
            'prefix' => '',
            'prefix_indexes' => true,
            'search_path' => env('DB_SEARCH_PATH', 'public'),
            // Supabase requires TLS. 'require' is correct for the pooler;
            // set DB_SSLMODE=prefer if you ever run a local Postgres.
            'sslmode' => env('DB_SSLMODE', 'require'),

            /*
             * CONNECTION / STATEMENT WATCHDOG — stops a slow pooler from
             * wedging the whole dev server.
             *
             * WHY THIS EXISTS
             * ---------------
             * The Supabase pooler (ap-southeast-1) can be cold, throttled or
             * asleep. Measured from a fresh process it took ~2.4s to CONNECT
             * and ~600-900ms for a no-op `SELECT 1`, i.e. every query carried
             * most of a second of latency.
             *
             * `php artisan serve` is SINGLE-THREADED: it handles exactly one
             * request at a time. A handful of sequential slow queries is enough
             * to hold that one slot for longer than the SPA's Axios timeout, so
             * every parallel request the browser had open (/products, /cart,
             * /notifications, the try-on poller) queued behind it and ALL of
             * them failed with "timed out after 15000ms" — including endpoints
             * that were perfectly healthy.
             *
             * With an explicit connect timeout the driver gives up instead of
             * blocking forever, Eloquent throws a catchable QueryException, the
             * request returns a fast 500 instead of hanging, and the server's
             * single slot is released for the next request.
             *
             * `options` is passed straight to libpq via PDO::pgsql. `connect_timeout`
             * is a libpq connection parameter; `statement_timeout` is a PostgreSQL
             * server-side GUC that kills any single query exceeding the budget.
             */
            'options' => array_filter([
                // Seconds libpq waits for the TCP/auth handshake before aborting.
                PDO::ATTR_TIMEOUT => (int) env('DB_CONNECT_TIMEOUT', 10),
            ], static fn ($v) => $v !== null),

            // libpq connect_timeout (seconds) — also applied to the raw DSN.
            'connect_timeout' => (int) env('DB_CONNECT_TIMEOUT', 10),
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Migration Repository Table
    |--------------------------------------------------------------------------
    */

    'migrations' => [
        'table' => 'migrations',
        'update_date_on_publish' => true,
    ],

    /*
    |--------------------------------------------------------------------------
    | Redis Databases
    |--------------------------------------------------------------------------
    */

    'redis' => [

        'client' => env('REDIS_CLIENT', 'phpredis'),

        'options' => [
            'cluster' => env('REDIS_CLUSTER', 'redis'),
            'prefix' => env('REDIS_PREFIX', Str::slug((string) env('APP_NAME', 'laravel')).'-database-'),
            'persistent' => env('REDIS_PERSISTENT', false),
        ],

        'default' => [
            'url' => env('REDIS_URL'),
            'host' => env('REDIS_HOST', '127.0.0.1'),
            'username' => env('REDIS_USERNAME'),
            'password' => env('REDIS_PASSWORD'),
            'port' => env('REDIS_PORT', '6379'),
            'database' => env('REDIS_DB', '0'),
            'max_retries' => env('REDIS_MAX_RETRIES', 3),
            'backoff_algorithm' => env('REDIS_BACKOFF_ALGORITHM', 'decorrelated_jitter'),
            'backoff_base' => env('REDIS_BACKOFF_BASE', 100),
            'backoff_cap' => env('REDIS_BACKOFF_CAP', 1000),
        ],

        'cache' => [
            'url' => env('REDIS_URL'),
            'host' => env('REDIS_HOST', '127.0.0.1'),
            'username' => env('REDIS_USERNAME'),
            'password' => env('REDIS_PASSWORD'),
            'port' => env('REDIS_PORT', '6379'),
            'database' => env('REDIS_CACHE_DB', '1'),
            'max_retries' => env('REDIS_MAX_RETRIES', 3),
            'backoff_algorithm' => env('REDIS_BACKOFF_ALGORITHM', 'decorrelated_jitter'),
            'backoff_base' => env('REDIS_BACKOFF_BASE', 100),
            'backoff_cap' => env('REDIS_BACKOFF_CAP', 1000),
        ],

    ],

];