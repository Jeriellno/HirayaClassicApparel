<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * Widen `orders.order_status` with `delivered` and `rejected`.
     *
     * WHY
     * ---
     * The Super Admin order screen can now move an order to Pending, Rejected,
     * Shipped or Delivered. The column was created as an enum of
     * pending/processing/ready_for_shipping/shipped, so the two new values would
     * be refused by the database's CHECK constraint.
     *
     * The enum is materialised differently per driver, so each one is widened
     * in its own way:
     *  - pgsql (live Supabase): an inline CHECK named `orders_order_status_check`.
     *  - mysql/mariadb: a native ENUM column.
     *  - sqlite (test suite): a CHECK inside the table definition, removed by
     *    rebuilding the column as a plain string.
     */
    private const OLD = ['pending', 'processing', 'ready_for_shipping', 'shipped'];

    private const NEW = ['pending', 'processing', 'ready_for_shipping', 'shipped', 'delivered', 'rejected'];

    public function up(): void
    {
        $this->applyStatuses(self::NEW);
    }

    /**
     * Rows already in a new state are folded back to their nearest old state
     * before the constraint is narrowed, otherwise the rollback would fail.
     */
    public function down(): void
    {
        DB::table('orders')->where('order_status', 'delivered')->update(['order_status' => 'shipped']);
        DB::table('orders')->where('order_status', 'rejected')->update(['order_status' => 'pending']);

        $this->applyStatuses(self::OLD);
    }

    private function applyStatuses(array $statuses): void
    {
        if (! Schema::hasColumn('orders', 'order_status')) {
            return;
        }

        $driver = DB::getDriverName();
        $list = "'" . implode("','", $statuses) . "'";

        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_status_check');
            DB::statement("ALTER TABLE orders ADD CONSTRAINT orders_order_status_check CHECK (order_status IN ({$list}))");

            return;
        }

        if (in_array($driver, ['mysql', 'mariadb'], true)) {
            DB::statement("ALTER TABLE orders MODIFY order_status ENUM({$list}) NOT NULL DEFAULT 'pending'");

            return;
        }

        // sqlite: rebuilding the column as a string drops the old CHECK; the
        // allowed values are enforced by the controller's validation instead.
        Schema::table('orders', function (Blueprint $table) {
            $table->string('order_status', 32)->default('pending')->change();
        });
    }
};
