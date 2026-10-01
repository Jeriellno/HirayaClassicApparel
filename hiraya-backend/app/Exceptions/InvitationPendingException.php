<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * A live invitation already exists for this address.
 *
 * WHY THIS IS ITS OWN TYPE AND NOT A STRING MATCH
 * ===============================================
 * `AdminInvitationService::invite()` needs the caller to distinguish exactly one
 * outcome from the general "something went wrong" path: the address is not
 * invalid, not taken, and not a mail failure — it was already invited, and that
 * invitation is still redeemable. The controller has to answer that specific case
 * with 409 plus the existing expiry rather than 502.
 *
 * It was tempting to keep throwing RuntimeException and sniff the message text in
 * the controller, but message-matching as control flow breaks silently the first
 * time someone rewords the string, and the failure would be a confusing 502 on a
 * perfectly ordinary "you already invited this person".
 *
 * The expiry travels ON the exception because it is only known inside the service
 * (it lives in the signed token, which is not persisted anywhere), so re-deriving
 * it in the controller would mean decoding the token a second time.
 */
class InvitationPendingException extends RuntimeException
{
    private string $expiresAt;

    public function __construct(string $message, string $expiresAt)
    {
        parent::__construct($message);

        $this->expiresAt = $expiresAt;
    }

    /** ISO-8601 expiry of the invitation that is already outstanding. */
    public function expiresAt(): string
    {
        return $this->expiresAt;
    }
}