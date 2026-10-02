<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A piece of customer feedback / survey response.
 *
 * This is the REAL store behind the Super Admin "User Feedback" tab and the
 * dashboard's "Recent User Responses". The console previously read a Supabase
 * `feedbacks` table that had NO writer anywhere in the app, so the tab was
 * permanently empty; this model + the POST /api/feedback endpoint are the
 * missing writer.
 */
class Feedback extends Model
{
    protected $table = 'feedbacks';

    protected $fillable = [
        'user_id',
        'user_name',
        'user_email',
        'rating',
        'comment',
        'order_id',
    ];

    protected $casts = [
        'rating' => 'integer',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    /** The registered user who left this feedback, when there was one. */
    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
