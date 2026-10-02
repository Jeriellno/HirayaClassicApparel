<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Feedback;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Small console-wide endpoints:
 *
 *   POST  /admin/console/section-view   records which console section a staff
 *                                       member opened (Audit Logs shows it)
 *   GET   /admin/system-health          plain-language health of the AI and
 *                                       data services (super admin header pill)
 *   GET   /admin/customer-feedback      Customers Feedback, NAMED only
 *   GET   /admin/support                Contact Support messages
 *   POST  /admin/support                send a Contact Support message
 *   PATCH /admin/support/{id}/resolve   mark one resolved (super admin)
 */
class ConsoleController extends Controller
{
    /** Section ids the console may report, so the trail holds no free text. */
    private const SECTIONS = [
        'dashboard' => 'Dashboard',
        'inventory' => 'Inventory Management',
        'orders' => 'Orders Management',
        'customers' => 'Customers Management',
        'feedback' => 'Customers Feedback',
        'admins' => 'Admin Management',
        'audit-logs' => 'Audit Logs',
        'settings' => 'System Settings',
        'manual' => 'User Manual',
        'support' => 'Contact Support',
    ];

    private function role(Request $request): string
    {
        return strtolower(str_replace(['-', '_'], '', (string) $request->user()?->role));
    }

    public function sectionView(Request $request): JsonResponse
    {
        $validated = $request->validate(['section' => ['required', 'string', 'in:' . implode(',', array_keys(self::SECTIONS))]]);

        AuditLog::create([
            'admin_email' => $request->user()?->email,
            'actor_role' => $this->role($request) ?: null,
            'action' => 'OPEN_SECTION',
            'target' => 'CONSOLE',
            'details' => 'Opened ' . self::SECTIONS[$validated['section']] . '.',
            'ip_address' => $request->ip(),
        ]);

        return response()->json(['ok' => true]);
    }

    /**
     * Live probes of each external service, translated for a shop owner and
     * cached for five minutes so opening the console never waits on vendors.
     */
    public function systemHealth(Request $request): JsonResponse
    {
        $report = Cache::remember('console:system-health', 300, function () {
            $services = [
                'gemini' => ['AI stylist & product auto-fill', 'Writes product details and styling advice.'],
                'pixelapi' => ['Virtual try-on', 'Renders customers wearing the garments.'],
                'supabase' => ['Sign-in & image storage', 'Staff sign-in and product photos.'],
            ];

            $status = app(ApiStatusController::class);
            $rows = [];
            foreach ($services as $key => [$label, $what]) {
                try {
                    $probe = $status->probe($key)->getData(true);
                    $ok = (bool) ($probe['ok'] ?? false);
                    $rows[] = [
                        'key' => $key,
                        'label' => $label,
                        'what' => $what,
                        'state' => $ok ? 'healthy' : (($probe['reachable'] ?? false) ? 'attention' : 'down'),
                        'summary' => $ok ? 'Working normally.' : ($probe['summary'] ?? 'Not responding.'),
                    ];
                } catch (\Throwable $e) {
                    $rows[] = ['key' => $key, 'label' => $label, 'what' => $what, 'state' => 'down', 'summary' => 'Could not be checked.'];
                }
            }

            $started = microtime(true);
            try {
                DB::select('select 1');
                $ms = (int) round((microtime(true) - $started) * 1000);
                $rows[] = ['key' => 'database', 'label' => 'Store database', 'what' => 'Products, orders and customers.', 'state' => 'healthy', 'summary' => "Working normally ({$ms} ms)."];
            } catch (\Throwable $e) {
                $rows[] = ['key' => 'database', 'label' => 'Store database', 'what' => 'Products, orders and customers.', 'state' => 'down', 'summary' => 'Not responding.'];
            }

            $states = array_column($rows, 'state');

            return [
                'overall' => in_array('down', $states, true) ? 'down' : (in_array('attention', $states, true) ? 'attention' : 'healthy'),
                'services' => $rows,
                'checked_at' => now()->toIso8601String(),
            ];
        });

        return response()->json($report);
    }

    /** Customers Feedback — only feedback tied to a real customer account. */
    public function customerFeedback(): JsonResponse
    {
        $rows = Feedback::query()
            ->whereNotNull('user_id')
            ->with('user:id,full_name,email')
            ->latest()
            ->limit(300)
            ->get();

        // What was in each rated order, so staff can see which products the
        // order-experience rating is about (name snapshot survives deletion).
        $itemsByOrder = \App\Models\OrderItem::query()
            ->whereIn('order_id', $rows->pluck('order_id')->filter()->unique())
            ->get(['order_id', 'product_id', 'product_name_snapshot', 'selected_size', 'selected_color', 'quantity'])
            ->groupBy('order_id');

        $rows = $rows->map(fn (Feedback $f) => [
                'id' => $f->id,
                'customer_name' => $f->user?->full_name ?: $f->user_name,
                'customer_email' => $f->user?->email ?: $f->user_email,
                'rating' => $f->rating,
                'comment' => $f->comment,
                'order_id' => $f->order_id,
                'order_products' => $f->order_id
                    ? ($itemsByOrder[$f->order_id] ?? collect())->map(fn ($i) => [
                        'name' => $i->product_name_snapshot,
                        'size' => $i->selected_size,
                        'color' => $i->selected_color,
                        'quantity' => (int) $i->quantity,
                        'in_shop' => $i->product_id !== null,
                    ])->values()
                    : [],
                'created_at' => optional($f->created_at)->toIso8601String(),
            ]);

        return response()->json($rows);
    }

    /**
     * POST /admin/me/password — a staff member changes THEIR OWN password.
     * The current password is checked against Supabase (what staff sign in
     * with); the new one is set there and on the local account.
     */
    public function changeOwnPassword(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'current_password' => ['required', 'string'],
            'new_password' => ['required', 'string', 'confirmed', 'different:current_password', new \App\Rules\PasswordStrength('new password')],
        ]);
        $user = $request->user();

        if (!\App\Support\SupabaseIdentity::checkPassword($user->email, $validated['current_password'])) {
            return response()->json([
                'message' => 'The current password is incorrect.',
                'errors' => ['current_password' => ['The current password is incorrect.']],
            ], 422);
        }

        try {
            \App\Support\SupabaseIdentity::setPassword($user->email, $validated['new_password']);
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 502);
        }
        $user->forceFill(['password' => \Illuminate\Support\Facades\Hash::make($validated['new_password'])])->save();

        AuditLog::create([
            'admin_email' => $user->email,
            'actor_role' => $this->role($request) ?: null,
            'action' => 'CHANGE_OWN_PASSWORD',
            'target' => 'ADMINS',
            'details' => 'Changed their own password.',
            'ip_address' => $request->ip(),
        ]);

        return response()->json(['message' => 'Password changed. Use the new one next time you sign in.']);
    }

    /**
     * POST /admin/console/signed-in | signed-out — records staff sign-in and
     * sign-out on the audit trail (staff sign in through Supabase, which
     * Laravel never sees, so the console reports it once the session is aal2).
     */
    public function signInEvent(Request $request, string $event): JsonResponse
    {
        abort_unless(in_array($event, ['signed-in', 'signed-out'], true), 404);

        AuditLog::create([
            'admin_email' => $request->user()?->email,
            'actor_role' => $this->role($request) ?: null,
            'action' => $event === 'signed-in' ? 'STAFF_SIGN_IN' : 'STAFF_SIGN_OUT',
            'target' => 'CONSOLE',
            'details' => $event === 'signed-in' ? 'Signed in to the console (password + authenticator code).' : 'Signed out of the console.',
            'ip_address' => $request->ip(),
        ]);
        if ($event === 'signed-in') {
            $request->user()?->forceFill(['last_login_at' => now()])->save();
        }

        return response()->json(['ok' => true]);
    }

    public function supportIndex(Request $request): JsonResponse
    {
        $query = DB::table('support_tickets')->orderByDesc('id')->limit(200);
        // An admin sees their own messages; the super admin sees everyone's.
        if ($this->role($request) !== 'superadmin') {
            $query->where('user_id', $request->user()?->id);
        }

        return response()->json($query->get());
    }

    public function supportStore(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'category' => ['required', 'in:bug,account,orders,products,other'],
            'subject' => ['required', 'string', 'min:4', 'max:150'],
            'message' => ['required', 'string', 'min:10', 'max:4000'],
        ]);
        $user = $request->user();

        $id = DB::table('support_tickets')->insertGetId([
            'user_id' => $user?->id,
            'sender_name' => $user?->full_name ?: ($user?->email ?? 'Staff'),
            'sender_email' => $user?->email ?? '',
            'sender_role' => $this->role($request) ?: null,
            'category' => $validated['category'],
            'subject' => $validated['subject'],
            'message' => $validated['message'],
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // E-mail the support inbox; the ticket is saved even if mail fails.
        // The shop's own inbox (MAIL_FROM_ADDRESS, hirayaclassicapparel@gmail.com).
        $to = config('mail.from.address');
        $mailed = false;
        try {
            Mail::raw(
                "Support request #{$id} from {$user?->full_name} <{$user?->email}> ({$this->role($request)})\n"
                . "Category: {$validated['category']}\n\n{$validated['message']}",
                function ($m) use ($to, $id, $validated, $user) {
                    $m->to($to)->subject("[Hiraya Support #{$id}] {$validated['subject']}");
                    if ($user?->email) {
                        $m->replyTo($user->email, $user->full_name ?: null);
                    }
                }
            );
            $mailed = true;
        } catch (\Throwable $e) {
            Log::warning('Support e-mail failed: ' . $e->getMessage());
        }

        return response()->json([
            'message' => $mailed
                ? "Message sent. Ticket #{$id} — a reply will come to your e-mail."
                : "Message saved as ticket #{$id}. E-mail delivery failed, but the Super Admin can see it here.",
            'id' => $id,
        ], 201);
    }

    public function supportResolve(Request $request, int $id): JsonResponse
    {
        if ($this->role($request) !== 'superadmin') {
            return response()->json(['message' => 'Only the Super Admin can resolve support messages.'], 403);
        }
        $updated = DB::table('support_tickets')->where('id', $id)->update([
            'status' => 'resolved',
            'resolved_at' => now(),
            'updated_at' => now(),
        ]);

        return $updated
            ? response()->json(['message' => 'Marked as resolved.'])
            : response()->json(['message' => 'Ticket not found.'], 404);
    }
}
