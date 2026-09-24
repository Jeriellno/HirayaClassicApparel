<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

return new class extends Migration {
    /**
     * Repair `products.sizes` rows that were written in the wrong SHAPE.
     *
     * WHY
     * ---
     * The two size columns have different contracts:
     *
     *   sizes       -> a LIST of size labels this garment comes in, e.g. ["XS","S","M"]
     *   size_stocks -> a MAP of label => quantity, e.g. {"XS":234,"S":12}
     *
     * The SuperAdmin inventory console sent the STOCK MAP for BOTH columns, so
     * every product saved from that console stored `sizes` as a map with the
     * quantities as values — and, because the form only ever added the sizes the
     * admin toggled, usually with a single key:
     *
     *   sizes = {"XS":234}     <- wrong shape, one size
     *
     * A map iterated as a plain array yields its VALUES, so size matching saw
     * [234] instead of ["XS"]. The AI Stylist / Size Suggester could therefore
     * never match a customer to a garment, and the catalog appeared to hold only
     * one size per product.
     *
     * WHAT THIS DOES
     * --------------
     * Converts any MAP-shaped `sizes` into the documented LIST of its KEYS.
     * Nothing else is touched: quantities, measurements, stock and images are
     * left exactly as they are. Rows already holding a list are skipped, so the
     * migration is safe to re-run and safe on a healthy database.
     *
     * The SuperAdmin console bug itself is fixed at the source in
     * `hiraya-frontend/src/components/superadmin/tabs/InventoryTab.jsx`.
     */
    public function up(): void
    {
        $this->rewriteSizeShapes();
    }

    /**
     * The original data cannot be reconstructed: the admin's intended size set
     * was never persisted, so the map keys are all we have. The down path
     * restores the legacy MAP shape (label => its quantity from size_stocks) so
     * the change is reversible for already-repaired rows.
     */
    public function down(): void
    {
        $this->rewriteSizeShapes(toMap: true);
    }

    /**
     * @param  bool  $toMap  false: map -> list (up). true: list -> map (down).
     */
    private function rewriteSizeShapes(bool $toMap = false): void
    {
        $rows = DB::table('products')
            ->select('id', 'sizes', 'size_stocks')
            ->whereNotNull('sizes')
            ->get();

        $changed = 0;

        foreach ($rows as $row) {
            $sizes = $this->decode($row->sizes);

            if ($sizes === null || $sizes === []) {
                continue;
            }

            $isList = array_is_list($sizes);

            if (! $toMap) {
                // UP: only a non-list (map / object) needs converting.
                if ($isList) {
                    continue;
                }

                $labels = $this->labelsFromMap($sizes);
                if ($labels === []) {
                    continue;
                }

                $this->update($row->id, json_encode($labels));
                $changed++;

                continue;
            }

            // DOWN: only a list needs converting back to a map.
            if (! $isList) {
                continue;
            }

            $stocks = $this->decode($row->size_stocks) ?? [];
            $map = [];
            foreach ($sizes as $label) {
                if (is_scalar($label) && (string) $label !== '') {
                    $map[(string) $label] = (int) ($stocks[(string) $label] ?? 0);
                }
            }

            if ($map === []) {
                continue;
            }

            $this->update($row->id, json_encode($map));
            $changed++;
        }

        Log::info(sprintf(
            'products.sizes shape repair (%s): %d of %d row(s) rewritten.',
            $toMap ? 'list -> map' : 'map -> list',
            $changed,
            $rows->count(),
        ));
    }

    /**
     * Decode a JSON column that may arrive as a string (driver-dependent).
     *
     * @return array<mixed>|null
     */
    private function decode(mixed $value): ?array
    {
        if (is_array($value)) {
            return $value;
        }

        if (is_string($value) && $value !== '') {
            $decoded = json_decode($value, true);

            return is_array($decoded) ? $decoded : null;
        }

        return null;
    }

    /**
     * The size labels carried by a map-shaped `sizes`, in stored order.
     *
     * @param  array<mixed>  $sizes
     * @return array<int, string>
     */
    private function labelsFromMap(array $sizes): array
    {
        $labels = [];

        foreach ($sizes as $key => $value) {
            // `{"XS":234}` -> "XS". Also tolerate object rows that name the
            // label explicitly: `[{"size_label":"M","stock":5}]`.
            $label = is_array($value)
                ? ($value['size_label'] ?? $value['size'] ?? (is_string($key) ? $key : null))
                : (is_string($key) ? $key : (is_scalar($value) ? $value : null));

            if (is_scalar($label) && trim((string) $label) !== '') {
                $label = trim((string) $label);
                if (! in_array($label, $labels, true)) {
                    $labels[] = $label;
                }
            }
        }

        return $labels;
    }

    private function update(int $id, string $json): void
    {
        DB::table('products')->where('id', $id)->update(['sizes' => $json]);
    }
};
