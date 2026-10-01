<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * The invitation an invited administrator receives.
 *
 * WHAT IT DELIBERATELY DOES NOT CONTAIN
 * -------------------------------------
 * No password, and no TOTP secret or QR code. Both are created by the invitee
 * at the other end of the link, which is the entire point of an invitation: the
 * superadmin who sends this cannot sign in as the admin they created, and the
 * admin's second factor is a factor only the admin holds.
 *
 * The link IS the credential, so the mail says so and gives the expiry.
 */
class AdminInvitationMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $email,
        public readonly string $url,
        public readonly string $role,
        public readonly string $invitedBy,
        public readonly int $ttlMinutes,
    ) {
    }

    public function envelope(): Envelope
    {
        /*
         * THE RECIPIENT MUST BE NAMED EXPLICITLY.
         *
         * This used to pass only a `subject`, on the assumption that Laravel would
         * work the address out from the mailable's own `$email` property. It does
         * not: a Mailable has no convention that maps an arbitrary property to the
         * recipient, and Symfony's Mime mailer refuses to send at all without a
         * To/Cc/Bcc header — "An email must have a To, Cc, or Bcc header."
         *
         * So `POST /api/admin/accounts/invite` did not merely fail to deliver, it
         * failed to SEND, and because AdminInvitationService deliberately REPORTS a
         * mail failure rather than swallowing it (unlike the password-reset path,
         * which must not become an enumeration oracle), the whole request died with
         * a 502. The invitation was never delivered to anyone, on any environment,
         * with any mail configuration.
         *
         * `$this->email` is the address the superadmin just typed and the one the
         * token is bound to, so it is the correct recipient — this only has to say
         * so out loud.
         */
        return new Envelope(
            to: $this->email,
            subject: 'You have been invited to the Hiraya Admin Console',
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.admin-invitation',
            with: [
                'email' => $this->email,
                'url' => $this->url,
                'role' => $this->role,
                'invitedBy' => $this->invitedBy,
                'ttlHours' => (int) round($this->ttlMinutes / 60),
            ],
        );
    }
}