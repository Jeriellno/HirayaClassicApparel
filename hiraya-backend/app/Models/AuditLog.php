<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A privileged action trail entry, written whenever a Super Admin changes a
 * setting, provisions an account, uploads an asset or edits AI rules.
 */
class AuditLog extends Model
{
    protected $fillable = [
        'admin_email',
        'action',
        'target',
        'details',
    ];
}
