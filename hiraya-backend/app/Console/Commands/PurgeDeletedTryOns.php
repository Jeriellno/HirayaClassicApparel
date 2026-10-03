<?php

namespace App\Console\Commands;

use App\Http\Controllers\Api\TryOnController;
use Illuminate\Console\Command;

/**
 * Permanently remove "Recently Deleted" try-on renders older than
 * TRYON_TRASH_RETENTION_DAYS (config/tryon.php) — the DB row AND the encrypted
 * object in the private renders bucket. Scheduled daily; the Gallery also
 * purges a customer's own expired items whenever they open Recently Deleted.
 */
class PurgeDeletedTryOns extends Command
{
    protected $signature = 'tryon:purge-deleted';

    protected $description = 'Permanently delete Recently Deleted try-on renders past the retention period';

    public function handle(): int
    {
        $count = TryOnController::purgeExpiredTrash();
        $this->info("Purged {$count} expired try-on render(s).");

        return self::SUCCESS;
    }
}
