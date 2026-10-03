<?php

/*
|--------------------------------------------------------------------------
| Payment / Payout Account Details
|--------------------------------------------------------------------------
|
| Where customers send their FULL order payment (one payment per order).
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
        'Send the full order amount to any of the accounts below, then upload the receipt. We verify every payment against our transaction records before your order ships. Orders placed before 3:00 PM are processed the same day.'
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

    /*
    | Order Guidelines §1 — same-day cut-off. Orders placed before `cutoff`
    | (store time) are processed that day; later ones the next day. The store
    | is open every day, so the "next business day" is simply tomorrow.
    */
    'timezone' => env('STORE_TIMEZONE', 'Asia/Manila'),
    'cutoff' => env('ORDER_CUTOFF', '15:00'),

    // Shown to customers next to the cut-off notice.
    'store_hours' => [
        ['days' => 'Monday – Thursday', 'hours' => '10:00 AM – 8:00 PM'],
        ['days' => 'Friday – Sunday', 'hours' => '10:00 AM – 9:00 PM'],
    ],

];
