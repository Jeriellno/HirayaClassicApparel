<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Redis Client
    |--------------------------------------------------------------------------
    |
    | This option defines the client used to communicate with Redis. Laravel
    | supports both "phpredis" and "predis" clients, which require the
    | respective PHP extensions or Composer packages to be installed.
    |
    | Supported: "phpredis", "predis"
    |
    */

    'client' => env('REDIS_CLIENT', 'phpredis'),

    /*
    |--------------------------------------------------------------------------
    | Redis Clusters
    |--------------------------------------------------------------------------
    |
    | This array defines your Redis clusters. Each cluster is defined by its
    | name, and then an array of Redis servers that belong to the cluster.
    |
    */

    'clusters' => [
        'default' => [
            'host' => env('REDIS_HOST', '127.0.0.1'),
            'password' => env('REDIS_PASSWORD', null),
            'port' => env('REDIS_PORT', 6379),
            'database' => env('REDIS_DB', 0),
        ],

        'cache' => [
            'host' => env('REDIS_HOST', '127.0.0.1'),
            'password' => env('REDIS_PASSWORD', null),
            'port' => env('REDIS_PORT', 6379),
            'database' => env('REDIS_CACHE_DB', 1),
        ],

        'queue' => [
            'host' => env('REDIS_HOST', '127.0.0.1'),
            'password' => env('REDIS_PASSWORD', null),
            'port' => env('REDIS_PORT', 6379),
            'database' => env('REDIS_QUEUE_DB', 2),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Predis Options
    |--------------------------------------------------------------------------
    |
    | Here you may define additional options for the Predis client.
    |
    */

    'predis' => [
        'connection_timeout' => 5,
        'read_write_timeout' => 30,
        'persistent' => false,
    ],

];