<?php

namespace App\Notifications;

use App\Models\Order;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;
use Illuminate\Notifications\Messages\MailMessage;

/**
 * Notifies a customer that their order moved to a new state.
 *
 * Delivered through two channels:
 *  - 'database' powers the in-app notification bell.
 *  - 'mail' is the email layer. It will queue/attempt delivery once the app's
 *    mail transport is configured; until then the database copy still lands.
 */
class OrderStatusChanged extends Notification
{
    use Queueable;

    public function __construct(
        public Order $order,
        public string $title,
        public string $body,
        // Optional call-to-action the bell renders as a button. Currently only
        // 'review_products', sent when an order is marked delivered.
        public ?string $action = null,
    ) {
    }

    /**
     * @return array<int, string>
     */
    public function via(object $notifiable): array
    {
        return ['database', 'mail'];
    }

    /**
     * Shape stored in the `notifications` table (read by the bell UI).
     *
     * @return array<string, mixed>
     */
    public function toArray(object $notifiable): array
    {
        return [
            'order_id' => $this->order->id,
            'title' => $this->title,
            'body' => $this->body,
            'payment_status' => $this->order->payment_status,
            'order_status' => $this->order->order_status,
            'total_amount' => $this->order->total_amount,
            'action' => $this->action,
        ];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $mail = (new MailMessage)
            ->subject($this->title . ' — Hiraya Order #' . $this->order->id)
            ->greeting('Hiraya Order Update')
            ->line($this->body)
            ->line('Order #' . $this->order->id . ' · Total ₱' . number_format((float) $this->order->total_amount, 2));

        if ($this->action === 'review_products') {
            return $mail->action('Review Products', url('/orders?order=' . $this->order->id));
        }

        // Orders are paid in full now; only a legacy 50/50 order still awaiting
        // its balance gets the "balance due" line.
        if ($this->order->payment_status === '50_paid' && (float) $this->order->balance_amount > 0) {
            $mail->line('Balance due before shipping: ₱' . number_format((float) $this->order->balance_amount, 2));
        }

        return $mail->action('Track My Order', url('/orders'));
    }
}
