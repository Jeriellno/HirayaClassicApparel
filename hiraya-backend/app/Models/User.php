<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    /**
     * The attributes that are mass assignable.
     *
     * @var array<int, string>
     */
    protected $fillable = [
        'full_name',
        'email',
        'password',
        'role',

        /*
         * THE SUPABASE AUTH IDENTITY UUID.
         *
         * A staff account exists in two systems and this is the join. A staff sign-in
         * verifies the password against BOTH `users.password` and Supabase's GoTrue,
         * and the console is authorized by the Supabase JWT — so without this link
         * there is no way to tell which Supabase identity a Laravel row belongs to.
         *
         * It is fillable because provisioning sets it as part of creating the
         * account (App\Support\SupabaseIdentity writes the GoTrue half; the caller
         * writes this uuid). It is deliberately NOT settable from any request payload:
         * no controller validates or accepts it, so it cannot be pointed at someone
         * else's identity through the API.
         */
        'auth_id',

        // RBAC fields surfaced by the Super Admin "Admin Accounts" table.
        'inventory_permissions',
        'ai_rules_access',
        'last_login_at',
        'suspended_at',

        /*
         * THE ACTIVATION STAMP FOR AN INVITED ADMIN.
         *
         * Null means the account has a password but NO second factor, so it must
         * not reach the console. It is written only by
         * AdminAccountController::markMfaEnrolled(), from the invitee's own aal2
         * session — never from a request payload, so no caller can activate
         * another account or activate their own early.
         */
        'mfa_enrolled_at',

        /*
         * SIZING PROFILE — two size labels, not five centimetre measurements.
         *
         * These replaced the old `chest_bust` / `waist` / `hips` /
         * `shoulder_width` / `sleeve_length` decimals (see the
         * 2026_09_29_120000 migration). A customer picks the sizes they wear;
         * every consumer resolves actual centimetres from App\Services\SizeChart
         * for those labels, so there is ONE size chart rather than a per-user
         * copy of numbers that could never be kept in step with the catalogue.
         */
        'upper_body_size',
        'lower_body_size',

        'preferred_fit',
        // male / female — filters the Home recommendation feed by product gender.
        'gender',
        'user_photo_url',
        'portrait_base64',
    ];

    /**
     * The attributes that should be cast.
     *
     * The sizing fields are plain size-label STRINGS, so they need no cast;
     * they are returned verbatim to JSON.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'ai_rules_access'   => 'boolean',
            'last_login_at'     => 'datetime',
            'suspended_at'      => 'datetime',
            'mfa_enrolled_at'   => 'datetime',
        ];
    }

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var array<int, string>
     */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * Relationship: User has many CartItems
     */
    public function cartItems(): HasMany
    {
        return $this->hasMany(CartItem::class);
    }

    /**
     * Relationship: User has many Orders.
     */
    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    /**
     * Relationship: User has many TryOnSessions
     */
    public function tryOnSessions(): HasMany
    {
        return $this->hasMany(TryOnSession::class);
    }
}