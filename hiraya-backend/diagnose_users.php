<?php
// Diagnostic: inspect the users table rows and confirm which profile
// fields actually hold data in Supabase Postgres.
$users = \App\Models\User::all(['id', 'full_name', 'email', 'role', 'chest_bust', 'waist', 'hips', 'shoulder_width', 'sleeve_length', 'top_size', 'bottom_size', 'preferred_fit']);
echo "USER COUNT: " . $users->count() . PHP_EOL;
foreach ($users as $u) {
    echo "----------------------------------------" . PHP_EOL;
    echo "id:             " . $u->id . PHP_EOL;
    echo "full_name:      " . ($u->full_name ?? 'NULL') . PHP_EOL;
    echo "email:          " . ($u->email ?? 'NULL') . PHP_EOL;
    echo "role:           " . ($u->role ?? 'NULL') . PHP_EOL;
    echo "chest_bust:     " . ($u->chest_bust ?? 'NULL') . PHP_EOL;
    echo "waist:          " . ($u->waist ?? 'NULL') . PHP_EOL;
    echo "hips:           " . ($u->hips ?? 'NULL') . PHP_EOL;
    echo "shoulder_width: " . ($u->shoulder_width ?? 'NULL') . PHP_EOL;
    echo "sleeve_length:  " . ($u->sleeve_length ?? 'NULL') . PHP_EOL;
    echo "top_size:       " . ($u->top_size ?? 'NULL') . PHP_EOL;
    echo "bottom_size:    " . ($u->bottom_size ?? 'NULL') . PHP_EOL;
    echo "preferred_fit:  " . ($u->preferred_fit ?? 'NULL') . PHP_EOL;
}