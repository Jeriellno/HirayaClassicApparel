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

    // Dagdag ka rin ng method para sa measurements
    public function saveMeasurements(Request $request) {
        $user = Auth::user();
        $user->update([
            'height' => $request->height,
            'waist' => $request->waist,
            'chest' => $request->chest,
        ]);
        return response()->json(['message' => 'Profile synced!']);
    }
}