<?php

use App\Http\Controllers\SupabaseStorageController;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

/*
|--------------------------------------------------------------------------
| TEMPORARY CACHE CLEAR ROUTE (For Render / Production)
|--------------------------------------------------------------------------
|
| Access this URL once via browser to clear cached configurations and routes:
| https://hiraya-classicapparel.onrender.com/clear-everything
|
*/
Route::get('/clear-everything', function () {
    Artisan::call('config:clear');
    Artisan::call('route:clear');
    Artisan::call('cache:clear');
    Artisan::call('optimize:clear');

    return response()->json([
        'status' => 'success',
        'message' => 'All Laravel caches cleared successfully!',
    ]);
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