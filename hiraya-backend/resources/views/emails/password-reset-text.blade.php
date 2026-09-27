{{-- Plain-text alternative. A multipart message with no text part is scored as bulk mail, and a share of recipients read mail with HTML off. --}}
Hi {{ $user->full_name ?: 'there' }},

We received a request to reset the password on your Hiraya account.

Choose a new password using this link:

{{--
   This template uses the raw-output Blade tag, not the escaped one.

   The escaped tag HTML-encodes its value. That is correct in an HTML body, but
   this is the PLAIN-TEXT part: encoding here rewrites every ampersand in the
   query string as an entity, so a customer who copies the link pastes broken
   text into their browser and the token fails.

   The value is a URL this application generated itself rather than user input,
   and a text body has no markup context for an injection to land in.
--}}
{!! $resetUrl !!}

This link expires in {{ $expiresInMinutes }} minutes and can be used once.

If you did not request this, you can safely ignore this email. Your password
will not change, and no one can use this link unless they open it.

Sent by Hiraya, Virtual Wardrobe. This is an automated message, so replies are
not monitored.

Hiraya will never ask for your password by email.