<?php

namespace App\Support;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Records CUSTOMER ACCOUNT activity on the audit trail (target USER_ACCOUNTS).
 *
 * The trail used to hold staff actions only, so "what happened to this
 * customer's account?" had no answer. Registration, sign-in, failed sign-in,
 * profile / size / password changes and deletion now each leave one row, tied
 * to the account by `subject_user_id`. Admins read these (masked) to audit
 * customer accounts; the super admin sees them in full.
 *
 * A failed write is swallowed for the same reason as WritesAuditTrail: the
 * customer's action already happened, and a missing log line must never turn
 * it into an error.
 */
class AccountAudit
{
    public static function record(User $user, string $action, ?string $details, ?Request $request = null): void
    {
        try {
            AuditLog::create([
                'admin_email' => $user->email,
                'actor_role' => strtolower((string) ($user->role ?: 'user')),
                'action' => $action,
                'target' => 'USER_ACCOUNTS',
                'subject_user_id' => $user->id,
                'details' => $details,
                'ip_address' => $request?->ip(),
            ]);
        } catch (\Throwable $e) {
            Log::warning("Account audit write failed for {$action}: " . $e->getMessage());
        }
    }
}
