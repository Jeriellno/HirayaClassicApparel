<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('try_on_sessions', function (Blueprint $table) {
            $table->boolean('is_favorite')->default(false)->after('status');
            $table->string('history_title')->nullable()->after('is_favorite');
            $table->json('garment_metadata_json')->nullable()->after('history_title');
            $table->index(['user_id', 'status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::table('try_on_sessions', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'status', 'created_at']);
            $table->dropColumn(['is_favorite', 'history_title', 'garment_metadata_json']);
        });
    }
};
