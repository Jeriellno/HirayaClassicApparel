<?php

/*
|--------------------------------------------------------------------------
| Try-On Gallery, Render Storage and Render Reuse
|--------------------------------------------------------------------------
|
| `renders_bucket`   PRIVATE Supabase Storage bucket the finished renders are
|                    written to (encrypted with the app key before upload, see
|                    App\Support\RenderVault). Never a public bucket.
|
| `trash_retention_days`  How long a render stays in "Recently Deleted" before
|                    it is permanently purged (DB row + stored object).
|
| `render_version`   Part of the duplicate-render fingerprint. Bump it (env
|                    TRYON_RENDER_VERSION) when the render pipeline changes so
|                    an old cached render is not reused for a new pipeline.
|
*/

return [
    'renders_bucket' => env('TRYON_RENDERS_BUCKET', 'renders'),

    'trash_retention_days' => (int) env('TRYON_TRASH_RETENTION_DAYS', 30),

    'render_version' => env('TRYON_RENDER_VERSION', 'v1'),
];
