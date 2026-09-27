<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Mailer
    |--------------------------------------------------------------------------
    |
    | This option controls the default mailer that is used to send all email
    | messages unless another mailer is explicitly specified when sending
    | the message. All additional mailers can be configured within the
    | "mailers" array. Examples of each type of mailer are provided.
    |
    */

    /*
     * HIRAYA SMTP — how this application actually sends mail.
     *
     * `default` resolves to SMTP and falls back to `log` when no host is set.
     * That fallback is deliberate: a fresh checkout with no SMTP credentials must
     * not 500 the password-reset endpoint. Instead the mail is written to
     * storage/logs/laravel.log, so the reset link stays RECOVERABLE by an operator
     * during setup — while the console still tells the customer to check their
     * inbox, because from the application's point of view the send succeeded.
     *
     * TRANSPORT NOTE — WHY THERE IS NO PHPMAILER HERE.
     * Symfony Mailer (bundled with Laravel) IS a complete SMTP client: it speaks
     * AUTH LOGIN/PLAIN/XOAUTH2, STARTTLS and implicit TLS, and it is what powers
     * `Mail::mailer('smtp')`. Adding PHPMailer would mean a second mail engine, a
     * second config surface and a second dependency to audit — for the same bytes
     * on the same socket. One engine, one config, one place to debug.
     */
    'default' => env('MAIL_MAILER', env('MAIL_HOST') ? 'smtp' : 'log'),

    /*
    |--------------------------------------------------------------------------
    | Mailer Configurations
    |--------------------------------------------------------------------------
    |
    | Here you may configure all of the mailers used by your application plus
    | their respective settings. Several examples have been configured for
    | you and you are free to add your own as your application requires.
    |
    | Laravel supports a variety of mail "transport" drivers that can be used
    | when delivering an email. You may specify which one you're using for
    | your mailers below. You may also add additional mailers if needed.
    |
    | Supported: "smtp", "sendmail", "mailgun", "ses", "ses-v2",
    |            "postmark", "resend", "log", "array",
    |            "failover", "roundrobin"
    |
    */

    'mailers' => [

        'smtp' => [
            'transport' => 'smtp',
            'scheme' => env('MAIL_SCHEME'),
            'url' => env('MAIL_URL'),
            'host' => env('MAIL_HOST', '127.0.0.1'),
            'port' => env('MAIL_PORT', 2525),
            'username' => env('MAIL_USERNAME'),
            'password' => env('MAIL_PASSWORD'),
            /*
             * ENCRYPTION IS DERIVED FROM THE PORT unless MAIL_ENCRYPTION says
             * otherwise. This is the setting that breaks a provider SILENTLY:
             *
             *   465 -> implicit TLS from the first byte
             *   587 -> plain connection, upgraded with STARTTLS
             *   25  -> plain (relay / local MTA)
             *
             * Getting it wrong does not raise an error, it HANGS: the client
             * waits for a TLS handshake the server never starts. Deriving it
             * means pasting a provider's port is enough for the mail to work.
             *
             * THE BLANK-VALUE TRAP, IN BOTH DIRECTIONS.
             *
             * `env('X', $default)` returns $default ONLY when the variable is
             * ABSENT. A line reading `X=` is present-and-empty, so the default is
             * never reached and the setting resolves to ''. That bit this file
             * twice: `MAIL_PORT=` produced a port of 0 (so `0 !== 465` picked
             * STARTTLS for a config with no port), and `MAIL_ENCRYPTION=` produced
             * an EMPTY encryption string — which means the derivation below never
             * ran at all, because env() had already "found" a value.
             *
             * `?:` treats '' and null alike as "not configured", which is the
             * behaviour every other Laravel config file assumes.
             */
            'encryption' => env('MAIL_ENCRYPTION') ?: (
                (function () {
                    $port = env('MAIL_PORT');
                    $port = ($port === null || $port === '' || (int) $port === 0)
                        ? 587              // the near-universal submission default
                        : (int) $port;

                    return $port === 465 ? 'tls' : 'starttls';
                })()
            ),
            /*
             * A mail server that does not answer must not hold a web request
             * open. 15s is long enough for a slow provider and short enough that
             * the customer sees a failure instead of a spinning button.
             */
            'timeout' => (int) env('MAIL_TIMEOUT', 15),
            /*
             * Present for the local-MTA case. `verify_peer` stays ON: a mail
             * password sent over an unverified TLS connection is worse than a
             * failed send.
             */
            'auth_mode' => null,
            'verify_peer' => true,
            'local_domain' => env('MAIL_EHLO_DOMAIN', parse_url((string) env('APP_URL', 'http://localhost'), PHP_URL_HOST)),
        ],

        'ses' => [
            'transport' => 'ses',
        ],

        'postmark' => [
            'transport' => 'postmark',
            // 'message_stream_id' => env('POSTMARK_MESSAGE_STREAM_ID'),
            // 'client' => [
            //     'timeout' => 5,
            // ],
        ],

        'resend' => [
            'transport' => 'resend',
        ],

        'sendmail' => [
            'transport' => 'sendmail',
            'path' => env('MAIL_SENDMAIL_PATH', '/usr/sbin/sendmail -bs -i'),
        ],

        'log' => [
            'transport' => 'log',
            'channel' => env('MAIL_LOG_CHANNEL'),
        ],

        'array' => [
            'transport' => 'array',
        ],

        'failover' => [
            'transport' => 'failover',
            'mailers' => [
                'smtp',
                'log',
            ],
            'retry_after' => 60,
        ],

        'roundrobin' => [
            'transport' => 'roundrobin',
            'mailers' => [
                'ses',
                'postmark',
            ],
            'retry_after' => 60,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Global "From" Address
    |--------------------------------------------------------------------------
    |
    | You may wish for all emails sent by your application to be sent from
    | the same address. Here you may specify a name and address that is
    | used globally for all emails that are sent by your application.
    |
    */

    'from' => [
        'address' => env('MAIL_FROM_ADDRESS', 'hello@example.com'),
        'name' => env('MAIL_FROM_NAME', env('APP_NAME', 'Laravel')),
    ],

];
