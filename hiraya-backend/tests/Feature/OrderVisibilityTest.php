<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class OrderVisibilityTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Schema::create('users', function (Blueprint $table): void {
            $table->id();
            $table->string('full_name');
            $table->string('email')->unique();
            $table->string('password');
            $table->string('role')->default('user');
            $table->timestamps();
        });

        Schema::create('products', function (Blueprint $table): void {
            $table->id();
            $table->string('name');
            $table->string('image_url')->nullable();
            $table->string('display_image_url')->nullable();
        });

        Schema::create('orders', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->nullable();
            $table->decimal('total_amount', 10, 2);
            $table->decimal('dp_amount', 10, 2);
            $table->decimal('balance_amount', 10, 2);
            $table->string('payment_status');
            $table->string('order_status');
            $table->string('courier');
            $table->string('customer_name');
            $table->string('contact_number');
            $table->text('delivery_address');
            $table->string('tracking_booking_details')->nullable();
            $table->string('dp_proof_image_path')->nullable();
            $table->string('full_payment_proof_image_path')->nullable();
            $table->timestamps();
        });

        Schema::create('order_items', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('order_id');
            $table->unsignedBigInteger('product_id')->nullable();
            $table->string('product_name_snapshot');
            $table->string('selected_size');
            $table->string('selected_color');
            $table->integer('quantity');
            $table->decimal('unit_price', 10, 2);
            $table->decimal('line_total', 10, 2);
            $table->timestamps();
        });

        $customer = User::create([
            'full_name' => 'Order Customer',
            'email' => 'customer@example.com',
            'password' => 'hashed-password',
            'role' => 'user',
        ]);

        DB::table('products')->insert([
            'id' => 10,
            'name' => 'Hiraya Jacket',
            'image_url' => '/jacket.jpg',
            'display_image_url' => '/jacket-cutout.jpg',
        ]);

        DB::table('orders')->insert([
            'id' => 42,
            'user_id' => $customer->id,
            'total_amount' => 2400,
            'dp_amount' => 1200,
            'balance_amount' => 1200,
            'payment_status' => 'pending',
            'order_status' => 'pending',
            'courier' => 'lbc',
            'customer_name' => 'Order Customer',
            'contact_number' => '09123456789',
            'delivery_address' => 'Manila, Philippines',
            'dp_proof_image_path' => null,
            'full_payment_proof_image_path' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('order_items')->insert([
            'order_id' => 42,
            'product_id' => 10,
            'product_name_snapshot' => 'Hiraya Jacket',
            'selected_size' => 'M',
            'selected_color' => 'Black',
            'quantity' => 2,
            'unit_price' => 1200,
            'line_total' => 2400,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_customer_admin_and_superadmin_views_share_the_same_order_record_and_items(): void
    {
        $customer = User::where('email', 'customer@example.com')->firstOrFail();

        $customerResponse = $this->actingAs($customer, 'sanctum')
            ->getJson('/api/orders')
            ->assertOk()
            ->assertJsonPath('0.id', 42)
            ->assertJsonPath('0.order_items.0.product_name_snapshot', 'Hiraya Jacket')
            ->assertJsonPath('0.order_items.0.selected_size', 'M')
            ->assertJsonPath('0.order_items.0.quantity', 2);

        $admin = User::create([
            'full_name' => 'Store Admin',
            'email' => 'admin@example.com',
            'password' => 'hashed-password',
            'role' => 'admin',
        ]);

        $adminResponse = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/admin/orders')
            ->assertOk()
            ->assertJsonPath('0.id', 42)
            ->assertJsonPath('0.user.email', 'customer@example.com')
            ->assertJsonPath('0.order_items.0.product_name_snapshot', 'Hiraya Jacket')
            ->assertJsonPath('0.order_items.0.product.display_image_url', '/jacket-cutout.jpg');

        $superadmin = User::create([
            'full_name' => 'Platform Admin',
            'email' => 'superadmin@example.com',
            'password' => 'hashed-password',
            'role' => 'superadmin',
        ]);

        $superadminResponse = $this->actingAs($superadmin, 'sanctum')
            ->getJson('/api/admin/orders')
            ->assertOk()
            ->assertJsonPath('0.id', 42)
            ->assertJsonPath('0.order_items.0.product_name_snapshot', 'Hiraya Jacket');

        $this->assertSame(42, $customerResponse->json('0.id'));
        $this->assertSame(42, $adminResponse->json('0.id'));
        $this->assertSame(42, $superadminResponse->json('0.id'));
    }
}
