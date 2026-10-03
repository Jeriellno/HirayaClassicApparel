{{-- Same table layout and palette as password-reset.blade.php --}}
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>Verify your Hiraya account</title>
</head>

<body style="margin:0;padding:0;background-color:#DDBEA9;-webkit-text-size-adjust:100%;">

    <div
        style="display:none;font-size:1px;color:#DDBEA9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
        Your Hiraya verification code is {{ $code }}. It expires in {{ $expiresInMinutes }} minutes.
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
                                Verify your email
                            </h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:16px 32px 0 32px;">
                            <p
                                style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#6B705C;">
                                Hi {{ $fullName ?: 'there' }},
                            </p>
                            <p
                                style="margin:12px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#6B705C;">
                                Enter this code on the Hiraya sign-up page to finish creating your account.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:24px 32px 0 32px;" align="left">
                            <span
                                style="display:inline-block;padding:14px 26px;background-color:#CB997E;border-radius:16px;font-family:'Courier New',Courier,monospace;font-size:30px;font-weight:bold;letter-spacing:0.35em;color:#3D3F33;">
                                {{ $code }}
                            </span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:20px 32px 0 32px;">
                            <p
                                style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:#A5A58D;">
                                This code expires in {{ $expiresInMinutes }} minutes and can be used once.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:22px 32px 30px 32px;">
                            <p
                                style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:#6B705C;">
                                If you did not sign up for Hiraya, you can safely ignore this email. No account is
                                created unless this code is entered.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>

</body>

</html>
