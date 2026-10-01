<?php

namespace App\Http\Controllers\Api\Concerns;

use App\Models\AuditLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Writes an entry to the security trail for any privileged console action.
 *
 * WHY THIS EXISTS
 * ---------------
 * Until now, audit writing was re-implemented privately inside whichever
 * controller happened to need it — `AdminCustomerController` had a `writeAudit()`
 * private method, `SuperAdminController` inlined the insert, and
 * `AdminAccountController` inlined it again. The result was that a garment edit,
 * an inventory change, an order status change or a product edit wrote NOTHING:
 * not because writing was forbidden, but because nobody had remembered to repeat
 * the pattern. The Super Admin audit tab was therefore an almost-empty table that
 * only ever showed settings toggles and MFA enrolments, which reads as "nobody is
 * doing anything" when in fact staff were editing the catalog all day.
 *
 * The trail is meant to answer "what did each admin actually do?". That question is
 * only answerable if EVERY privileged mutation writes here, so the writing is now
 * available to any controller that needs it instead of being copy-pasted.
 *
 * WHY A FAILED WRITE IS SWALLOWED
 * ------------------------------
 * The action has already committed by the time this runs. Turning a missing audit
 * row into a thrown exception would tell the operator their edit failed when it
 * succeeded — the worst possible outcome, because the instinct is to retry and now
 * they have applied it twice. A lost log line is a far smaller harm than a lost
 * edit, so the failure is logged to the application log (where it is still
 * diagnosable) and the request proceeds.
 */
trait WritesAuditTrail
{
    /**
     * Record one privileged action.
     *
     * @param string      $action  SCREAMING_SNAKE verb, e.g. 'UPDATE_GARMENT'.
     * @param string|null $target  Which area it touched, e.g. 'GARMENTS'. Grouped
     *                             in the UI, so keep it a small fixed vocabulary.
     * @param string|null $details Human-readable specifics: the record's name, id,
     *                             and what specifically changed.
     */
    protected function writeAudit(Request $request, string $action, ?string $target, ?string $details): void
    {
        try {
            AuditLog::create([
                /*
                 * The actor comes from the resolved request user, never from the
                 * body — the same rule the rest of the console follows. `$request->user()`
                 * was populated by `supabase.user` from a signature-checked token, so
                 * an admin cannot file an action under someone else's name by editing
                 * a request field. It is null only on routes that legitimately have no
                 * authenticated actor.
                 */
                'admin_email' => $request->user()?->email,
                'actor_role' => $request->user()
                    ? strtolower(str_replace(['-', '_'], '', (string) $request->user()->role))
                    : null,
                'action' => $action,
                'target' => $target,
                'details' => $details,
                'ip_address' => $request->ip(),
            ]);
        } catch (\Throwable $e) {
            Log::warning("Audit write failed for {$action}: " . $e->getMessage());
        }
    }

    /**
     * Describe what changed between two versions of a record, for `details`.
     *
     * An audit row that says only "updated garment" is close to useless six months
     * later: the interesting fact is WHICH field moved and to what. This diffs the
     * two arrays over an explicit allow-list of fields the console actually edits,
     * and returns a compact `a -> b; c -> d` string, or null when nothing in the
     * watched set moved.
     *
     * Only fields named in `$watched` are considered. That is deliberate — passing
     * an entire model would leak timestamps, ids and internal columns into the
     * trail, and would report a change on every save because `updated_at` always
     * moves.
     *
     * @param array<string, mixed> $before
     * @param array<string, mixed> $after
     * @param string[]              $watched
     */
    protected function describeChanges(array $before, array $after, array $watched): ?string
    {
        $parts = [];

        foreach ($watched as $field) {
            $old = $before[$field] ?? null;
            $new = $after[$field] ?? null;

            // Loose comparison on purpose: a numeric string from the database and an
            // int from the request are the same value, and reporting "10 -> 10" on
            // every keystroke-level save would drown the real edits.
            if (is_scalar($new) || $new === null) {
                $oldComparable = is_scalar($old) || $old === null ? $old : null;
                if ((string) $oldComparable !== (string) $new) {
                    $parts[] = $field . ': ' . ($oldComparable === null || $oldComparable === ''
                        ? '—'
                        : $oldComparable) . ' -> ' . ($new === null || $new === '' ? '—' : $new);
                }
            }
        }

        return $parts ? implode('; ', $parts) : null;
    }
}
