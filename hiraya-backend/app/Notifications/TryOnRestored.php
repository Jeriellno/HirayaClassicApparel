<?php

namespace App\Notifications;

use App\Models\TryOnSession;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * Sent when staff restore a try-on the customer had deleted (Customers
 * Management -> Try-on history -> Restore). The bell shows it with a
 * "View try-on" button that opens the customer's try-on history.
 */
class TryOnRestored extends Notification
{
    use Queueable;

    public function __construct(private TryOnSession $session)
    {
    }

    public function via(object $notifiable): array
    {
        return ['database', 'mail'];
    }

    private function body(): string
    {
        return 'Your virtual try-on from ' . $this->session->created_at?->timezone('Asia/Manila')->format('M j, Y g:i A')
            . ' has been restored to your try-on history.';
    }

    public function toArray(object $notifiable): array
    {
        return [
            'title' => 'Try-on Restored',
            'body' => $this->body(),
            'session_id' => $this->session->session_id,
            'action' => 'view_tryon',
        ];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject('Your Hiraya try-on has been restored')
            ->greeting('Hello ' . ($notifiable->full_name ?: 'there') . ',')
            ->line($this->body())
            ->action('Open my try-on history', url('/try-on?history=1'));
    }
}
