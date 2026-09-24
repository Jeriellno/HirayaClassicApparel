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

        // RBAC fields surfaced by the Super Admin "Admin Accounts" table.
        'inventory_permissions',
        'ai_rules_access',
        'last_login_at',
        'suspended_at',

        // 5 Core standardized body measurements (identical for Men & Women)
        'chest_bust',
        'waist',
        'hips',
        'shoulder_width',
        'sleeve_length',

        'top_size',
        'bottom_size',
        'preferred_fit',
        'user_photo_url',
        'portrait_base64',
    ];

    /**
     * The attributes that should be cast.
     *
     * Ensures measurement fields are returned as numeric types
     * (not strings) when the User is serialized to JSON.
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
            'chest_bust'        => 'decimal:2',
            'waist'             => 'decimal:2',
            'hips'              => 'decimal:2',
            'shoulder_width'    => 'decimal:2',
            'sleeve_length'     => 'decimal:2',
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