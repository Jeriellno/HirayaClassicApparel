<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class NotificationController extends Controller
{
    /**
     * GET /api/notifications
     *
     * The signed-in user's in-app alerts, newest first, plus an unread count
     * for the Navbar bell badge.
     *
     * Wrapped in a try/catch: a failure here must NEVER take down the nav bar
     * (or the dashboard) with a raw 500. We degrade to an empty feed instead.
     */
    public function index(Request $request)
    {
        try {
            /** @var \App\Models\User $user */
            $user = $request->user();

            return response()->json([
                'notifications' => $user->notifications()->latest()->limit(30)->get(),
                'unread_count'  => $user->unreadNotifications()->count(),
            ]);
        } catch (\Throwable $e) {
            Log::error('Notification Index Error: ' . $e->getMessage());

            return response()->json([
                'notifications' => [],
                'unread_count'  => 0,
            ]);
        }
    }

    /**
     * POST /api/notifications/{id}/read
     * Marks a single notification as read.
     */
    public function markAsRead(Request $request, string $id)
    {
        try {
            /** @var \App\Models\User $user */
            $user = $request->user();
            $notification = $user->notifications()->find($id);

            if (!$notification) {
                return response()->json(['message' => 'Notification not found.'], 404);
            }

            $notification->markAsRead();

            return response()->json([
                'message'      => 'Notification marked as read.',
                'unread_count' => $user->unreadNotifications()->count(),
            ]);
        } catch (\Throwable $e) {
            Log::error('Notification MarkAsRead Error: ' . $e->getMessage());

            return response()->json(['message' => 'Failed to update the notification.'], 500);
        }
    }

    /**
     * POST /api/notifications/read-all
     */
    public function markAllAsRead(Request $request)
    {
        try {
            /** @var \App\Models\User $user */
            $user = $request->user();

            // `unreadNotifications` returns a COLLECTION, which has no
            // markAsRead() of its own — that call is what produced the
            // 500 on this endpoint. Iterate instead.
            $user->unreadNotifications->each->markAsRead();

            return response()->json([
                'message'      => 'All notifications marked as read.',
                'unread_count' => 0,
            ]);
        } catch (\Throwable $e) {
            Log::error('Notification MarkAllAsRead Error: ' . $e->getMessage());

            return response()->json(['message' => 'Failed to update the notifications.'], 500);
        }
    }
}
