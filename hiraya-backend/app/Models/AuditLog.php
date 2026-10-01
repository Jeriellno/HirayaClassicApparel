<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A privileged action trail entry, written whenever staff change a setting,
 * provision an account or edit the catalog — and, since the customer-account
 * audit, whenever a customer registers, signs in or changes their account.
 */
class AuditLog extends Model
{
    /** Areas an ADMIN may read. Everything else is superadmin-only. */
    public const CUSTOMER_TARGETS = ['USER_ACCOUNTS', 'CUSTOMERS'];

    protected $fillable = [
        'admin_email',
        'actor_role',
        'action',
        'target',
        'subject_user_id',
        'details',
        'ip_address',
    ];

    protected $casts = [
        'subject_user_id' => 'integer',
    ];

    /**
     * "juan.delacruz@gmail.com" -> "ju***@gmail.com".
     *
     * Enough for an admin to tell two customers apart without handing out a
     * contact address they have no business need for.
     */
    public static function maskEmail(?string $email): ?string
    {
        if ($email === null || !str_contains($email, '@')) {
            return $email;
        }

        [$local, $domain] = explode('@', $email, 2);

        return mb_substr($local, 0, min(2, mb_strlen($local))) . '***@' . $domain;
    }

    /** Masks every email address appearing inside free text (the `details` column). */
    public static function maskEmailsIn(?string $text): ?string
    {
        if ($text === null) {
            return null;
        }

        return preg_replace_callback(
            '/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i',
            fn ($m) => self::maskEmail($m[0]),
            $text
        );
    }

    /** The row as an ADMIN may see it: emails masked, IP withheld. */
    public function toLimitedArray(): array
    {
        return [
            'id' => $this->id,
            'admin_email' => self::maskEmail($this->admin_email),
            'actor_role' => $this->actor_role,
            'action' => $this->action,
            'target' => $this->target,
            'subject_user_id' => $this->subject_user_id,
            'details' => self::maskEmailsIn($this->details),
            'created_at' => $this->created_at,
        ];
    }
}
