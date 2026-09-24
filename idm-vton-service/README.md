# Hiraya — IDM-VTON Service

A standalone HTTP service that performs **real IDM-VTON virtual try-on
inference**. It is the replacement target for the PixelAPI provider that the
Hiraya backend currently calls through `hiraya-backend/app/Services/VtonApiRenderer.php`.

It wraps the **official IDM-VTON implementation** — it does not re-implement the
model, and it does not fake a result.

- Source of truth: <https://github.com/yisol/IDM-VTON> (ECCV 2024).
- It runs on an **NVIDIA GPU host**. It cannot run on this project's Windows /
  Intel-UHD development machine — see [GPU requirements](#gpu-requirements).

---

## ⚠️ LICENCE — READ THIS FIRST (NON-COMMERCIAL)

> **IDM-VTON is licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode) — NON-COMMERCIAL.**
>
> The weights and code are for **non-commercial** use only. This service is
> therefore **NOT production-ready for a commercial storefront** (e.g. selling
> garments in the Hiraya shop) as long as it runs IDM-VTON.
>
> **Before any commercial deployment, the project owner must either:**
> 1. verify that Hiraya's actual intended use is permitted by CC BY-NC-SA 4.0, or
> 2. replace IDM-VTON with a try-on model whose licence permits commercial use.
>
> This limitation is intentionally prominent because it is a legal blocker, not
> a technical one. The service code can be correct and still be unusable for a
> commercial launch.

This mirrors the note already present in Hiraya's own
`ProcessTryOnJob::callVtonApiChain()` ("IDM-VTON is CC BY-NC-SA
(non-commercial), so it is unusable for this storefront anyway").

---

## What it actually does

The pipeline is a faithful, headless port of the official
`gradio_demo/app.py`. The **same steps, in the same order, with the same
upstream classes**:

```
person_image + garment_image + category + garment_description
        │
        ▼
1. garment : RGB → resize 768x1024
2. person  : optional 3:4 auto-crop → resize 768x1024
3. OpenPose          → 18 body keypoints        (384x512)
4. HumanParsing      → SCHP ONNX segmentation   (384x512, CPU provider)
5. get_mask_location → agnostic inpainting mask (utils_mask.py)
6. DensePose         → pose conditioning image  (detectron2, apply_net)
7. StableDiffusionXLInpaint (modified, IDM-VTON UNet + UNet_encoder + IP-Adapter)
        │
        ▼
   real generated try-on PNG (768x1024)
```

The two images are **not** blended, overlaid, returned unchanged, or passed to
a different provider. Steps 3–7 are the model's own preprocessing and inference.

---

## Directory layout

```
idm-vton-service/
├── app.py               # FastAPI: POST /virtual-tryon, GET /health, GET /results/{file}
├── idm_runner.py        # the actual IDM-VTON pipeline (headless port of gradio_demo/app.py)
├── requirements.txt     # pinned deps matching the official environment.yaml
├── README.md            # this file
├── .env.example         # configuration template (copy to .env)
├── .gitignore           # keeps weights / uploads / outputs out of version control
├── models/              # weights + checkpoints (gitignored; see models/README.md)
├── uploads/             # temporary inbound images (auto-cleaned per request)
├── outputs/             # generated results, served from /results/<uuid>.png
└── IDM-VTON/            # the official repo, cloned at install time (gitignored)
```

`IDM-VTON/` is not part of this directory's source — it is a clone of the
official repository, done during installation (below). Importing rather than
vendoring the official code keeps a single source of truth and makes the licence
relationship obvious.

---

## GPU requirements

| | |
|---|---|
| GPU | **NVIDIA CUDA GPU** (the official demo runs on ZeroGPU / A100-class) |
| VRAM | **~16 GB minimum** for practical SDXL fp16 inference |
| CUDA | **CUDA 11.8** (matches the official environment's `pytorch-cuda=11.8`) |
| Driver | one compatible with CUDA 11.8 |
| CPU | **Not supported.** Not merely slow — the official preprocessing modules call `torch.cuda.set_device()`, so they fail outright without CUDA. |

**This machine (Windows + Intel UHD, no NVIDIA GPU, no CUDA, no WSL) cannot run
IDM-VTON.** The service detects this, reports it through `/health`, and refuses
inference with a truthful error instead of returning a fake image. Deploy it to
a separate GPU host (cloud GPU, or a workstation with an NVIDIA card); point
Hiraya's `IDM_VTON_URL` at that host in a later phase.

---

## Compatibility (do not "upgrade" these)

IDM-VTON ships custom subclasses (`src/unet_hacked_tryon.py`,
`src/unet_hacked_garmnet.py`) and a modified SDXL pipeline
(`src/tryon_pipeline.py`) pinned to the APIs of their era. Newer
diffusers/transformers/PyTorch break them.

| Component | Version |
|---|---|
| Python | **3.10** (official pin: 3.10.0) |
| PyTorch | **2.0.1** |
| CUDA / cuDNN | **11.8 / 8.7** |
| torchvision | **0.15.2** |
| torchaudio | **2.0.2** |
| diffusers | **0.25.0** |
| transformers | **4.36.2** |
| accelerate | **0.25.0** |
| bitsandbytes | **0.39.0** |
| ONNX Runtime | **1.16.2** (HumanParsing; CPU execution provider) |
| Detectron2 | from the official **facebookresearch/detectron2** source (see below) |
| OpenPose | vendored inside the IDM-VTON repo (`preprocess/openpose/`) |
| HumanParsing | vendored inside the IDM-VTON repo (SCHP ONNX, `preprocess/humanparsing/`) |

---

## Installation (on the NVIDIA GPU host)

### 1. Get the official repository

```bash
git clone https://github.com/yisol/IDM-VTON.git
cd IDM-VTON
# This service imports this checkout; by default it expects it next to app.py
# (i.e. idm-vton-service/IDM-VTON). Set IDM_VTON_REPO_DIR to relocate it.
```

### 2. Python environment

```bash
cd idm-vton-service
python3.10 -m venv venv            # Python 3.10 is required
source venv/bin/activate           # Windows: venv\Scripts\activate
python -m pip install --upgrade pip
```

### 3. PyTorch 2.0.1 + CUDA 11.8 (install FIRST, from the CUDA index)

```bash
pip install torch==2.0.1 torchvision==0.15.2 torchaudio==2.0.2 \
    --index-url https://download.pytorch.org/whl/cu118
```

### 4. Detectron2 (required for DensePose)

Detectron2 is **not** a version-matched PyPI wheel; build it from the official
source after torch is installed. Use a Detectron2 commit contemporary with the
IDM-VTON release:

```bash
pip install 'git+https://github.com/facebookresearch/detectron2.git'
```

If a newer Detectron2 fails to build against torch 2.0.1, pin an older commit
that predates the torch-2.1 API changes, for example:

```bash
pip install 'git+https://github.com/facebookresearch/detectron2.git@v0.6'
```

(Detectron2 compiles C++/CUDA extensions — a working `nvcc` / build toolchain
matching CUDA 11.8 is required.)

### 5. Remaining Python dependencies

```bash
pip install -r requirements.txt
```

> `requirements.txt` intentionally **omits** torch/torchvision/torchaudio and
> detectron2, because their correct installation order and index URL differ from
> a plain PyPI resolve. Install steps 3–4 above first.

### 6. Model weights and preprocessing checkpoints

Nothing large is committed. Place everything under `models/` (or anywhere, and
set `MODEL_PATH` / `CKPT_DIR` in `.env`).

**a. IDM-VTON weights** — from the official Hugging Face model repo
<https://huggingface.co/yisol/IDM-VTON>:

```bash
# Either let diffusers cache them (MODEL_PATH=yisol/IDM-VTON), or download locally:
pip install "huggingface_hub[cli]"
huggingface-cli download yisol/IDM-VTON --local-dir ./models/IDM-VTON
```

**b. HumanParsing + OpenPose + DensePose checkpoints** — from the official demo
space <https://huggingface.co/spaces/yisol/IDM-VTON/tree/main/ckpt> (linked from
the repo README), placed exactly as the official `gradio_demo/app.py` expects:

```
models/ckpt/
├── humanparsing/
│   ├── parsing_atr.onnx
│   └── parsing_lip.onnx
├── openpose/
│   └── ckpts/
│       └── body_pose_model.pth
└── densepose/
    └── model_final_162be9.pkl
```

The DensePose checkpoint (`model_final_162be9.pkl`) is the official Detectron2
DensePose R-50-FPN model
(`https://dl.fbaipublicfiles.com/densepose/densepose_rcnn_R_50_FPN_s1x/165712039/model_final_162be9.pkl`).

### 7. Configure

```bash
cp .env.example .env
# edit .env: MODEL_PATH, CKPT_DIR, DEVICE, IDM_VTON_API_KEY, ...
```

---

## Running the service

```bash
# from idm-vton-service/, with the venv active and .env configured
python app.py
```

or explicitly:

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

For a network-reachable deployment, run it behind an HTTPS reverse proxy (nginx
/ Caddy) and set `IDM_VTON_API_KEY`. Do **not** expose the raw port to the
public internet without the token.

### Health check

```bash
curl http://127.0.0.1:8000/health
```

Ready on a GPU host:

```json
{
  "status": "ok",
  "cuda_available": true,
  "device": "cuda:0",
  "model_loaded": true,
  "gpu_name": "NVIDIA A100-SXM4-80GB",
  "gpu_vram_gb": 80.0,
  "model_path": "yisol/IDM-VTON",
  "reason": null
}
```

On a host without a GPU (this is the honest response, not an error stub):

```json
{
  "status": "not_ready",
  "cuda_available": false,
  "device": "cpu",
  "model_loaded": false,
  "reason": "IDM-VTON requires a CUDA-capable NVIDIA GPU. No usable CUDA device is present on this host, and the official pipeline does not run correctly on CPU."
}
```

`status` is `ok` **only** when the model is loaded and inference can actually
run. It is never `ok` while inference is not ready.

---

## API

### `POST /virtual-tryon`

`multipart/form-data`:

| Field | Required | Notes |
|---|---|---|
| `person_image` | yes | JPG / PNG / WebP. Validated by content. |
| `garment_image` | yes | JPG / PNG / WebP. Validated by content. |
| `category` | no (default `upper_body`) | One of `upper_body`, `lower_body`, `dresses`. |
| `garment_description` | no | Free text. If empty, `DEFAULT_GARMENT_DESCRIPTION` is used. |
| `denoise_steps` | no (default `30`) | Clamped to 20–40. |
| `seed` | no (default `42`) | Repro-ducibility. |
| `crop` | no (default `false`) | The official demo's 3:4 auto-crop. |

Header (when `IDM_VTON_API_KEY` is set):

```
Authorization: Bearer <IDM_VTON_API_KEY>
```

Success — `200`:

```json
{
  "success": true,
  "result_url": "/results/2f1c9a0e7b6d4c8f9a1e2b3c4d5e6f70.png",
  "seed": 42,
  "denoise_steps": 30,
  "category": "upper_body",
  "seconds": 38.4
}
```

Failure — `4xx`/`5xx`:

```json
{ "success": false, "error": "<safe human-readable message>" }
```

Errors never contain stack traces, filesystem paths, credentials or model
internals. Those are written to the server log only.

Example:

```bash
curl -X POST http://127.0.0.1:8000/virtual-tryon \
  -H "Authorization: Bearer $IDM_VTON_API_KEY" \
  -F person_image=@person.jpg \
  -F garment_image=@shirt.jpg \
  -F category=upper_body \
  -F garment_description="short sleeve round neck t-shirt" \
  -F denoise_steps=30 \
  -F seed=42
```

### `GET /results/{filename}`

Serves a generated PNG. The filename must match the uuid4 shape the service
itself writes; anything else is rejected (no path traversal).

### `GET /health`

See above.

---

## Independent verification (real single inference test)

Do this on the GPU host, after installation, **before** wiring Hiraya to it.

```bash
# 1. Service is up and reports a working GPU + loaded model
curl -s http://127.0.0.1:8000/health | python -m json.tool
#    -> expect "status": "ok", "cuda_available": true, "model_loaded": true

# 2. Run ONE real try-on with real images and a fixed seed
curl -s -X POST http://127.0.0.1:8000/virtual-tryon \
  -H "Authorization: Bearer $IDM_VTON_API_KEY" \
  -F person_image=@./samples/person.jpg \
  -F garment_image=@./samples/garment.jpg \
  -F category=upper_body \
  -F garment_description="short sleeve round neck t-shirt" \
  -F denoise_steps=30 \
  -F seed=42 | python -m json.tool
#    -> expect { "success": true, "result_url": "/results/<uuid>.png", ... }

# 3. Fetch and inspect the generated image
curl -s -o ./out.png "http://127.0.0.1:8000$(the result_url from above)"
```

A valid run means, and you should confirm each one:

- [ ] `human parsing` succeeded (no exception from `Parsing`)
- [ ] `OpenPose` succeeded (18 keypoints produced)
- [ ] `DensePose` succeeded (`apply_net` returned a segmentation image)
- [ ] mask generation succeeded (`get_mask_location` returned a mask)
- [ ] the IDM-VTON model loaded (`/health` `model_loaded: true`)
- [ ] inference completed (HTTP 200, `success: true`)
- [ ] an output file exists under `outputs/`
- [ ] the output is a **genuine generated try-on** — the garment is worn on the
      person, wearing the person's pose/face, and is **not** the original person
      image, **not** the original garment image, and **not** an overlay

During the run the server log shows the pipeline stages and a final line
`Rendered try-on <uuid>.png (category=upper_body steps=30 seed=42 in Ns)`.

If any stage fails, **stop and report the exact error** — do not bypass it.

---

## Configuration reference (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `MODEL_PATH` | `yisol/IDM-VTON` | HF repo id or local path to the weights. |
| `CKPT_DIR` | `./models/ckpt` | HumanParsing / OpenPose / DensePose checkpoints. |
| `IDM_VTON_REPO_DIR` | `./IDM-VTON` | Where the official repo was cloned. |
| `DEVICE` | `auto` | `auto` → cuda:0 if available else cpu; or pin `cuda:0`/`cpu`. |
| `UPLOAD_DIR` | `./uploads` | Temporary inbound images. |
| `OUTPUT_DIR` | `./outputs` | Generated results. |
| `OUTPUT_RETENTION_MINUTES` | `1440` | Auto-delete results older than this; `0` disables. |
| `HOST` | `127.0.0.1` | Bind address. |
| `PORT` | `8000` | Bind port. |
| `IDM_VTON_API_KEY` | *(empty)* | Bearer token PHP must send. **Set when network-reachable.** |
| `DEFAULT_DENOISE_STEPS` | `30` | Used when the caller omits `denoise_steps`. |
| `DEFAULT_SEED` | `42` | Used when the caller omits `seed`. |
| `GUIDANCE_SCALE` | `2.0` | IDM-VTON's released guidance scale. |
| `DEFAULT_GARMENT_DESCRIPTION` | `a stylish garment` | Fallback when `garment_description` is empty. |
| `MAX_IMAGE_BYTES` | `12000000` | Per-image upload ceiling. |
| `IMAGE_WIDTH` / `IMAGE_HEIGHT` | `768` / `1024` | Trained resolution; change only with a matching fine-tune. |

---

## Security notes

- **Auth is optional but expected off-box.** Empty `IDM_VTON_API_KEY` is only
  acceptable for loopback development. Set it before exposing the service.
- **The token is server-to-server only.** It is consumed by the PHP backend in
  a later phase and must never reach browser JavaScript.
- **Uploads are validated by content** (magic bytes + Pillow decode), not by
  the filename or the claimed content type. Executables disguised as images are
  rejected.
- **Server-generated filenames** (uuid4). The client filename is ignored, so
  path traversal is impossible; `/results/{file}` also restricts to the safe
  pattern.
- **Temporary inputs are deleted** after each request (in a `finally` block).
- **Errors do not leak** stack traces, paths, credentials or model internals.
- **Prefer HTTPS** and a firewall / allow-list / VPN in front of the service.

---

## Relationship to Hiraya (context — NOT changed in Phase 1)

```
JSX → PHP (Hiraya) → tryon queue → VtonApiRenderer → [ currently PixelAPI ]
                                                   ↘ [ future: this service, via IDM_VTON_URL ]
                                        → try_on_sessions (PostgreSQL) → JSX polling → TryOnCanvas
```

In a **later** phase, Hiraya's `VtonApiRenderer` will be pointed at this service
through an `IDM_VTON_URL` environment variable. **Phase 1 does not touch any
Hiraya file**; PixelAPI remains the live provider and the rollback path until
end-to-end verification is complete.