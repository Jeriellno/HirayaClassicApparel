<?php

namespace Tests\Unit;

use App\Services\SizeChart;
use PHPUnit\Framework\TestCase;

/**
 * `normaliseLabel()` is read by /outfits/recommended, the garment feed and the
 * try-on body metrics. It must hand back the LABEL: it once returned the size's
 * band/measurements array, which broke its `?string` return type and turned
 * all three endpoints into 500s for every customer with a size on file.
 */
class SizeChartTest extends TestCase
{
    public function test_it_returns_the_canonical_label_for_every_stocked_size(): void
    {
        foreach (SizeChart::labels() as $label) {
            $this->assertSame($label, SizeChart::normaliseLabel($label));
        }
    }

    public function test_it_tolerates_case_and_stray_whitespace(): void
    {
        $this->assertSame('M', SizeChart::normaliseLabel(' m '));
        $this->assertSame('2XL', SizeChart::normaliseLabel('2xl'));
        $this->assertSame('XS', SizeChart::normaliseLabel("xs\n"));
    }

    public function test_it_returns_null_for_anything_that_is_not_a_stocked_size(): void
    {
        $this->assertNull(SizeChart::normaliseLabel(null));
        $this->assertNull(SizeChart::normaliseLabel(''));
        $this->assertNull(SizeChart::normaliseLabel('XXXL'));
        $this->assertNull(SizeChart::normaliseLabel(['M']));
        $this->assertNull(SizeChart::normaliseLabel(42));
    }

    public function test_a_normalised_label_resolves_its_measurements(): void
    {
        $label = SizeChart::normaliseLabel('l');

        $this->assertIsString($label);
        $this->assertIsArray(SizeChart::measurementsFor($label));
    }
}
