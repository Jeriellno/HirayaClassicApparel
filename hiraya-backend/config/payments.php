<?php

/*
|--------------------------------------------------------------------------
| Payment / Payout Account Details
|--------------------------------------------------------------------------
|
| Where customers send their 50% down payment (and the remaining balance).
| These are surfaced to the storefront so the balance screen is never a dead
| end: the customer always sees exactly where to send the money.
|
| Override any of these with environment variables in production so the
| account numbers are not committed to the repository. Use an array for
| `accounts` via PAYMENT_ACCOUNTS_JSON if you prefer env-driven config.
|
*/

return [

    // Shown above the account list (optional).
    'instructions' => env(
        'PAYMENT_INSTRUCTIONS',
        'Send your down payment or remaining balance to any of the accounts below, then upload the receipt on your orders page. Orders placed before 3:00 PM are processed the same day.'
    ),

    // One entry per account the store accepts. `type` is free text and only
    // used for the icon/label on the client (e.g. GCash, Bank, Maya).
    'accounts' => [
        [
            'type' => 'GCash',
            'name' => env('PAYMENT_GCASH_NAME', 'Hiraya Apparel'),
            'number' => env('PAYMENT_GCASH_NUMBER', '0917 XXX XXXX'),
            'note' => 'Send as GCash to a mobile number — no fees.',
        ],
        [
            'type' => 'Bank Transfer',
            'name' => env('PAYMENT_BANK_NAME', 'Hiraya Apparel Trading'),
            'number' => env('PAYMENT_BANK_NUMBER', '0000 0000 0000'),
            'note' => env('PAYMENT_BANK_LABEL', 'BDO Savings') . ' — transfer via online banking or over the counter.',
        ],
    ],

    // Optional QR image (a public path or full URL). Leave null to hide it.
    'qr_image_url' => env('PAYMENT_QR_IMAGE_URL'),

];
