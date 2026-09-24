<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\SupabaseStorage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * UploadController — the single server-side entry point for asset uploads.
 *
 * WHY THE UPLOAD IS HERE AND NOT IN THE BROWSER
 * ---------------------------------------------
 * The Admin console used to POST files straight to Supabase from the browser
 * (`supabase.storage.from('products').upload(...)`), which required the
 * `service_role` key in the front-end bundle. That key bypasses RLS on every
 * table and bucket in the project, so publishing it to every visitor handed out
 * full admin access to the whole database.
 *
 * Moving the write here keeps the credential on the server. The bucket is still
 * public for READS, so nothing else about how images are served changes.
 *
 * GATED BY `auth:sanctum` + `admin`
 * ---------------------------------
 * Only an authenticated admin may write to the bucket. The front-end sends its
 * Sanctum token via the same axios instance every other admin call uses.
 */
class UploadController extends Controller
{
    /**
     * The bucket-relative folders this endpoint will write into.
     *
     * An ALLOWLIST, not a free-form path: without it a caller could write anywhere
     * in the bucket (including over another product's object by choosing its key).
     */
    private const ALLOWED_FOLDERS = ['catalog', 'products', 'orders'];

    /**
     * POST /api/upload
     *
     * multipart/form-data:
     *   file    the upload (required)
     *   folder  bucket-relative folder (optional, defaults to `catalog`)
     *
     * @return JsonResponse { url: string }  root-relative path for the DB column
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            /*
             * Image-only, and bounded. These match `ProductRequest`'s upload rules
             * (10 MB) because the composited marketing card is a re-encoded PNG
             * that routinely lands in the 4-10 MB range even from a small photo.
             */
            'file'   => 'required|image|mimes:jpeg,png,jpg,webp,gif|max:10240',
            'folder' => 'nullable|string',
        ]);

        $folder = (string) ($validated['folder'] ?? 'catalog');

        if (!in_array($folder, self::ALLOWED_FOLDERS, true)) {
            return response()->json([
                'message' => 'That upload folder is not allowed.',
            ], 422);
        }

        try {
            $url = SupabaseStorage::putUploadedFile($request->file('file'), $folder);

            return response()->json(['url' => $url], 201);
        } catch (Throwable $e) {
            /*
             * Surface the REAL reason to the caller. The admin UI shows
             * `res.data.message`, and "a missing bucket", "RLS denied" and "the
             * Supabase project is unreachable" each need a different fix — a
             * generic "upload failed" would hide which one it is, which is exactly
             * how the original silent-failure bug stayed invisible for so long.
             */
            Log::error('UploadController: upload failed.', [
                'folder' => $folder,
                'error'  => $e->getMessage(),
            ]);

            return response()->json([
                'message' => $e->getMessage(),
            ], 502);
        }
    }
}
