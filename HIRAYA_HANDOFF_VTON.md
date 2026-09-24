# HIRAYA — VIRTUAL TRY-ON: CONTINUATION HANDOFF

Paste the section below ("COPY FROM HERE") as the FIRST message in the new CodeGPT
session / Google account. Everything above that marker is just reading for you.

---

## What this file is

A context-transfer prompt. The new session starts with NO memory of the
conversation that produced the current state of `c:\hiraya`. Without this, the
new agent will re-audit from scratch, re-litigate decisions already made, and
very likely re-introduce bugs that were just fixed.

## Ground rules encoded in the prompt (learned the hard way)

- It tells the agent to VERIFY rather than trust — because this session found
  three separate "PASS" results that were false.
- It states the environment quirks (PHP and Node are NOT on PATH) because that
  cost real time to discover.
- It explicitly forbids re-doing completed work.
- It pre-empts the biggest failure mode: an agent promising "photorealistic,
  any pose, free" which is not achievable and was already ruled out.

## The actual next action

The user has NO VTON token yet. The single blocking step is theirs:
sign up at FASHN or PixelAPI and put the token in `hiraya-backend/.env`.

Then the agent runs a REAL end-to-end render and scores it with the (now
repaired) QA harness.

---

<!-- COPY FROM HERE -->

You are continuing work on **Hiraya**, a Laravel + React virtual try-on (VTON)
application at `c:\hiraya`. A previous session did substantial work. Read this
whole message before acting.

## ENVIRONMENT (not on PATH — this cost time to discover)

- **PHP**: `C:\xampp\php\php.exe` (PHP 8.2.12). Add to PATH:
  `$env:Path = "C:\xampp\php;" + $env:Path`
- **Node**: `C:\nvm4w\nodejs\node.exe` (v20.11.1). Add to PATH:
  `$env:Path = "C:\nvm4w\nodejs;" + $env:Path`
- Shell is **PowerShell**. Do not use `ls`/`cat`/`grep`; use `Get-ChildItem`,
  `Get-Content`, `Select-String`.
- Backend auto-loads `hiraya-backend/.env`. Paths are relative to `c:\hiraya`.

## PROJECT SHAPE (two apps)

- `c:\hiraya\hiraya-frontend` — React + Vite
- `c:\hiraya\hiraya-backend` — Laravel API
- `c:\hiraya\CLAUDE.md`, `HIRAYA_SYSTEM_FLOW.md` — architecture notes

There are **two independent render paths**; do not confuse them:

1. **`compositeTryOn.js`** (browser, 2D canvas) — dresses the customer's OWN
   uploaded photo with a canvas warper. No AI, free, offline. It is the
   GUARANTEED FALLBACK. It is NOT photorealistic and cannot be made so.
2. **Server AI renderers** — `GeminiTryOnRenderer.php` (general image model) and
   the NEW `VtonApiRenderer.php` (dedicated try-on model).
   Chain order in `ProcessTryOnJob::callVtonApi()`:
   `VtonApi -> Gemini -> Replicate -> Composite`

## ALREADY COMPLETED — DO NOT REDO

**A. QA harness repaired** — `c:\hiraya\qa_tryon_constraints.mjs`
Three real bugs were found and fixed. Do not revert them:
1. Check 1 (`NO MISPLACEMENT`) only bounded one side, so a garment anchored
   ABOVE the shoulder line passed. Now two-sided: `dressTopMaxAboveShoulder`.
2. Check 3 (`NO STICKER OVERLAY`) was CIRCULAR — it correlated the garment
   against a body envelope read from the RENDERED output, so it could not fail.
   Now reads `baseEnvForBody` (the input portrait).
3. Vignette modelling in `diffMask()` is approximate. **Known-unresolved:**
   verify empirically (render with no garments/watermark and confirm residual
   is under slack) before trusting mask-derived numbers.

**B. VTON provider tier built** — `hiraya-backend/app/Services/VtonApiRenderer.php`
- Vendor-neutral: FASHN and PixelAPI differ only in field names → all in config.
- Handles sync AND async (submit → poll) responses.
- Redacts base64 from logs.
- Picks ONE most-significant garment (dress > outerwear > top > bottom > inner)
  and SAYS SO in feedback — do not pretend a 6-layer stack rendered.
- With no token: returns `code: 'not_configured'`, never throws.

**C. Wired into the chain** — `hiraya-backend/app/Jobs/ProcessTryOnJob.php`
- `callVtonApi()` = the chain DISPATCHER (pre-existing name).
- `callVtonApiRenderer()` = the new render call. **Do not rename these back —
  they collided once and caused a PHP fatal error.**
- `not_configured` is deliberately NOT in the non-retryable set.

**D. Config + env** — `hiraya-backend/config/services.php` (`'vton'` block),
`hiraya-backend/.env` (fully commented setup guide appended).

**E. Verified** — `c:\hiraya\_smoke_vton.php` passes 11/11 against the real
container. Run: `cd c:\hiraya; $env:Path="C:\xampp\php;"+$env:Path; php _smoke_vton.php`

## STATUS UPDATE — VTON IS LIVE AND RENDERING

This section supersedes the "CURRENT BLOCKER" section below. The blocker is CLEARED.

- `VTON_API_TOKEN` IS set in `hiraya-backend/.env` (PixelAPI, `pk_live_...`).
- A REAL end-to-end render has completed through the app's own queue:
  try_on_sessions #103 and #105 are `completed` with a **786 KB** result image.
  #105 (2026-09-24 00:31) produced `tryon_output_20260924-000739.png` at the repo root.
  That image WAS reviewed by eye: correct body, pose and jeans preserved, the emerald
  off-shoulder piece sits on the shoulders, face/background intact. It is a genuine AI
  try-on — NOT the old 2D canvas composite (whose artefacts in
  `_qa_archive/qa_tryon_render.png` still show a flat envelope + "Emerald" label).
- Later sessions #100-102 and #104 are `failed` with no image. Cause not yet diagnosed
  from this session — do not assume the pipeline is broken; the chain has retries.

### Environment correction (the doc below is WRONG about paths)

PHP and Node are NOT at the paths stated below. Measured on this machine:

- **PHP**: `C:\php-8.3\php.exe` (PHP **8.3.35**). `C:\xampp` exists but its `php\` is EMPTY.
- **Node**: `C:\Program Files\nodejs\node.exe` (Node **v22.20.0**). `C:\nvm4w` does not exist.
- `git` is NOT on PATH, so commit history is unavailable from the shell.

### Fixed this session

`_smoke_vton.php` had a STALE FASHN-era assertion: it expected `mapCategory('')`
=> `'auto'`. PixelAPI has no `auto` enum (sending it 422s), so the correct value is
`upperbody` — which is what the code deliberately returns and documents
(`VtonApiRenderer.php:603-642`). The assertion was corrected and the case table
widened to `dress/top/inner/bottom/outerwear/''`, matching
`_qa_archive/subfolders/_smoke_vton_payload.php`. Root smoke test is now 10/10 PASS.

`_qa_archive/subfolders/_smoke_vton_payload.php` resolved the backend via
`__DIR__ . '/hiraya-backend'`, which broke when the file was archived into a
subfolder — it died on `require()` instead of running. Now walks up to the real
project root. Both suites PASS.

### Still NOT verified

- The QA harness `qa_tryon_constraints.mjs` was BUILT for the 2D canvas composite
  and reads landmarks from a body envelope. It has not been shown to score an AI
  render meaningfully. The AI output above was assessed by EYE, not by that harness.
  Do not treat a harness number as a substitute for looking.
- The 5 failed sessions (#100-102, #104) were not root-caused.

---

# (HISTORICAL — blocker since cleared)

## CURRENT BLOCKER (the user's step, not yours)

`VTON_API_TOKEN=` in `hiraya-backend/.env` is EMPTY, so the tier is dormant.
There is no working AI try-on yet. The user must sign up and paste a token:

- **FASHN** — https://app.fashn.ai — purpose-built try-on, ~1 credit/image,
  free trial, no credit card. Better model.
- **PixelAPI** — https://pixelapi.dev — **10,000 free credits** on signup.
  More free volume; flat API shape (set `VTON_MODEL_NAME=` empty and override
  the field names per the comment block already in `.env`).

The user will provide the token. **Do not fabricate one, and do not claim a
render works before a token exists.**

## WHAT TO DO WHEN THE USER SAYS "I have the token"

1. Confirm it is in `hiraya-backend/.env` as `VTON_API_TOKEN=...` (and
   `VTON_API_URL` matches the chosen vendor — see the comment block there).
2. Run `php artisan config:clear && php artisan config:cache` in `hiraya-backend`.
3. Re-run `php _smoke_vton.php` — expect `token=<set>`, not the dormant path.
4. **Run a REAL end-to-end render** through `VtonApiRenderer::render()` with a
   real person photo + a real garment (the emerald off-shoulder dress is the
   reference asset used throughout this project). Prove it produces an image,
   do not just prove it returns `success: true`.
5. Score it with `node run_tryon_qa.mjs qa_tryon_constraints.mjs --capture`
   (add Node to PATH first). Then LOOK at `qa_tryon_render.png` — read the image,
   do not only read the numbers. This session proved the numbers can lie.
6. Report cost per render and whether the free credits cover a real trial.

## HARD EARNED FACTS — DO NOT RE-LITIGATE

- **Gemini image generation is BILLED-ONLY.** A free-tier key returns
  `429, limit: 0` for every image model. Confirmed against Google's own pricing
  page ("Free Tier: Not available"). Do not suggest it as the free path.
- **`ghost_mannequin_url` is ALIVE, not deprecated.** Written at
  `ProductController.php:279`, read as the preferred VTON input at
  `TryOnController.php:212`. The user believed it was dead; it is not. The user's
  product uploads are ALREADY ghost-mannequin photos — that is an ADVANTAGE, it
  is the documented input format for these VTON models.
- **IDM-VTON is CC BY-NC-SA = NON-COMMERCIAL.** Unusable for this storefront.
- **FASHN VTON v1.5 is Apache-2.0, free, commercial-OK, self-hostable** —
  https://huggingface.co/fashn-ai/fashn-vton-1.5 — needs ~8GB VRAM,
  outputs 576x864. Only viable if a GPU is available.
- **NO MODEL MEETS EVERY REQUIREMENT.** "Natural fit in ANY pose/direction" is
  the open research frontier (papers at CVPR 2025 still work on hand occlusion).
  Do NOT promise it. The user has repeatedly asked for it; give the honest
  answer, not the agreeable one.

## TONE REQUIRED

This user was burned by earlier agents overpromising. Be direct, cite evidence
(file:line, command output, doc URLs), and explicitly state what you did NOT
verify. Never present an unverified claim as a fact. If something cannot be
done, say so plainly instead of building something adjacent and implying it
is the requested thing.

Begin by confirming you have read and understood the above, then tell the user
the single action you need from them (the token), and nothing else.

<!-- COPY TO HERE -->
