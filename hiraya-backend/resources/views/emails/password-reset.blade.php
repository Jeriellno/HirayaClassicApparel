{{--
   Keep prose in this block SHORT and free of punctuation that can close it.
   The long explanation of why this template uses tables lives in the Mailer
   class (App\Mail\PasswordResetMail), which is PHP and has no such rule.
--}}
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>Reset your Hiraya password</title>
</head>

<body style="margin:0;padding:0;background-color:#DDBEA9;-webkit-text-size-adjust:100%;">

    <div
        style="display:none;font-size:1px;color:#DDBEA9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
        Reset your Hiraya password. This link expires in {{ $expiresInMinutes }} minutes.
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
                                Reset your password
                            </h1>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:16px 32px 0 32px;">
                            <p
                                style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#6B705C;">
                                Hi {{ $user->full_name ?: 'there' }},
                            </p>
                            <p
                                style="margin:12px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#6B705C;">
                                We received a request to reset the password on your Hiraya account.
                                Choose a new one using the button below.
                            </p>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:26px 32px 0 32px;" align="left">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td style="background-color:#CB997E;border-radius:999px;">
                                        <a href="{{ $resetUrl }}"
                                            style="display:inline-block;padding:15px 34px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:0.16em;text-transform:uppercase;color:#6B705C;text-decoration:none;border-radius:999px;">
                                            Choose a new password
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
                                This link expires in {{ $expiresInMinutes }} minutes and can be used once.
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
                                            {{ $resetUrl }}
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
                                If you did not request this, you can safely ignore this email. Your
                                password will not change, and no one can use this link unless they
                                open it.
                            </p>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:22px 32px 30px 32px;">
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
                                Hiraya will never ask for your password by email.
                            </p>
                        </td>
                    </tr>
                </table>

            </td>
        </tr>
    </table>

</body>

</html>