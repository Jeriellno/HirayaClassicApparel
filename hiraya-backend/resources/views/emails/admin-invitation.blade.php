{{--
Keep prose in this block SHORT and free of punctuation that can close it.
The long explanation of why this template uses tables lives in the Mailer
class (App\Mail\AdminInvitationMail), which is PHP and has no such rule.

WHAT THIS MAIL MUST NOT CONTAIN: no password, and no authenticator secret or
QR code. Both are created by the invitee at the far end of the link. A
superadmin who sent this cannot sign in as the person they invited, and the
second factor belongs to the invitee's own phone alone.
--}}
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>You are invited to the Hiraya Admin Console</title>
</head>

<body style="margin:0;padding:0;background-color:#DDBEA9;-webkit-text-size-adjust:100%;">

    <div
        style="display:none;font-size:1px;color:#DDBEA9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
        Set your password and enroll your authenticator. This invitation expires in {{ $ttlHours }} hours.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
        style="background-color:#DDBEA9;padding:32px 12px;">
        <tr>
            <td align="center">

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                    style="max-width:520px;background-color:#FFE8D6;border-radius:24px;overflow:hidden;">

                    <tr>
                        <td style="padding:28px 32px 0 32px;" align="left">
                            <span
                                style="font-family:'Times New Roman',Georgia,serif;font-size:20px;letter-spacing:0.28em;text-transform:uppercase;color:#6B705C;font-weight:600;">
                                Hiraya
                            </span>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:22px 32px 0 32px;">
                            <h1
                                style="margin:0;font-family:'Times New Roman',Georgia,serif;font-size:26px;line-height:1.25;letter-spacing:0.06em;text-transform:uppercase;color:#6B705C;font-weight:400;">
                                You are invited
                            </h1>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:16px 32px 0 32px;">
                            <p
                                style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#6B705C;">
                                {{ $invitedBy }} has invited you to the Hiraya Admin Console as
                                <strong style="text-transform:uppercase;">{{ $role }}</strong>.
                            </p>
                            <p
                                style="margin:12px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#6B705C;">
                                Choose your own password, then set up an authenticator app. Your account
                                stays inactive until both steps are done.
                            </p>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:26px 32px 0 32px;" align="left">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td style="background-color:#CB997E;border-radius:999px;">
                                        <a href="{{ $url }}"
                                            style="display:inline-block;padding:15px 34px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:0.16em;text-transform:uppercase;color:#6B705C;text-decoration:none;border-radius:999px;">
                                            Accept invitation
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:20px 32px 0 32px;">
                            <p
                                style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:#A5A58D;">
                                This invitation expires in {{ $ttlHours }} hours and can be used once.
                            </p>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:20px 32px 0 32px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                                style="background-color:#DDBEA9;border-radius:14px;">
                                <tr>
                                    <td style="padding:14px 16px;">
                                        <p
                                            style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#6B705C;font-weight:bold;">
                                            Button not working?
                                        </p>
                                        <p
                                            style="margin:0;font-family:'Courier New',Courier,monospace;font-size:11px;line-height:1.6;color:#6B705C;word-break:break-all;">
                                            {{ $url }}
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:22px 32px 0 32px;">
                            <p
                                style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:#6B705C;">
                                Each administrator has their own account and their own authenticator. Never
                                share your password or your 6-digit codes with anyone.
                            </p>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:22px 32px 30px 32px;">
                            <p
                                style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:#6B705C;">
                                If you were not expecting this, you can ignore it and no account will be
                                created for you.
                            </p>
                            <p
                                style="margin:22px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#A5A58D;">
                                Sent by Hiraya, Virtual Wardrobe. This is an automated message, so
                                replies are not monitored.
                            </p>
                        </td>
                    </tr>

                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                    style="max-width:520px;">
                    <tr>
                        <td style="padding:16px 8px 0 8px;" align="center">
                            <p
                                style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#6B705C;opacity:0.75;">
                                Hiraya will never ask for your password or your 6-digit code by email.
                            </p>
                        </td>
                    </tr>
                </table>

            </td>
        </tr>
    </table>

</body>

</html>