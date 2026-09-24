<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    /*
     * VIRTUAL TRY-ON
     * --------------
     * RENDER ORDER: HUGGING FACE (free) FIRST, PIXELAPI (paid) FALLBACK.
     *
     * `ProcessTryOnJob::callVtonApi()` tries the yisol/IDM-VTON HF Space via
     * HuggingFaceVtonRenderer and falls through to the dedicated VTON API
     * (PixelAPI) on any failure. Gemini (billed-only image generation),
     * Replicate (needs a paid token) and the local browser composite remain out
     * of the chain.
     *
     * LICENSING CAVEAT: the HF tier renders through IDM-VTON, which is
     * CC BY-NC-SA — NON-COMMERCIAL. Free of charge does not mean free of
     * licence: production/commercial renders must come from PixelAPI.
     *
     * `provider` is retained for parity with the legacy chain code but no longer
     * selects an engine. When BOTH engines fail, the session FAILS with the real
     * reason instead of drawing a substitute.
     */
    'tryon' => [
        'provider' => env('TRYON_PROVIDER', 'vtonapi'),
    ],

    /*
     * VTON (VIRTUAL TRY-ON) API — the dedicated try-on tier.
     * ------------------------------------------------------
     * A purpose-built try-on model, unlike Gemini's general image generator.
     * These services accept a flat-lay / ghost-mannequin garment image, which is
     * exactly what this catalog stores in `ghost_mannequin_url`.
     *
     * VENDOR-NEUTRAL: only the endpoint, the token and a few field names are
     * configured, so switching vendor is a .env change (see VtonApiRenderer).
     *
     * DEFAULTS MATCH FASHN (https://docs.fashn.ai):
     *   POST https://api.fashn.ai/v1/run
     *   { model_name: "tryon-v1.6", inputs: { model_image, garment_image, category } }
     *   -> { id }  then poll GET https://api.fashn.ai/v1/status/{id}
     *
     * PIXELAPI-style flat contract: set VTON_MODEL_NAME= (empty) and
     * VTON_API_URL=https://api.pixelapi.dev/v1/virtual-tryon with field names
     * person_image / garment_image and category upper_body|lower_body|full_body.
     * The status endpoint is https://api.pixelapi.dev/v1/virtual-tryon/jobs/{id}
     * and the completed job carries the image in `output`.
     * (Verified: https://pixelapi.dev/tutorials/virtual-try-on.html)
     *
     * WITHOUT a token this tier stays dormant and the chain falls through to the
     * next provider — an unconfigured option must never break a render.
     */
    'vton' => [
        'endpoint' => env('VTON_API_URL', ''),
        'token' => env('VTON_API_TOKEN', ''),

        // Wrapper-style model id (FASHN). Leave empty for a flat API (PixelAPI).
        'model_name' => env('VTON_MODEL_NAME', 'tryon-v1.6'),

        // Polling endpoint; `{id}` is replaced with the job id. Empty = sync-only.
        'status_endpoint' => env('VTON_STATUS_URL', 'https://api.fashn.ai/v1/status/{id}'),

        // Request field names.
        'person_field' => env('VTON_PERSON_FIELD', 'model_image'),
        'garment_field' => env('VTON_GARMENT_FIELD', 'garment_image'),
        'category_field' => env('VTON_CATEGORY_FIELD', 'category'),

        // Response paths. Empty = walk the documented shapes automatically.
        'job_id_path' => env('VTON_JOB_ID_PATH', 'id'),
        'image_path' => env('VTON_IMAGE_PATH', ''),

        /*
         * CATEGORY VOCABULARY — THE DEFAULTS MUST BE PIXELAPI'S, NOT FASHN'S.
         *
         * THESE DEFAULTS USED TO BE `tops` / `bottoms` / `one-pieces` (FASHN's
         * enum) WHILE THE ACTIVE VENDOR IS PIXELAPI. That mismatch is a silent
         * 422 on EVERY render:
         *
         *   PixelAPI's LIVE accepted set, read from its own validation error:
         *     "category must be upperbody, lowerbody, dress, saree, lehenga,
         *      kurti, or sherwani"
         *   (probed against api.pixelapi.dev — NOT the older tutorial page,
         *    which lists upper_body/lower_body/full_body and is wrong.)
         *
         * `env('VTON_CATEGORY_TOP', $default)` falls back to `$default` whenever
         * the key is absent OR empty. So the .env values were the ONLY thing
         * keeping this working, and any of these made the renderer send FASHN
         * words to PixelAPI:
         *
         *   - a fresh clone whose .env was copied from .env.example
         *   - `php artisan config:cache` against an incomplete .env
         *   - any deploy that trims or omits the VTON_* block
         *
         * The result was `renderer_rejected` (HTTP 422) — "The try-on service
         * rejected this request" — which reads like a bad PHOTO and sent whoever
         * debugged it looking at the images for a bug that was in the payload.
         *
         * A config default must describe the vendor that is ACTUALLY configured,
         * so the deployment's own working values are now the defaults and an
         * unconfigured environment is correct by construction rather than by
         * luck.
         */
        'category_top' => env('VTON_CATEGORY_TOP', 'upperbody'),
        'category_bottom' => env('VTON_CATEGORY_BOTTOM', 'lowerbody'),
        'category_dress' => env('VTON_CATEGORY_DRESS', 'dress'),

        /*
         * QUALITY KNOBS — optional, omitted when unset.
         *   n_steps   : diffusion steps (PixelAPI default 20; higher = sharper)
         *   n_samples : candidate images to generate (default 1, max 4)
         * Set VTON_N_STEPS=30 to raise detail without changing the default
         * behaviour of an unconfigured deployment.
         */
        'n_steps' => env('VTON_N_STEPS'),
        'n_samples' => env('VTON_N_SAMPLES'),
    ],

    // Replicate API for Virtual Try-On (IDM-VTON model)
    'replicate' => [
        'token' => env('REPLICATE_API_TOKEN'),
        'vton_model' => env('REPLICATE_VTON_MODEL', 'cuuupid/idm-vton'),
    ],

    /*
     * HUGGING FACE — the FREE try-on tier, tried BEFORE PixelAPI.
     *
     * The old `api-inference.huggingface.co` route is still retired (it 403s /
     * does not resolve), and so is the old `/queue/join` WebSocket verdict: the
     * yisol/IDM-VTON Space is now driven over its PLAIN HTTP Gradio API instead
     * (see App\Services\HuggingFaceVtonRenderer):
     *
     *   POST /upload                       -> [{path, url}]  per file
     *   POST /gradio_api/call/tryon        -> {event_id}
     *   GET  /gradio_api/call/tryon/{id}   -> SSE stream ending `complete`
     *
     * WHICH IS CONFIGURED WHERE:
     *   HUGGINGFACE_API_TOKEN     the hf_... token (anonymous works too, but a
     *                             token lifts the ZeroGPU quota and authenticates
     *                             private Spaces)
     *   HUGGINGFACE_VTON_SPACE    the Space id, "owner/name" (default below)
     *   HUGGINGFACE_VTON_BASE     OPTIONAL explicit base url; when empty the
     *                             base is derived from the Space id
     *                             (yisol/IDM-VTON -> https://yisol-idm-vton.hf.space)
     *   HUGGINGFACE_VTON_API_PREFIX  route prefix, set by the Space's gradio
     *                             version: "" for Gradio 4.0-4.43 (yisol/IDM-VTON
     *                             MEASURED on 4.24.0 -> /upload, /call/tryon);
     *                             "/gradio_api" for Gradio 4.44+ / 5.x
     *
     * LICENSING CAVEAT — READ BEFORE GOING TO PRODUCTION: IDM-VTON's weights are
     * CC BY-NC-SA 4.0 (NON-COMMERCIAL). This tier is free of CHARGE, not free of
     * LICENCE: development, demos and academic work are fine, a commercial
     * storefront must render through the paid PixelAPI path instead.
     *
     * vton_prompt / vton_auto_mask / vton_auto_crop / vton_denoise_steps /
     * vton_seed map 1:1 onto the Space's /tryon fn signature
     * (human_img, garm_img, garment_des, is_checked, is_checked_crop,
     *  denoise_steps, seed) — see HuggingFaceVtonRenderer for the payload order.
     */
    'huggingface' => [
        'token' => env('HUGGINGFACE_API_TOKEN', ''),

        // The try-on Space: "owner/name". The base url is derived from it.
        'vton_space' => env('HUGGINGFACE_VTON_SPACE', 'yisol/IDM-VTON'),
        'vton_base' => env('HUGGINGFACE_VTON_BASE', ''),

        // Gradio route prefix: '' = Gradio 4.x mount (this Space, measured 4.24.0);
        // '/gradio_api' = Gradio 4.44+ / 5.x.
        'vton_api_prefix' => env('HUGGINGFACE_VTON_API_PREFIX', ''),

        // The /tryon fn's remaining inputs (Space defaults, overridable).
        'vton_prompt' => env('HUGGINGFACE_VTON_PROMPT', 'a photo of a person wearing the garment'),
        'vton_auto_mask' => env('HUGGINGFACE_VTON_AUTO_MASK', true),
        'vton_auto_crop' => env('HUGGINGFACE_VTON_AUTO_CROP', false),
        'vton_denoise_steps' => env('HUGGINGFACE_VTON_DENOISE_STEPS', 30),
        'vton_seed' => env('HUGGINGFACE_VTON_SEED', -1),

        // Legacy inference-API keys — the retired route, kept only for the
        // optional server-side background remover (also covered in-browser).
        'vton_model' => env('HUGGINGFACE_VTON_MODEL', 'yisol/IDM-VTON'),
        'rmbg_model' => env('HUGGINGFACE_RMBG_MODEL', 'briaai/RMBG-1.4'),
        'inference_base' => env('HUGGINGFACE_INFERENCE_BASE', 'https://router.huggingface.co/hf-inference/models'),
    ],

    /*
     * Upstream release the in-browser background-removal engine loads its model
     * and WASM files from. The browser cannot reach this host on restricted
     * networks, so the backend proxies it (see BackgroundRemovalAssetsController)
     * and the frontend points `publicPath` at that proxy.
     */
    'imgly' => [
        'base_url' => env('IMGLY_ASSETS_BASE_URL', 'https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist'),
    ],

    /*
     * GEMINI — TEXT/VISION ONLY.
     *
     * `gemini` is still used for catalog image analysis and the fit chat, which
     * are TEXT-OUTPUT models and work on the free tier. It is NOT a try-on
     * renderer: image generation is billed-only, and the free tier reports
     * `limit: 0` for every image model, so it can never produce a fitting.
     *
     * These keys are kept because the vision/chat paths read them. Nothing in
     * the try-on chain uses `image_model` / `image_models` any more.
     */
    'gemini' => [
        'key' => env('GEMINI_API_KEY'),
        // Text/vision model used for catalog image analysis.
        // Default MUST be a model that still exists — `gemini-2.0-flash` is
        // retired and 404s, which silently broke the garment auto-fill.
        'model' => env('GEMINI_VISION_MODEL', 'gemini-3.5-flash-lite'),

        /*
         * FALLBACK CHAIN for the VISION model (person verification + catalog
         * auto-fill).
         *
         * WHY A CHAIN: the free tier is 20 requests/DAY PER MODEL. Retiring an
         * ID for new users (2.0/2.5 are now 404 against this key) is not the
         * only failure — a model can simply be out of quota (429) while its
         * sibling still has a fresh bucket. Walking a list means one exhausted
         * model does not refuse a legitimate customer.
         *
         * `model` is always tried FIRST so an explicit choice wins; the rest of
         * the list follows. GEMINI_VISION_MODELS overrides the default entirely.
         */
        'models' => array_values(array_unique(array_filter(array_map(
            'trim',
            explode(',', (string) env(
                'GEMINI_VISION_MODELS',
                'gemini-3.5-flash-lite,gemini-3.5-flash'
            ))
        )))),
        /*
         * Model used for the IMAGE-OUTPUT try-on render.
         *
         * It must support `responseModalities: ['IMAGE']` (image generation),
         * which is a DIFFERENT capability from plain vision analysis. Split into
         * its own key so swapping one never breaks the other.
         */
        'image_model' => env('GEMINI_IMAGE_MODEL', 'gemini-2.5-flash-image'),

        /*
         * FALLBACK CHAIN for the render.
         *
         * WHY A CHAIN
         * -----------
         * Image generation is its OWN capability, NOT a tier of the text model:
         * `gemini-2.5-flash` lists its output as "Text" and image generation as
         * "Not supported" — it can read the portrait and the garments, and it can
         * return prose describing a fitting, but it can never return an image.
         * The IDs that CAN return an image are the multimodal-generation models
         * (`*-flash-image` / `*-flash-preview-image-generation`).
         *
         * Google moves these around: the 2.0 preview was shut down, the 2.5 image
         * model was superseded by the Gemini 3 image models, and the hosted IDs
         * differ between the AI Studio endpoint and Vertex. Rather than hard-code
         * one ID that silently rots into a 404, the render walks this list until
         * one answers.
         *
         * FREE-TIER NOTE: every entry here is available on the FREE tier, but
         * image RENDERING is quota-limited (429) rather than paid-only — an image
         * key without image quota fails with a rate limit, never a billing error.
         * `GEMINI_IMAGE_MODELS` (comma-separated) overrides the list entirely,
         * and `image_model` is always tried FIRST so an explicit choice wins.
         */
        'image_models' => array_values(array_filter(array_map(
            'trim',
            explode(',', (string) env(
                'GEMINI_IMAGE_MODELS',
                'gemini-2.5-flash-image,gemini-3.1-flash-image,gemini-3.1-flash-lite-image,gemini-2.5-flash-image-preview,gemini-2.0-flash-preview-image-generation'
            ))
        ))),
    ],

    /*
     * PERSON-VERIFICATION VISION PROVIDERS — a CHAIN, not a single vendor.
     * --------------------------------------------------------------------
     * `PersonVerificationController` asks ONE question ("is there a real person
     * in this photo?") and the Gemini free tier answers only 20 requests/DAY,
     * shared with catalog auto-fill. Caching stretches that budget, it does not
     * remove the wall: on a busy day a legitimate customer gets "could not be
     * verified" the moment the quota drains.
     *
     * So the endpoint walks an ORDERED list of providers and stops at the first
     * one that returns a usable verdict. Gemini stays FIRST (already configured,
     * already paid for); a fallback is only reached when Gemini is genuinely
     * unavailable — a 429 quota error, an outage, or an unconfigured key — never
     * when Gemini simply answered "no person".
     *
     * Each entry is a NAME the controller knows how to call (`gemini`,
     * `cloudflare`, `groq`, `openai`). The order comes from
     * `PERSON_VERIFY_PROVIDERS` (comma-separated); an empty/absent value yields
     * just `gemini`, so an unconfigured deployment behaves exactly as before.
     *
     * PROVIDERS WITH NO KEY ARE SKIPPED, so listing one in the order costs
     * nothing until its credential is set.
     */
    'person_verification' => [
        'providers' => array_values(array_filter(array_map(
            'trim',
            explode(',', (string) env('PERSON_VERIFY_PROVIDERS', 'gemini'))
        ))),

        /*
         * CLOUDFLARE WORKERS AI — the recommended free fallback.
         *
         * A vision-capable instruct model answering the SAME prompt, over the
         * same image-in / text-out shape, so the controller parses it with the
         * exact code path it already uses for Gemini. The free allowance is a
         * daily NEURON budget that dwarfs Gemini's 20 requests.
         *
         *   ACCOUNT_ID  the Cloudflare account id
         *   API_TOKEN   an "Workers AI" API token (Account.Workers AI:Read)
         *   MODEL       any @cf/... vision instruct model (default below)
         */
        'cloudflare' => [
            'account_id' => env('CLOUDFLARE_ACCOUNT_ID', ''),
            'token' => env('CLOUDFLARE_API_TOKEN', ''),
            'model' => env('CLOUDFLARE_VISION_MODEL', '@cf/meta/llama-3.2-11b-vision-instruct'),
        ],

        /*
         * GROQ — a fast, generous free tier for the same vision task.
         * OpenAI-compatible chat shape (messages -> choices[0].message.content),
         * so it needs its own small parser (see the controller).
         */
        'groq' => [
            'token' => env('GROQ_API_KEY', ''),
            'model' => env('GROQ_VISION_MODEL', 'meta-llama/llama-4-scout-17b-16e-instruct'),
        ],

        /*
         * OPENAI — the paid 'last resort'. Same OpenAI-compatible chat shape as
         * Groq; only used when a key is present, so a free deployment is
         * unaffected by its being listed as an option.
         */
        'openai' => [
            'token' => env('OPENAI_API_KEY', ''),
            'model' => env('OPENAI_VISION_MODEL', 'gpt-4o-mini'),
        ],
    ],

    // Supabase project that hosts the public asset buckets (occasion
    // backgrounds, catalog images). Used to build public object URLs for the
    // two-stage garment pipeline.
    //
    // `service_role_key` is consumed by App\Support\SupabaseStorage, which writes
    // admin uploads into the `products` bucket over the Storage REST API. It is
    // SERVER-ONLY: the key bypasses RLS, so it must never be exposed to the
    // browser (no `VITE_` prefix, never in a response payload). Read access needs
    // no key at all because both buckets are public.
    'supabase' => [
        'url' => env('SUPABASE_URL'),
        'service_role_key' => env('SUPABASE_SERVICE_ROLE_KEY'),
    ],

    /*
     * CA BUNDLE for ALL outbound HTTPS (Gemini, PixelAPI, Hugging Face, Supabase).
     *
     * WHY IT LIVES HERE AND NOT IN AppServiceProvider
     * -----------------------------------------------
     * The provider used to read `env('HTTP_CA_BUNDLE')` directly in boot(). That
     * works UNTIL `php artisan config:cache` runs: once the config is cached,
     * `env()` returns null OUTSIDE of the config/*.php files, so the bundle path
     * vanished and EVERY TLS call failed with
     *   cURL error 60: unable to get local issuer certificate
     * — which is exactly the "HF VTON unreachable at upload" symptom. Routing the
     * value through a config file makes it survive `config:cache`, which is the
     * production path.
     */
    'http' => [
        'ca_bundle' => env('HTTP_CA_BUNDLE', 'storage/certs/cacert.pem'),
    ],

];
