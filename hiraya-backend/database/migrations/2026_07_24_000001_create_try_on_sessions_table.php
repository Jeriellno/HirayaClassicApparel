<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('try_on_sessions', function (Blueprint $table) {
            $table->id();
            $table->string('session_id', 64)->unique(); // Unique session identifier (tryon_ + UUID)
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->longText('user_photo_base64'); // User portrait Base64
            $table->longText('garment_photos_json'); // JSON array of garment Base64 strings
            $table->json('measurements_json'); // height, waist, chest
            $table->string('status')->default('queued'); // queued, processing, completed, failed
            $table->longText('result_image_base64')->nullable(); // Generated result Base64
            $table->text('ai_feedback')->nullable(); // AI fit feedback
            $table->text('error_message')->nullable(); // Error details if failed
            $table->timestamps();

            // Indexes for performance
            $table->index('session_id');
            $table->index('user_id');
            $table->index('status');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('try_on_sessions');
    }
};