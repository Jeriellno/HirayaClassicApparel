<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

class AiTryOnController extends Controller
{
    public function upload(Request $request) 
    {
        $request->validate([
            'image' => 'required|string', 
            'type' => 'required|string'
        ]);

        try {
            $base64Image = $request->input('image');
            
            if (preg_match('/^data:image\/(\w+);base64,/', $base64Image, $type)) {
                $data = substr($base64Image, strpos($base64Image, ',') + 1);
                $type = strtolower($type[1]);
                
                if (!in_array($type, ['jpg', 'jpeg', 'gif', 'png'])) {
                    throw new \Exception('invalid image type');
                }
                $data = base64_decode($data);
            } else {
                throw new \Exception('did not match data URI');
            }

            $fileName = Str::random(10) . '.' . $type;
            $path = 'tryon/' . $fileName;
            Storage::disk('public')->put($path, $data);
            $fullUrl = asset('storage/' . $path);

            // --- DAY 10 SYNC LOGIC ---
            $user = Auth::user(); 
            if ($user && $request->type === 'user_photo') {
                $user->update(['user_photo_url' => $fullUrl]);
            }

            return response()->json([
                'url' => $fullUrl,
                'message' => 'Upload successful'
            ], 200);

        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /*
     * Save the customer's sizing profile.
     *
     * This used to write `height` / `waist` / `chest` — columns that were
     * dropped when the 5 Core Body Measurements were replaced by two size
     * labels, so the call would have thrown on an unknown column. It now
     * persists the two sizes and validates them against the same ladder the
     * registration and Account Settings endpoints use.
     */
    public function saveMeasurements(Request $request) {
        $user = Auth::user();

        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $validated = $request->validate([
            'upper_body_size' => ['nullable', 'string', 'max:10', 'in:XS,S,M,L,XL,2XL'],
            'lower_body_size' => ['nullable', 'string', 'max:10', 'in:XS,S,M,L,XL,2XL'],
        ], [
            'upper_body_size.in' => 'Please choose a valid upper body size.',
            'lower_body_size.in' => 'Please choose a valid lower body size.',
        ]);

        $user->update($validated);

        return response()->json([
            'message' => 'Profile synced!',
            'sizes'   => [
                'upper_body_size' => $user->upper_body_size,
                'lower_body_size' => $user->lower_body_size,
            ],
        ]);
    }
}