# HIRAYA — BODY-PHOTO VERIFICATION: FIX AND OPERATIONS GUIDE

This file explains the fix for the customer-facing message:

> "Your photo could not be verified right now, so it was not accepted. Please
> check your connection and upload a clear full-body photo of yourself."

## 1. What the message ACTUALLY means (it is NOT a file-size limit)

It comes from `hiraya-frontend/src/utils/validateBodyPhoto.js:573`. There are two
different messages for the same "we did not see a person", and they mean opposite
things:

| Condition | Message shown | Meaning |
|---|---|---|
| `verified: true` | "No person could be found..." | The AI **answered**, and said there is no person |
| `verified: false` | "could not be verified right now..." | The AI **could not answer at all** |

The message in this report is the SECOND one. **It has nothing to do with the
5 MB / 3.5 MB upload limits.** The photo was never even judged.

`verified: false` is produced when every provider in the chain fails. The reason
is one of: `no-api-key`, `unreachable`, `upstream-error`, `unparseable`,
`quota`, `model-retired`.

## 2. Root cause (measured, from this deployment's own log)

```
Quota exceeded for metric: generate_content_free_tier_requests, limit: 20
```

The Gemini **free tier answers only 20 vision requests PER DAY**, shared with the
catalog auto-fill. When that bucket drains, every legitimate upload is refused.
With only `gemini` configured, there is no second provider to fall back to — so
the whole try-on feature stops until the quota resets.

A second, separate failure appeared the same day:

```
404: This model models/gemini-2.5-flash-lite is no longer available to new users.
```

A retired model ID. That was already corrected in `.env`
(`GEMINI_VISION_MODEL=gemini-3.5-flash-lite`); the log entries predate the fix.

## 3. What was changed

### 3.1 Fallback provider chain (the real fix for the quota wall)

`hiraya-backend/.env`:

```
PERSON_VERIFY_PROVIDERS=gemini,cloudflare,groq
```

Previously this was just `gemini`. Now, when Gemini is out of quota, the chain
moves to the next provider instead of refusing the customer. **Providers with no
key are skipped automatically**, so this line costs nothing until you paste a
credential.

### 3.2 `verdict()` is now fail-CLOSED (bug fix)

`PersonVerificationController::verdict()` used to be a BLOCKLIST:

```php
'verified' => ! in_array($reason, ['no-api-key', 'unreachable', ...])
```

Any reason missing from that list was treated as "the model answered". The
retired model's reason, `model-retired`, was NOT in the list — so the response
came back `verified: true` with `has_person: false`, and the customer was told
**"No person could be found in this photo"** when in fact **no model ever looked
at it**. Confident and wrong.

It is now an ALLOW-LIST: only `person` and `no-person` count as an answer.
Anything else — including a reason that does not exist yet — is fail-closed.

### 3.3 `parseVerdict()` emits a canonical reason

The model returns prose ("real human person wearing a t-shirt and jeans"). That
prose used to be passed through as `reason`, which the new allow-list would have
rejected — turning a **successful** verification into "could not be verified".
The control token is now always `person` / `no-person`, and the model's own
wording is preserved in a separate `detail` field.

### 3.4 Diagnostics

- `configuredProviders()` now RECORDS why a provider was skipped
  (`no-api-key` / `unknown-provider`) instead of dropping it silently.
- The chain reports the MOST INFORMATIVE failure, not the last one. A chain of
  `gemini(quota) -> cloudflare(no key)` used to report `no-api-key`, hiding the
  drained quota. Quota ranks highest, because it needs a different fix.

### 3.5 New command: `tryon:clear-verify-cache`

Verdicts are cached for 24 hours, keyed by image hash — **shared across all
users**. The cached payload SHAPE changed in this fix, so old entries must go.

```
cd hiraya-backend
php artisan tryon:clear-verify-cache
```

Run it after changing: the verification prompt, the provider chain, the
confidence threshold, or the verdict payload shape.

It is scoped: it deletes only person-verification entries, and **never** touches
sessions, rate limiters or product caches. (Verified by a test that writes one of
each and confirms the unrelated entry survives.)

## 4. WHAT YOU STILL NEED TO DO (one step, ~2 minutes)

The chain has room for a fallback but **no fallback key is set yet**. Until one
is, a drained Gemini quota still stops verification.

**Recommended: Cloudflare Workers AI** — free, no credit card, daily neuron
budget far above 20 requests.

1. Go to https://dash.cloudflare.com and copy your **Account ID** (right sidebar).
2. My Profile -> API Tokens -> Create Token -> custom token with the
   **Workers AI** permission (`Account.Workers AI:Read`).
3. Paste into `hiraya-backend/.env`:

```
CLOUDFLARE_ACCOUNT_ID=<your account id>
CLOUDFLARE_API_TOKEN=<your token>
```

That is all. `cloudflare` is already listed in `PERSON_VERIFY_PROVIDERS`, so the
fallback activates on the next request with **no code change**.

**Alternative: Groq** — also free. https://console.groq.com/keys then
`GROQ_API_KEY=<key>`. (Already listed in the chain and supported by the code.)

To confirm it is live:

```
cd hiraya-backend
php artisan config:clear
cd ..
php _smoke_verify_person.php     # should show "fallback provider : YES"
```

## 5. THE TESTS (all pass; run them after any change here)

```
php _smoke_verify_person.php        # live call against the real chain
php _smoke_verdict_contract.php     # the fail-closed allow-list + canonical reason
php _smoke_vton.php                 # VTON provider config
```

`_smoke_verdict_contract.php` deliberately includes `model-retired` and a
made-up reason, to prove the gate is fail-closed rather than fail-open.

## 6. HONEST LIMITS

- The 20/day Gemini wall is **reduced, not removed**, until a fallback key is
  pasted. With a key, a drained Gemini bucket becomes a non-event.
- The gate is intentionally STRICT — it will refuse a photo it cannot judge. That
  is the correct direction for the rule "bawal ang image na walang person": a
  false refusal costs a re-upload, a false acceptance dresses a photo of nobody.
- The 5 MB file limit (`MAX_FILE_UPLOAD_SIZE`) and the 3.5 MB server backstop are
  **unchanged and unrelated to this bug**. They exist because the try-on provider
  resets the connection on a ~4.8 MB Base64 payload (`cURL error 56`). Do not
  remove them to "fix" this message — they would not help and would reintroduce
  that failure.