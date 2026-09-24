<?php

namespace App\Console\Commands;

use App\Services\HuggingFaceVtonRenderer;
use Illuminate\Console\Command;

/**
 * `php artisan tryon:hf-smoke-test`
 * An end-to-end SMOKE TEST of the Hugging Face (yisol/IDM-VTON) tier, exercised
 * through the REAL renderer class — not a hand-rolled HTTP script — so this
 * proves exactly the code path a customer render takes:
 *   HuggingFaceVtonRenderer::render()  ->  /upload  ->  /call/tryon  ->  SSE
 * It takes a person photo and a garment image from disk, encodes them the same
 * way the Studio does (data URIs), and reports the outcome plus the timing of
 * every stage. The render (when it succeeds) is written to storage/app so a
 * human can LOOK at it and judge whether the garment actually fit.
 * This command never touches the database or the queue — the renderer is called
 * directly — so it is safe to run on a dev box at any time.
 * LICENSING REMINDER: renders produced by this test come from IDM-VTON
 * (CC BY-NC-SA). Non-commercial use only.
 */
class VtonHfSmokeTest extends Command
{
    protected $signature = 'tryon:hf-smoke-test
                            {--person= : Path to the person photo (default: the QA test portrait)}
                            {--garment= : Path to the garment image (default: the QA emerald garment)}
                            {--anonymous : Send the call WITHOUT the HF token (ZeroGPU quota is per-account — a burnt quota errors anonymously differently)}
                            {--save : Save the rendered image into storage/app for inspection}';

    protected $description = 'End-to-end smoke test of the Hugging Face IDM-VTON renderer (free tier).';

    public function handle(): int
    {
        /*
         * DEFAULT ASSETS (repo root): _qa_archive/_test_person.jpg is the PERSON
         * portrait and raw_emerald.jpg is the GARMENT. Pass --person/--garment
         * to override either.
         */
        $personPath = $this->option('person') ?: base_path('../_qa_archive/_test_person.jpg');
        $garmentPath = $this->option('garment') ?: base_path('../raw_emerald.jpg');

        $person = $this->readDataUri($personPath);
        $garment = $this->readDataUri($garmentPath);

        if ($person === null || $garment === null) {
            $this->error('Missing or unreadable test asset(s):');
            $this->line('  person : ' . $personPath);
            $this->line('  garment: ' . $garmentPath);

            return self::FAILURE;
        }

        $space = trim((string) config('services.huggingface.vton_space'));
        $base = trim((string) config('services.huggingface.vton_base'));
        $token = $this->option('anonymous') ? '' : trim((string) config('services.huggingface.token'));

        /*
         * The token comes from CONFIG normally; --anonymous blanks it for this
         * call only. config()->set (not just a local variable) is required so
         * the RENDERER (which reads config() itself) sees the override.
         */
        if ($this->option('anonymous')) {
            config(['services.huggingface.token' => '']);
        }

        $this->info('Hugging Face VTON smoke test');
        $this->line('  space  : ' . ($space ?: '(not set)'));
        $this->line('  base   : ' . ($base ?: '(derived from the space id)'));
        $this->line('  token  : ' . ($token !== '' ? 'set (' . substr($token, 0, 6) . '…)' : '(anonymous)'));
        $this->line('  person : ' . $personPath . ' (' . strlen($person) . ' bytes as data URI)');
        $this->line('  garment: ' . $garmentPath . ' (' . strlen($garment) . ' bytes as data URI)');
        $this->newLine();

        $startedAt = microtime(true);

        $result = app(HuggingFaceVtonRenderer::class)->render(
            $person,
            [$garment],
            [],
            null,
            null,
            ['top'],
        );

        $elapsed = microtime(true) - $startedAt;

        if ($result['success'] ?? false) {
            $image = (string) ($result['image_base64'] ?? '');

            $this->info(sprintf('SUCCESS in %.1fs', $elapsed));
            $this->line('  image : data URI, ' . strlen($image) . ' bytes (' . $this->bytesOf($image) . ' decoded)');
            $this->line('  placed: ' . implode(', ', $result['placed'] ?? []));
            $this->line('  feedback: ' . ($result['feedback'] ?? ''));

            if ($this->option('save')) {
                $out = storage_path('app/hf-smoke-test-' . now()->format('His') . '.png');
                $bytes = base64_decode(preg_replace('#^data:image/\w+;base64,#', '', $image));
                file_put_contents($out, $bytes);
                $this->line('  saved : ' . $out);
            }

            $this->newLine();
            $this->warn('Reminder: this render came from IDM-VTON (CC BY-NC-SA — non-commercial).');

            return self::SUCCESS;
        }

        $this->error(sprintf('FAILED after %.1fs', $elapsed));
        $this->line('  code  : ' . ($result['code'] ?? '(none)'));
        $this->line('  error : ' . ($result['error'] ?? '(none)'));

        return self::FAILURE;
    }

    /**
     * Read an image off disk and encode it as a data URI, the same shape the
     * Studio stores on the session.
     */
    private function readDataUri(string $path): ?string
    {
        $full = $path;

        if (!str_contains($full, ':') || str_starts_with($full, '..')) {
            $candidate = base_path($full);
            if (file_exists($candidate)) {
                $full = $candidate;
            }
        }

        if (!is_file($full)) {
            return null;
        }

        $bytes = file_get_contents($full);
        if ($bytes === false || $bytes === '') {
            return null;
        }

        $mime = (new \finfo(FILEINFO_MIME_TYPE))->buffer($bytes) ?: 'image/png';

        return 'data:' . $mime . ';base64,' . base64_encode($bytes);
    }

    private function bytesOf(string $dataUri): string
    {
        $bytes = base64_decode(preg_replace('#^data:image/\w+;base64,#', '', $dataUri)) ?: '';

        return number_format(strlen($bytes) / 1048576, 2) . ' MB';
    }
}
