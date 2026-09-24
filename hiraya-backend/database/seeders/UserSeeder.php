<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class UserSeeder extends Seeder
{
    /**
     * Run the database seeds.
     *
     * Seeds one account per role so the role-gated routes are reachable out of
     * the box. Previously only a 'user' row was created, which meant NOBODY
     * could satisfy the EnsureUserIsAdmin middleware / AdminRoute guard and the
     * admin panel was unreachable by design.
     */
    public function run(): void
    {
        // updateOrCreate keeps re-seeding idempotent: the admin role is restored
        // even if the row already exists (e.g. it was demoted to 'user').
        \App\Models\User::updateOrCreate(
            ['email' => 'aya@hiraya.com'],
            [
                'full_name'      => 'Aya',
                'password'       => bcrypt('password123'),
                'role'           => 'user',
                // 5 Core standardized body measurements (cm)
                'chest_bust'     => 92.50,
                'waist'          => 70.00,
                'hips'           => 90.00,
                'shoulder_width' => 39.00,
                'sleeve_length'  => 64.00,
            ]
        );

        /*
         * The admin@hiraya.com / superadmin@hiraya.com dev accounts were
         * REMOVED per request (not in use yet). Only the customer seed above is
         * created. Use `php artisan hiraya:make-admin <email>` to promote a real
         * account when an admin is needed.
         */
    }
}
