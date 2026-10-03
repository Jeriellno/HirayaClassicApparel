<?php

namespace App\Services;

use App\Models\Order;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * PAYMENT RECEIPT CHECKS — a RISK SIGNAL for staff, never a verdict.
 *
 * Receipt images can be edited or generated, and AI "is this fake?" detection
 * is probabilistic and bypassable. So nothing in this class can mark an order
 * paid. It produces:
 *
 *   1. hard file-safety checks (real, decodable image; allowed MIME; size) —
 *      run at upload time, can REFUSE an upload;
 *   2. fingerprints — sha256 (exact duplicate) and a 64-bit difference hash
 *      (the same receipt re-saved / re-compressed / lightly cropped);
 *   3. an advisory analysis: OCR'd fields (Gemini vision, when configured)
 *      compared against the order (full amount, payee, plausible date) plus
 *      duplicate / edited-metadata flags, rolled into low | medium | high.
 *
 * The final approval is made by authorised staff against a TRUSTED record
 * (the merchant's GCash / bank transaction history) — see
 * AdminOrderController::approveDownPayment.
 */
class ReceiptInspector
{
    public const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

    public const MAX_BYTES = 5 * 1024 * 1024;

    /** Editing-software signatures that commonly survive in image metadata. */
    private const EDITOR_SIGNATURES = ['photoshop', 'gimp', 'canva', 'picsart', 'snapseed', 'lightroom', 'pixlr', 'affinity', 'illustrator'];

    /**
     * File-safety validation beyond Laravel's `image|mimes` rule: the bytes must
     * be a real raster image of an allowed type (magic bytes + full decode), so
     * a renamed script / polyglot is refused.
     *
     * @return string|null an error message, or null when the file is acceptable
     */
    public function rejectReason(UploadedFile $file): ?string
    {
        if ($file->getSize() > self::MAX_BYTES) {
            return 'The receipt image must be 5 MB or smaller.';
        }

        $bytes = (string) @file_get_contents($file->getRealPath());
        $info = @getimagesizefromstring($bytes);
        $mime = $info['mime'] ?? null;

        if (! $info || ! in_array($mime, self::ALLOWED_MIME, true)) {
            return 'Please upload the receipt as a JPG, PNG or WEBP image.';
        }

        if (($info[0] ?? 0) < 120 || ($info[1] ?? 0) < 120) {
            return 'The receipt image is too small to read. Please upload a clear screenshot.';
        }

        if (function_exists('imagecreatefromstring') && @imagecreatefromstring($bytes) === false) {
            return 'The receipt image could not be read. Please upload a clear screenshot.';
        }

        // A script tag or PHP opener inside an "image" is not a receipt.
        if (preg_match('/<\?php|<script/i', $bytes)) {
            return 'The receipt file was refused. Please upload a plain screenshot of your receipt.';
        }

        return null;
    }

    /** @return array{sha256: string, phash: ?string} */
    public function fingerprints(UploadedFile $file): array
    {
        $bytes = (string) @file_get_contents($file->getRealPath());

        return ['sha256' => hash('sha256', $bytes), 'phash' => $this->differenceHash($bytes)];
    }

    /** Another order (not this one, not rejected) already used this exact receipt file? */
    public function exactDuplicateOf(string $sha256, ?int $exceptOrderId = null): ?int
    {
        return Order::query()
            ->where('receipt_sha256', $sha256)
            ->when($exceptOrderId, fn ($q) => $q->whereKeyNot($exceptOrderId))
            ->value('id');
    }

    /**
     * Full advisory analysis for an order's current receipt. Never throws.
     *
     * @return array{risk_level: string, flags: array<int, string>, extracted: array, checked_at: string, ai: bool}
     */
    public function analyse(Order $order, string $bytes, string $mime): array
    {
        $flags = [];
        $extracted = [];
        $ai = false;

        // Near-duplicate (re-saved copy of a receipt used on another order).
        if ($order->receipt_phash) {
            $similar = Order::query()
                ->whereKeyNot($order->id)
                ->whereNotNull('receipt_phash')
                ->latest('id')
                ->limit(500)
                ->get(['id', 'receipt_phash'])
                ->first(fn ($o) => $this->hamming($o->receipt_phash, $order->receipt_phash) <= 6);
            if ($similar) {
                $flags[] = 'Looks like the same receipt image already uploaded for order #' . $similar->id . '.';
            }
        }

        // Editing software left in the file's metadata.
        $head = strtolower(substr($bytes, 0, 65536));
        foreach (self::EDITOR_SIGNATURES as $signature) {
            if (str_contains($head, $signature)) {
                $flags[] = 'Image metadata mentions editing software (' . $signature . ').';
                break;
            }
        }

        // OCR / AI extraction (advisory).
        $result = $this->extractWithGemini($bytes, $mime);
        if ($result !== null) {
            $ai = true;
            $extracted = $result;
            $flags = array_merge($flags, $this->compare($order, $result));
        } else {
            $flags[] = 'Automatic receipt reading is unavailable — check the receipt manually.';
        }

        $risk = $this->riskLevel($flags, $extracted);

        return [
            'risk_level' => $risk,
            'flags' => array_values(array_unique($flags)),
            'extracted' => $extracted,
            'ai' => $ai,
            'checked_at' => now()->toIso8601String(),
            'note' => 'Advisory only. Approve only after matching this payment in the store\'s GCash/bank transaction history.',
        ];
    }

    /**
     * Read the order's stored receipt (private bucket) and save the advisory
     * analysis on the order. Run after the customer's request has been answered,
     * so the upload is never slowed down. Never throws.
     */
    public function analyseAndStore(int $orderId): void
    {
        try {
            $order = Order::find($orderId);
            if (! $order || ! $order->dp_proof_image_path) {
                return;
            }

            $receipt = \App\Support\ReceiptStorage::read($order->dp_proof_image_path);
            if ($receipt === null) {
                return;
            }

            [$bytes, $mime] = $receipt;
            $analysis = $this->analyse($order, $bytes, in_array($mime, self::ALLOWED_MIME, true) ? $mime : 'image/png');

            $order->forceFill([
                'receipt_risk_level' => $analysis['risk_level'],
                'receipt_analysis' => $analysis,
            ])->saveQuietly();
        } catch (\Throwable $e) {
            Log::warning('ReceiptInspector: analysis for order #' . $orderId . ' failed: ' . $e->getMessage());
        }
    }

    /** Compare OCR'd fields with the order. @return array<int, string> */
    private function compare(Order $order, array $x): array
    {
        $flags = [];
        $expected = round((float) $order->total_amount, 2);

        $amount = isset($x['amount']) && is_numeric($x['amount']) ? round((float) $x['amount'], 2) : null;
        if ($amount === null) {
            $flags[] = 'No payment amount could be read from the receipt.';
        } elseif (abs($amount - $expected) > 0.009) {
            $flags[] = 'Receipt amount ₱' . number_format($amount, 2) . ' does not match the order total ₱' . number_format($expected, 2) . '.';
        }

        if (! empty($x['date_time'])) {
            try {
                $paidAt = Carbon::parse((string) $x['date_time'], config('payments.timezone', 'Asia/Manila'));
                $placed = $order->created_at ?? now();
                if ($paidAt->lt($placed->copy()->subDay()) || $paidAt->gt(now()->addMinutes(30))) {
                    $flags[] = 'Receipt date ' . $paidAt->format('M d, Y h:i A') . ' is not plausible for this order.';
                }
            } catch (\Throwable $e) {
                $flags[] = 'The receipt date could not be understood.';
            }
        } else {
            $flags[] = 'No transaction date could be read from the receipt.';
        }

        if (! $this->payeeMatches((string) ($x['recipient_name'] ?? ''), (string) ($x['recipient_account'] ?? ''))) {
            $flags[] = 'The recipient on the receipt does not match any of the store\'s payment accounts.';
        }

        if (isset($x['status_text']) && preg_match('/fail|pending|declin|cancel/i', (string) $x['status_text'])) {
            $flags[] = 'Receipt status reads "' . mb_substr((string) $x['status_text'], 0, 40) . '".';
        }

        if (! empty($x['transaction_reference'])) {
            $usedBy = Order::referenceInUse((string) $x['transaction_reference'], $order->id);
            if ($usedBy) {
                $flags[] = 'The transaction reference on this receipt was already used for order #' . $usedBy . '.';
            }
        }

        if (isset($x['tampering_signs']) && is_array($x['tampering_signs']) && count($x['tampering_signs']) > 0) {
            $flags[] = 'Possible editing signs: ' . mb_substr(implode('; ', array_map('strval', $x['tampering_signs'])), 0, 200) . '.';
        }

        return $flags;
    }

    private function payeeMatches(string $name, string $account): bool
    {
        $accounts = (array) config('payments.accounts', []);
        if ($name === '' && $account === '') {
            return false;
        }

        $nameN = strtolower(preg_replace('/[^a-z]/i', '', $name));
        $digits = preg_replace('/\D/', '', $account);

        foreach ($accounts as $a) {
            $storeName = strtolower(preg_replace('/[^a-z]/i', '', (string) ($a['name'] ?? '')));
            $storeDigits = preg_replace('/\D/', '', (string) ($a['number'] ?? ''));

            if ($nameN !== '' && $storeName !== '' && (str_contains($nameN, $storeName) || str_contains($storeName, $nameN))) {
                return true;
            }
            // E-wallet receipts usually mask all but the last digits.
            if (strlen($digits) >= 3 && strlen($storeDigits) >= 3 && str_ends_with($storeDigits, substr($digits, -3))) {
                return true;
            }
        }

        return false;
    }

    private function riskLevel(array $flags, array $extracted): string
    {
        $text = strtolower(implode(' ', $flags));
        if (str_contains($text, 'same receipt') || str_contains($text, 'already used') || str_contains($text, 'does not match the order total')) {
            return 'high';
        }

        $confidence = isset($extracted['looks_authentic_confidence']) && is_numeric($extracted['looks_authentic_confidence'])
            ? (float) $extracted['looks_authentic_confidence'] : null;
        if (count($flags) >= 2 || ($confidence !== null && $confidence < 0.5)) {
            return count($flags) >= 3 ? 'high' : 'medium';
        }

        return count($flags) === 0 ? 'low' : 'medium';
    }

    /** OCR the receipt with Gemini vision. Null when unavailable / failed. */
    private function extractWithGemini(string $bytes, string $mime): ?array
    {
        $key = GeminiKeyPool::current();
        if (! $key) {
            return null;
        }

        $prompt = <<<'PROMPT'
You read payment receipts (GCash, Maya, bank transfer confirmations). Return ONLY JSON with keys:
amount (number, the amount sent, no currency symbol), currency, date_time (ISO 8601 if possible, else as printed),
recipient_name, recipient_account (as printed, masked digits allowed), payment_provider, transaction_reference,
status_text (e.g. "Successful"), tampering_signs (array of short strings describing visible editing artifacts such as
mismatched fonts, misaligned digits, inconsistent spacing; empty array if none), looks_authentic_confidence (0..1).
Use null for anything not visible. Do not guess values that are not printed.
PROMPT;

        foreach (array_values(array_unique(array_filter(array_merge(
            [(string) config('services.gemini.model')],
            (array) config('services.gemini.models', [])
        )))) as $model) {
            try {
                $response = Http::acceptJson()->timeout(30)->connectTimeout(10)
                    ->post('https://generativelanguage.googleapis.com/v1beta/models/' . $model . ':generateContent?key=' . urlencode($key), [
                        'contents' => [[
                            'parts' => [
                                ['text' => $prompt],
                                ['inlineData' => ['mimeType' => $mime, 'data' => base64_encode($bytes)]],
                            ],
                        ]],
                        'generationConfig' => ['temperature' => 0.0, 'responseMimeType' => 'application/json'],
                    ]);

                if ($response->status() === 429) {
                    GeminiKeyPool::markRateLimited($key);
                    continue;
                }
                if (! $response->successful()) {
                    continue;
                }

                $text = (string) data_get($response->json(), 'candidates.0.content.parts.0.text', '');
                $json = json_decode(trim(preg_replace('/^```(?:json)?|```$/m', '', $text)), true);

                return is_array($json) ? $json : null;
            } catch (\Throwable $e) {
                // Never log the image or the key.
                Log::warning('ReceiptInspector: OCR call failed: ' . $e->getMessage());
            }
        }

        return null;
    }

    /** 64-bit difference hash (9x8 grayscale), as 16 hex chars. */
    private function differenceHash(string $bytes): ?string
    {
        if (! function_exists('imagecreatefromstring')) {
            return null;
        }

        $src = @imagecreatefromstring($bytes);
        if (! $src) {
            return null;
        }

        $small = imagecreatetruecolor(9, 8);
        imagecopyresampled($small, $src, 0, 0, 0, 0, 9, 8, imagesx($src), imagesy($src));

        $bits = '';
        for ($y = 0; $y < 8; $y++) {
            for ($x = 0; $x < 8; $x++) {
                $bits .= $this->luma($small, $x, $y) > $this->luma($small, $x + 1, $y) ? '1' : '0';
            }
        }

        imagedestroy($src);
        imagedestroy($small);

        $hex = '';
        foreach (str_split($bits, 4) as $nibble) {
            $hex .= dechex(bindec($nibble));
        }

        return $hex;
    }

    private function luma($img, int $x, int $y): float
    {
        $rgb = imagecolorat($img, $x, $y);

        return 0.299 * (($rgb >> 16) & 0xFF) + 0.587 * (($rgb >> 8) & 0xFF) + 0.114 * ($rgb & 0xFF);
    }

    private function hamming(?string $a, ?string $b): int
    {
        if (! $a || ! $b || strlen($a) !== strlen($b)) {
            return 64;
        }

        $distance = 0;
        for ($i = 0; $i < strlen($a); $i++) {
            $distance += substr_count(decbin(hexdec($a[$i]) ^ hexdec($b[$i])), '1');
        }

        return $distance;
    }
}
