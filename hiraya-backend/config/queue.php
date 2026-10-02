<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Queue Connection Name
    |--------------------------------------------------------------------------
    |
    | Laravel's queue supports a variety of backends via a single, unified
    | API, giving you convenient access to each backend using identical
    | syntax for each. The default queue connection is defined below.
    |
    */

    'default' => env('QUEUE_CONNECTION', 'redis'),

    /*
    | Set to true when the host already keeps a `tryon` worker alive (the Docker
    | CMD loop on Render). EnsureTryOnWorker then trusts that supervisor instead
    | of probing processes and spawning its own workers from web requests.
    */
    'tryon_worker_supervised' => (bool) env('TRYON_WORKER_SUPERVISED', false),

    /*
    |--------------------------------------------------------------------------
    | Queue Connections
    |--------------------------------------------------------------------------
    |
    | Here you may configure the connection options for every queue backend
    | used by your application. An example configuration is provided for
    | each backend supported by Laravel. You're also free to add more.
    |
    | Drivers: "sync", "database", "beanstalkd", "sqs", "redis",
    |          "deferred", "background", "failover", "null"
    |
    */

    'connections' => [

        'sync' => [
            'driver' => 'sync',
        ],

        'database' => [
            'driver' => 'database',
            'connection' => env('DB_QUEUE_CONNECTION'),
            'table' => env('DB_QUEUE_TABLE', 'jobs'),
            'queue' => env('DB_QUEUE', 'default'),
            /*
             * `retry_after` MUST BE GREATER THAN THE JOB'S TIMEOUT (ProcessTryOnJob
             * sets $timeout). It was 90s, which is a REAL, MEASURED bug: a VTON
             * render takes 12-90s+ (PixelAPI's own `eta_seconds` pegs ~90s at load).
             * When the job ran longer than retry_after, the queue treated the
             * still-running job as ABANDONED and released it back for another
             * worker. The job was reserved again, and again, until Laravel killed it
             * with `MaxAttemptsExceededException: attempted too many times` — even
             * though the render itself was fine.
             *
             * RAISED 330s -> 400s IN LOCKSTEP WITH `$timeout` (300s -> 360s).
             *
             * This is a PAIRED value and the pair must never be edited apart: the
             * requirement is `retry_after > timeout`, and the try-on timeout was
             * raised because the renderer's poll window went 120s -> 240s to cover
             * the MEASURED ~155s worst-case PixelAPI render. 400s leaves the 360s
             * timeout 40s of headroom, so a long render is never double-picked.
             *
             * DOUBLE-PICKING IS NOT MERELY WASTEFUL HERE: PixelAPI renders ONE job
             * at a time, so two concurrent consumers for the same session are
             * answered with `503 queue_full` / `coalesced`, which then burns the
             * retry budget on a condition the duplicate itself created.
             */
            'retry_after' => (int) env('DB_QUEUE_RETRY_AFTER', 400),
            'after_commit' => false,
        ],

        'beanstalkd' => [
            'driver' => 'beanstalkd',
            'host' => env('BEANSTALKD_QUEUE_HOST', 'localhost'),
            'queue' => env('BEANSTALKD_QUEUE', 'default'),
            'retry_after' => (int) env('BEANSTALKD_QUEUE_RETRY_AFTER', 90),
            'block_for' => 0,
            'after_commit' => false,
        ],

        'sqs' => [
            'driver' => 'sqs',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'prefix' => env('SQS_PREFIX', 'https://sqs.us-east-1.amazonaws.com/your-account-id'),
            'queue' => env('SQS_QUEUE', 'default'),
            'suffix' => env('SQS_SUFFIX'),
            'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
            'after_commit' => false,
        ],

        'redis' => [
            'driver' => 'redis',
            'connection' => env('REDIS_QUEUE_CONNECTION', 'queue'),
            'queue' => env('REDIS_QUEUE', 'default'),
            'retry_after' => (int) env('REDIS_QUEUE_RETRY_AFTER', 90),
            'block_for' => null,
            'after_commit' => false,
        ],

        /*
         * Dedicated queue for try-on jobs.
         *
         * NOTE: this entry is a NAMED CONNECTION, but the app does not select it —
         * `QUEUE_CONNECTION=database` routes try-on to the `database` connection's
         * `tryon` QUEUE (ProcessTryOnJob sets `$this->queue = 'tryon'`, which is a
         * queue NAME, not a connection). It previously said `driver => redis`, but
         * there is no Redis on this deployment, so had anything ever selected it the
         * try-on queue would have died with "Redis connection [queue] not
         * configured". Kept aligned to the database driver and given the same
         * retry_after > timeout headroom so it can never contradict the active path.
         */
        'tryon' => [
            'driver' => 'database',
            'connection' => env('DB_QUEUE_CONNECTION'),
            'table' => env('DB_QUEUE_TABLE', 'jobs'),
            'queue' => 'tryon',
            'retry_after' => (int) env('DB_QUEUE_RETRY_AFTER', 400),
            'after_commit' => false,
        ],

        'deferred' => [
            'driver' => 'deferred',
        ],

        'background' => [
            'driver' => 'background',
        ],

        'failover' => [
            'driver' => 'failover',
            'connections' => [
                'database',
                'deferred',
            ],
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Job Batching
    |--------------------------------------------------------------------------
    |
    | The following options configure the database and table that store job
    | batching information. These options can be updated to any database
    | connection and table which has been defined by your application.
    |
    */

    'batching' => [
        'database' => env('DB_CONNECTION', 'sqlite'),
        'table' => 'job_batches',
    ],

    /*
    |--------------------------------------------------------------------------
    | Failed Queue Jobs
    |--------------------------------------------------------------------------
    |
    | These options configure the behavior of failed queue job logging so you
    | can control how and where failed jobs are stored. Laravel ships with
    | support for storing failed jobs in a simple file or in a database.
    |
    | Supported drivers: "database-uuids", "dynamodb", "file", "null"
    |
    */

    'failed' => [
        'driver' => env('QUEUE_FAILED_DRIVER', 'database-uuids'),
        'database' => env('DB_CONNECTION', 'sqlite'),
        'table' => 'failed_jobs',
    ],

];
