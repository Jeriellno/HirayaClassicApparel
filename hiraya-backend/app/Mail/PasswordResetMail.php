<?php

namespace App\Mail;

use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Mail\Mailables\Headers;
use Illuminate\Queue\SerializesModels;

/**
 * PASSWORD RESET EMAIL.
 *
 * DESIGN CONSTRAINTS THAT SHAPED THIS FILE
 * ----------------------------------------
 * 1. IT ARRIVES IN A HOSTILE ENVIRONMENT. Password reset mail is the single most
 *    spoofed message class in existence, so inbox providers treat it harshly. The
 *    subject says exactly what the mail is and nothing more, there is no
 *    attachment, no tracking pixel and no remote image — a message that cannot be
 *    used to track a reader and does not need images to be understood.
 *
 * 2. IT MUST BE READABLE IN PLAIN TEXT. A meaningful share of recipients view
 *    mail with HTML off, and a reset link that only exists inside HTML is a
 *    support ticket. Laravel renders `text` alongside this template for exactly
 *    that case, so the URL is present in the raw text body too.
 *
 * 3. IT MUST NOT LEAK THE TOKEN TO HEADERS. `Headers` sets the transactional
 *    markers that keep a reset message out of marketing buckets, and deliberately
 *    nothing else.
 */
class PasswordResetMail extends Mailable
{
    use Queueable;
    use SerializesModels;

    public function __construct(
        public User $user,
        public string $resetUrl,
        public int $expiresInMinutes = 60,
    ) {
    }

    public function envelope(): Envelope
    {
        /*
         * `to:` IS NOT OPTIONAL HERE.
         *
         * A Mailable does not infer the recipient from the `$user` it was given —
         * there is no convention that says `$this->user` means "send it there".
         * Without this line Symfony throws
         *
         *   An email must have a "To", "Cc", or "Bcc" header.
         *
         * at SEND time, after the views have already rendered successfully, so the
         * failure surfaces as a mail exception rather than an obvious template
         * error.
         */
        return new Envelope(
            to: $this->user->email,
            subject: 'Reset your Hiraya password',
        );
    }

    public function headers(): Headers
    {
        /*
         * `X-Mailer` identifies the sender as the application rather than a bulk
         * mail service, and the auto-submitted markers tell a well-behaved
         * autoresponder not to reply. Neither carries the token.
         */
        return new Headers(
            text: [
                'X-Mailer' => 'Hiraya',
                'Auto-Submitted' => 'auto-generated',
                'X-Auto-Response-Suppress' => 'All',
            ],
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.password-reset',
            text: 'emails.password-reset-text',
        );
    }

    public function attachments(): array
    {
        return [];
    }
}