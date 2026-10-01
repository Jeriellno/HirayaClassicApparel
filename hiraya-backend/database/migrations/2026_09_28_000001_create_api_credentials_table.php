<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * EXTERNAL API CREDENTIALS — the database half of Dynamic API Key Management.
 *
 * WHY A TABLE WHEN .env ALREADY WORKS
 * ------------------------------------
 * `.env` cannot be edited from a running app. Rotating a key meant: SSH in, edit
 * a file, `config:clear`, restart the worker — a manual step that is impossible
 * when a daily-quota key dies at 2am and every customer sees a failure. Worse,
 * rotating a key in `.env` is not history: the old key is gone, and there is
 * nothing in the database saying when it was replaced or whether the new one was
 * ever verified.
 *
 * This table makes the credential a first-class, rotatable, auditable row.
 *
 * THE SECRET IS ENCRYPTED AT REST, AND WHY
 * --------------------------------------
 * `secret_ciphertext` holds Laravel's `Crypt::encryptString()` output — never a
 * plaintext key. The Supabase service-role key bypasses RLS, and a PixelAPI or
 * Gemini key can be spent directly, so a database dump must not be enough to
 * impersonate Hiraya. Encryption uses `APP_KEY`, which is already required to
 * run the app and is already a secret. It also means the column can never be
 * rendered by accident: reading it into a response requires an explicit decrypt.
 *
 * WHY `fingerprint` AND NOT THE PLAIN KEY FOR LOOKUPS
 * ---------------------------------------------------
 * A key must be findable ("is this the key already stored?") without decrypting
 * every row. `fingerprint` is a SHA-256 of the secret, which lets us detect a
 * duplicate on insert and recognise a key we already hold, while revealing
 * nothing usable. It is deliberately NOT the key itself and NOT reversible.
 *
 * `is_active` IS THE "WHICH KEY ANSWERS NOW" FLAG
 * -----------------------------------------------
 * The claim the panel makes is that the active key lives in the database, and
 * this column is what makes that true: at most one row is active per provider,
 * and `ApiCredentialStore` resolves the active row first. A key that expires is
 * marked inactive (never deleted) so the history of what was tried — and when —
 * survives, which is what makes a failure diagnosable after the fact.
 *
 * `expires_at` IS WHY "DYNAMIC" IS ACCURATE
 * ------------------------------------------
 * A vendor that hands out short-lived tokens tells us when it dies. Without this
 * column, `hiraya:refresh-api-keys` can only discover a dead key by making a
 * failing request — which it should not do in production traffic. With it, the
 * scheduled task can rotate BEFORE the customer experiences the failure.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('api_credentials', function (Blueprint $table) {
            $table->id();

            /**
             * WHICH VENDOR: 'pixelapi' | 'gemini' | 'supabase' — matches the keys
             * already used by ApiStatusController::registry(), so the panel and the
             * status screen speak the same vocabulary.
             */
            $table->string('provider', 40)->index();

            /**
             * A human label the operator picks, e.g. "Primary — aistudio account".
             * Never the key itself: this column is shown in the console, in
             * listings and in logs, so it must be safe to render anywhere.
             */
            $table->string('label', 120);

            /** Encrypted at rest. See the class note. */
            $table->text('secret_ciphertext');

            /**
             * SHA-256 of the plaintext secret, for duplicate detection and for
             * recognising a key already on file. Not reversible, not the key.
             */
            $table->char('fingerprint', 64)->index();

            /**
             * THE ACTIVE KEY. At most one row per provider is expected to be
             * active; the service enforces that in a transaction when promoting.
             */
            $table->boolean('is_active')->default(false)->index();

            /**
             * When the vendor says this credential dies. NULL = no known expiry
             * (a long-lived API key), which is the common case for Gemini.
             */
            $table->timestamp('expires_at')->nullable()->index();

            /**
             * Last time a scheduled or manual verification actually exercised the
             * key against the vendor. A NULL here is meaningful: it means the key
             * has NEVER been proven, which the panel surfaces as "unverified"
             * rather than silently reporting green.
             */
            $table->timestamp('last_verified_at')->nullable();

            /**
             * The verdict of the last verification, so a rotated-away key still
             * carries the reason it was rotated: 'valid' | 'unauthorized' |
             * 'rate_limited' | 'error'. Mirrors ProviderHealthEvent's vocabulary.
             */
            $table->string('last_status', 40)->nullable();
            $table->text('last_message')->nullable();

            /**
             * When the key was retired. Set instead of deleting, so the console can
             * show what was in play and when it was replaced.
             */
            $table->timestamp('retired_at')->nullable();

            /** Who made the change — an audit trail, not just a status display. */
            $table->unsignedBigInteger('created_by')->nullable();

            $table->timestamps();

            /**
             * A key's fingerprint is unique per provider. This is the database-level
             * guarantee that the same key cannot be added twice under two labels.
             */
            $table->unique(['provider', 'fingerprint']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('api_credentials');
    }
};
