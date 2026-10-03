<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Mail\Mailables\Headers;
use Illuminate\Queue\SerializesModels;

/**
 * The one-time code that proves a new customer owns the Gmail address they
 * registered with. The account is only created after this code comes back
 * (see App\Services\RegistrationVerificationService).
 */
class RegistrationCodeMail extends Mailable
{
    use Queueable;
    use SerializesModels;

    public function __construct(
        public string $email,
        public string $fullName,
        public string $code,
        public int $expiresInMinutes,
    ) {
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            to: $this->email,
            subject: 'Your Hiraya verification code: ' . $this->code,
        );
    }

    public function headers(): Headers
    {
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
            view: 'emails.registration-code',
            text: 'emails.registration-code-text',
        );
    }

    public function attachments(): array
    {
        return [];
    }
}
