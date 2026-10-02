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
        // No `updated_by` column exists; who changed what is in the audit log.
    ];

    /**
     * Is a store switch ON? A missing row means ON (the default for every
     * switch), so a fresh database never locks customers out by accident.
     */
    public static function isOn(string $key): bool
    {
        $value = static::query()->where('key', $key)->value('value');

        return $value === null || filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) !== false;
    }
}
