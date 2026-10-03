<?php

namespace App\Console\Commands;

use App\Models\TryOnSession;
use App\Support\RenderVault;
use Illuminate\Console\Command;

/**
 * Move renders into the private, encrypted renders vault (App\Support\RenderVault).
 *
 *   tryon:vault-renders                  legacy plain-Base64 renders -> vault
 *   tryon:vault-renders --relocate-local renders that fell back to THIS
 *                                        machine's private disk (`local:`) ->
 *                                        the private Supabase bucket, so every
 *                                        server sharing the database can read them
 *
 * NON-DESTRUCTIVE: a row is only re-pointed after the new copy has been read
 * back and decrypted to the identical image; the old copy is removed only then.
 * Soft-deleted rows (Recently Deleted) are included. Safe to re-run; use
 * --dry-run to count.
 */
class VaultLegacyRenders extends Command
{
    protected $signature = 'tryon:vault-renders {--dry-run} {--limit=0} {--relocate-local}';

    protected $description = 'Encrypt legacy Base64 try-on renders into the private renders bucket';

    public function handle(): int
    {
        $relocate = (bool) $this->option('relocate-local');

        $query = TryOnSession::withTrashed()->select(['id']);
        $relocate
            ? $query->where('result_image_path', 'like', 'local:%')
            : $query->whereNull('result_image_path')->whereNotNull('result_image_base64');

        $total = (clone $query)->count();
        $this->info($relocate ? "{$total} render(s) on the local disk to move to Supabase." : "{$total} legacy render(s) to vault.");
        if ($this->option('dry-run') || $total === 0) {
            return self::SUCCESS;
        }

        $limit = (int) $this->option('limit');
        $moved = 0;
        $failed = 0;

        foreach ($query->orderBy('id')->pluck('id') as $id) {
            if ($limit > 0 && $moved >= $limit) {
                break;
            }

            $session = TryOnSession::withTrashed()->find($id);
            $oldPath = $session->result_image_path;
            $image = $relocate ? RenderVault::get($oldPath) : (string) $session->result_image_base64;

            if (! is_string($image) || $image === '') {
                $failed++;
                $this->warn("Session #{$id}: current image unreadable, left unchanged.");
                continue;
            }

            $path = RenderVault::put($image);

            if (($relocate && ! str_starts_with($path, 'supabase:')) || RenderVault::get($path) !== $image) {
                if ($path !== $oldPath) {
                    RenderVault::delete($path);
                }
                $failed++;
                $this->warn("Session #{$id}: could not store a verified copy in Supabase, left unchanged.");
                continue;
            }

            $session->forceFill(['result_image_path' => $path, 'result_image_base64' => null])->saveQuietly();
            if ($relocate) {
                RenderVault::delete($oldPath);
            }
            $moved++;
        }

        $this->info("Moved {$moved} render(s); {$failed} left unchanged.");

        return $failed === 0 ? self::SUCCESS : self::FAILURE;
    }
}
