<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A single key/value platform toggle (e.g. maintenance_mode, ai_engine_active).
 * The value is stored as a string and cast back to bool by the console, so
 * 'true'/'false' round-trip cleanly regardless of the SQL column type.
 */
class SystemSetting extends Model
{
    protected $fillable = [
        'key',
        'value',
        'updated_by',
    ];
}
