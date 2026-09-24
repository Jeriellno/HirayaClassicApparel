<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * SizeChart model
 *
 * Stores standardized measurement ranges (in cm) for size labels
 * across categories and genders. Used as a fallback by
 * MeasurementNormalizer when product-specific measurements
 * are not available.
 */
class SizeChart extends Model
{
    protected $table = 'size_charts';

    protected $fillable = [
        'category',
        'gender',
        'size_label',
        'chest_bust_min',
        'chest_bust_max',
        'waist_min',
        'waist_max',
        'hips_min',
        'hips_max',
        'shoulder_width_min',
        'shoulder_width_max',
        'sleeve_length_min',
        'sleeve_length_max',
    ];

    protected $casts = [
        'chest_bust_min'       => 'float',
        'chest_bust_max'       => 'float',
        'waist_min'            => 'float',
        'waist_max'            => 'float',
        'hips_min'             => 'float',
        'hips_max'             => 'float',
        'shoulder_width_min'   => 'float',
        'shoulder_width_max'   => 'float',
        'sleeve_length_min'    => 'float',
        'sleeve_length_max'    => 'float',
    ];

    /**
     * Scope: filter by category.
     */
    public function scopeByCategory($query, string $category)
    {
        return $query->where('category', strtoupper($category));
    }

    /**
     * Scope: filter by gender.
     */
    public function scopeByGender($query, string $gender)
    {
        return $query->where('gender', $gender);
    }

    /**
     * Scope: filter by size label.
     */
    public function scopeBySizeLabel($query, string $sizeLabel)
    {
        return $query->where('size_label', strtoupper($sizeLabel));
    }

    /**
     * Get the structured measurement range for this size chart entry.
     *
     * @return array<string, array{min: float, max: float}>
     */
    public function toMeasurementRange(): array
    {
        $result = [];
        foreach (['chest_bust', 'waist', 'hips', 'shoulder_width', 'sleeve_length'] as $metric) {
            $minKey = "{$metric}_min";
            $maxKey = "{$metric}_max";
            if ($this->{$minKey} !== null && $this->{$maxKey} !== null) {
                $result["{$metric}_min"] = (float) $this->{$minKey};
                $result["{$metric}_max"] = (float) $this->{$maxKey};
            }
        }
        return $result;
    }
}
