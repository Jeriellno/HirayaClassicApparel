<?php

use App\Http\Controllers\SupabaseStorageController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

/*
|--------------------------------------------------------------------------
| SUPABASE STORAGE PROXY ROUTE
|--------------------------------------------------------------------------
|
| Deliberately unauthenticated & outside 'api' prefix so <img> tags can render
| public assets without COEP / Cross-Origin issues.
|
*/
Route::get('/supabase-storage/{path?}', SupabaseStorageController::class)
    ->where('path', '.*')
    ->withoutMiddleware('web')
    ->name('supabase.storage');