<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Customer feedback / survey responses.
 *
 * The Super Admin console's "User Feedback" tab and the dashboard's "Recent
 * User Responses" read this table. They used to read a Supabase `feedbacks`
 * table that nothing wrote to, so those panels were always empty. This is the
 * real, single source of truth (MySQL) that POST /api/feedback writes to.
 *
 * Guarded with hasTable so re-running against a database where the table
 * already exists is a no-op instead of a crash.
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('feedbacks')) {
            Schema::create('feedbacks', function (Blueprint $table) {
                $table->id();
                // Nullable: a GUEST may leave feedback too.
                $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->string('user_name')->nullable();
                $table->string('user_email')->nullable();
                $table->unsignedTinyInteger('rating')->default(5); // 1..5
                $table->text('comment');
                $table->timestamps();

                // The console lists newest-first, so index the sort column.
                $table->index('created_at');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('feedbacks');
    }
};
