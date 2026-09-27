<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\AnalyticsController;
use App\Models\Product;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AdminOperationsSnapshotTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Schema::create('products', function (Blueprint $table): void {
            $table->id();
            $table->string('name')->nullable();
            $table->string('category')->nullable();
            $table->decimal('price', 10, 2)->nullable();
            $table->integer('stock')->default(0);
            $table->text('size_stocks')->nullable();
            $table->unsignedBigInteger('canvas_drag_count')->default(0);
            $table->unsignedBigInteger('try_on_count')->default(0);
            $table->timestamps();
        });

        Schema::create('product_stock_movements', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('product_id')->nullable();
            $table->string('product_name');
            $table->unsignedBigInteger('changed_by')->nullable();
            $table->string('source');
            $table->unsignedInteger('before_stock')->nullable();
            $table->unsignedInteger('after_stock');
            $table->text('before_size_stocks')->nullable();
            $table->text('after_size_stocks')->nullable();
            $table->timestamps();
        });

        Schema::create('orders', function (Blueprint $table): void {
            $table->id();
            $table->decimal('total_amount', 10, 2);
            $table->decimal('dp_amount', 10, 2);
            $table->decimal('balance_amount', 10, 2);
            $table->string('payment_status');
            $table->string('order_status');
            $table->timestamps();
        });

        DB::table('products')->insert([
            'category' => 'Tops',
            'stock' => 8,
            'canvas_drag_count' => 2,
            'try_on_count' => 3,
        ]);

        $today = now();
        DB::table('orders')->insert([
            [
                'total_amount' => 1000,
                'dp_amount' => 500,
                'balance_amount' => 500,
                'payment_status' => '50_paid',
                'order_status' => 'processing',
                'created_at' => $today,
                'updated_at' => $today,
            ],
            [
                'total_amount' => 800,
                'dp_amount' => 400,
                'balance_amount' => 400,
                'payment_status' => 'pending',
                'order_status' => 'pending',
                'created_at' => $today,
                'updated_at' => $today,
            ],
            [
                'total_amount' => 1200,
                'dp_amount' => 600,
                'balance_amount' => 600,
                'payment_status' => 'fully_paid',
                'order_status' => 'shipped',
                'created_at' => $today->copy()->subMonths(2),
                'updated_at' => $today->copy()->subMonths(2),
            ],
            [
                'total_amount' => 300,
                'dp_amount' => 150,
                'balance_amount' => 150,
                'payment_status' => 'rejected',
                'order_status' => 'pending',
                'created_at' => $today,
                'updated_at' => $today,
            ],
        ]);
    }

    public function test_it_returns_period_revenue_and_live_order_backlog(): void
    {
        $response = app(AnalyticsController::class)->dashboardMetrics(Request::create(
            '/api/admin/analytics/dashboard',
            'GET',
            ['period' => 'month']
        ));
        $data = $response->getData(true);

        $this->assertEquals(500, $data['operations']['revenue']);
        $this->assertSame(3, $data['operations']['period_order_count']);
        $this->assertEquals(1300, $data['operations']['outstanding_balance']);
        $this->assertSame(1, $data['operations']['awaiting_dp_count']);
        $this->assertSame(1, $data['operations']['processing_count']);
        $this->assertSame(1, $data['operations']['shipping_count']);
    }

    public function test_it_rejects_unknown_dashboard_periods(): void
    {
        $response = app(AnalyticsController::class)->dashboardMetrics(Request::create(
            '/api/admin/analytics/dashboard',
            'GET',
            ['period' => 'year']
        ));

        $this->assertSame(422, $response->getStatusCode());
    }

    public function test_product_stock_changes_are_recorded_with_variant_values(): void
    {
        $product = Product::create([
            'name' => 'Stock History Test',
            'category' => 'Tops',
            'price' => 100,
            'stock' => 10,
            'size_stocks' => ['S' => 10],
        ]);

        $product->update([
            'stock' => 3,
            'size_stocks' => ['S' => 3],
        ]);

        $movement = DB::table('product_stock_movements')->latest('id')->first();

        $this->assertSame(10, (int) $movement->before_stock);
        $this->assertSame(3, (int) $movement->after_stock);
        $this->assertSame(['S' => 10], json_decode($movement->before_size_stocks, true));
        $this->assertSame(['S' => 3], json_decode($movement->after_size_stocks, true));
    }
}
