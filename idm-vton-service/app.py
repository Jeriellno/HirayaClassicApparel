"""
app.py — the IDM-VTON HTTP service.

WHAT THIS IS
------------
A small, self-contained FastAPI wrapper around the REAL IDM-VTON pipeline
(see idm_runner.py, a faithful headless port of the official
https://github.com/yisol/IDM-VTON demo). It is NOT a commercial try-on API and
NOT a stand-in for one: it runs the actual IDM-VTON model on a CUDA GPU and
returns the image that model generated.

END-GOALS IT SERVES (Hiraya, Phase 1)
-------------------------------------
    PHP backend (Hiraya)  --HTTP multipart-->  POST /virtual-tryon
                                            <--  { success, result_url }
    GET /results/<file>  serves the generated PNG back to PHP.

The PHP side (a later phase) will point `IDM_VTON_URL` at this service and
forward the two images. THIS SERVICE DOES NOT KNOW ABOUT HIRAYA and does not
talk to PixelAPI or any other provider — it only renders.

SECURITY POSTURE
----------------
* Optional bearer auth via IDM_VTON_API_KEY (REQUIRED when reachable off-box).
* Uploads are validated by content (magic bytes + Pillow verify), not by the
  filename or the client-supplied content type.
* Filenames are generated server-side (uuid4); the client filename is ignored,
  so path traversal is impossible.
* Temporary inputs are deleted after every request; only the result PNG is kept.
* Errors returned to the caller never include stack traces, filesystem paths,
  model internals or credentials — those go to the server log only.
* It is designed to sit behind an HTTPS reverse proxy / VPN. It does not
  broaden its own exposure.

LICENCE NOTE
------------
IDM-VTON is released under CC BY-NC-SA 4.0 (NON-COMMERCIAL). See README.md.
This service must not be represented as production-ready for commercial use
until that is resolved by the project owner.
"""

from __future__ import annotations

import io
import logging
import os
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, UnidentifiedImageError

from idm_runner import (
    CudaUnavailableError,
    IDMVtonRunner,
    InferenceRequest,
    PipelineNotReadyError,
)

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
load_dotenv(override=False)


def _env(name: str, default: str = "") -> str:
    value = os.getenv(name, default)
    return value.strip() if isinstance(value, str) else value


def _env_int(name: str, default: int) -> int:
    raw = _env(name, "")
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = _env(name, "")
    try:
        return float(raw) if raw else default
    except ValueError:
        return default


MODEL_PATH = _env("MODEL_PATH", "yisol/IDM-VTON")
CKPT_DIR = _env("CKPT_DIR", "./models/ckpt")
IDM_VTON_REPO_DIR = _env("IDM_VTON_REPO_DIR", "./IDM-VTON")
DEVICE = _env("DEVICE", "auto")
UPLOAD_DIR = Path(_env("UPLOAD_DIR", "./uploads")).resolve()
OUTPUT_DIR = Path(_env("OUTPUT_DIR", "./outputs")).resolve()
HOST = _env("HOST", "127.0.0.1")
PORT = _env_int("PORT", 8000)
API_KEY = _env("IDM_VTON_API_KEY", "")

DEFAULT_DENOISE_STEPS = _env_int("DEFAULT_DENOISE_STEPS", 30)
DEFAULT_SEED = _env_int("DEFAULT_SEED", 42)
GUIDANCE_SCALE = _env_float("GUIDANCE_SCALE", 2.0)
DEFAULT_GARMENT_DESCRIPTION = _env("DEFAULT_GARMENT_DESCRIPTION", "a stylish garment")
MAX_IMAGE_BYTES = _env_int("MAX_IMAGE_BYTES", 12_000_000)
IMAGE_WIDTH = _env_int("IMAGE_WIDTH", 768)
IMAGE_HEIGHT = _env_int("IMAGE_HEIGHT", 1024)
OUTPUT_RETENTION_MINUTES = _env_int("OUTPUT_RETENTION_MINUTES", 1440)

SUPPORTED_CATEGORIES = {"upper_body", "lower_body", "dresses"}
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("idm_service")


# --------------------------------------------------------------------------- #
# Runner lifecycle
# --------------------------------------------------------------------------- #
# One runner per process. A single GPU cannot run two SDXL fp16 renders at
# once (VRAM), so inference is serialised by a lock. This also matches how the
# official demo behaves.
_runner = IDMVtonRunner(
    model_path=MODEL_PATH,
    ckpt_dir=CKPT_DIR,
    device=DEVICE,
    repo_dir=IDM_VTON_REPO_DIR,
    width=IMAGE_WIDTH,
    height=IMAGE_HEIGHT,
    guidance_scale=GUIDANCE_SCALE,
)
_inference_lock = threading.Lock()
_load_lock = threading.Lock()
_load_state = {"attempted": False, "loading": False}


def _try_load_model_async() -> None:
    """Kick off model loading once, in the background.

    Loading is deferred so /health answers immediately with `not_ready` instead
    of blocking the port for the ~minute a cold SDXL load takes. When there is
    no usable GPU we skip the heavy load entirely — starting it would only fail
    or, worse, thrash CPU/RAM — and /health reports the real reason.
    """
    with _load_lock:
        if _load_state["attempted"] or _load_state["loading"]:
            return
        _load_state["attempted"] = True

    if not _runner.using_cuda:
        logger.warning(
            "CUDA is not available (device=%s). Skipping model load — IDM-VTON "
            "cannot run on CPU. /health will report not_ready.",
            _runner.device,
        )
        return

    def _worker() -> None:
        _load_state["loading"] = True
        try:
            _runner.load()
        except Exception:  # noqa: BLE001 - recorded on the runner, logged here
            logger.exception("Model load failed")
        finally:
            _load_state["loading"] = False

    threading.Thread(target=_worker, name="idm-load", daemon=True).start()


def _sweep_old_outputs() -> None:
    """Delete generated results older than OUTPUT_RETENTION_MINUTES.

    Runs in a daemon thread so an unattended GPU host does not fill its disk.
    Disabled when OUTPUT_RETENTION_MINUTES <= 0.
    """
    if OUTPUT_RETENTION_MINUTES <= 0:
        return

    while True:
        try:
            cutoff = datetime.now(timezone.utc) - timedelta(
                minutes=OUTPUT_RETENTION_MINUTES
            )
            for path in OUTPUT_DIR.glob("*.png"):
                try:
                    mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
                    if mtime < cutoff:
                        path.unlink(missing_ok=True)
                except OSError:
                    continue
        except Exception:  # noqa: BLE001 - a sweeper must never crash the service
            logger.exception("Output sweep failed")
        time.sleep(600)


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
def require_auth(authorization: Optional[str] = Header(default=None)) -> None:
    """Enforce the bearer token when IDM_VTON_API_KEY is configured.

    When the key is empty the service is assumed to be loopback-only and auth is
    skipped. Setting the key is REQUIRED whenever the port is reachable over a
    network.
    """
    if not API_KEY:
        return

    supplied = ""
    if authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()

    # Constant-time-ish comparison; the token is a shared secret, not a hash.
    import hmac

    if not hmac.compare_digest(supplied, API_KEY):
        raise HTTPException(status_code=401, detail="Unauthorized.")


# --------------------------------------------------------------------------- #
# Upload validation
# --------------------------------------------------------------------------- #
def _read_validated_image(upload: UploadFile, field: str) -> Image.Image:
    """Read an upload and return a Pillow image, or raise HTTPException(400).

    Validation is by CONTENT:
      * size ceiling (MAX_IMAGE_BYTES),
      * magic bytes must be JPEG/PNG/WEBP,
      * Pillow must actually decode it (verify + load),
      * it must be a real 2D image with sane dimensions.

    The original filename is never used for anything.
    """
    raw = upload.file.read()

    if not raw:
        raise HTTPException(status_code=400, detail=f"{field} is empty.")

    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"{field} is too large (limit {MAX_IMAGE_BYTES} bytes).",
        )

    # Magic-byte sniff — do not trust the declared content type.
    head = raw[:16]
    looks_like = (
        head.startswith(b"\xff\xd8\xff")            # JPEG
        or head.startswith(b"\x89PNG\r\n\x1a\n")    # PNG
        or (head[:4] == b"RIFF" and raw[8:12] == b"WEBP")  # WEBP
    )
    if not looks_like:
        raise HTTPException(
            status_code=400,
            detail=f"{field} is not a supported image (JPG, PNG or WebP).",
        )

    try:
        probe = Image.open(io.BytesIO(raw))
        probe.verify()  # detects truncation/corruption
        image = Image.open(io.BytesIO(raw))
        image.load()
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field} is not a valid image.")

    if image.format not in ALLOWED_IMAGE_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"{field} must be JPG, PNG or WebP.",
        )

    if image.width < 64 or image.height < 64:
        raise HTTPException(
            status_code=400,
            detail=f"{field} is too small (minimum 64x64).",
        )
    if image.width > 12000 or image.height > 12000:
        raise HTTPException(
            status_code=400,
            detail=f"{field} is too large in dimensions (maximum 12000x12000).",
        )

    return image.convert("RGB")


# --------------------------------------------------------------------------- #
# App
# --------------------------------------------------------------------------- #
app = FastAPI(
    title="Hiraya IDM-VTON Service",
    version="0.1.0",
    description=(
        "Real IDM-VTON virtual try-on inference service. "
        "IDM-VTON is licensed CC BY-NC-SA 4.0 (non-commercial)."
    ),
)


@app.on_event("startup")
def _startup() -> None:
    logger.info(
        "Starting IDM-VTON service | device=%s | model=%s | ckpt=%s | repo=%s",
        _runner.device,
        MODEL_PATH,
        CKPT_DIR,
        IDM_VTON_REPO_DIR,
    )
    logger.info(
        "Auth: %s",
        "bearer token required" if API_KEY else "OPEN (loopback only — set IDM_VTON_API_KEY to secure)",
    )
    _try_load_model_async()
    threading.Thread(target=_sweep_old_outputs, name="idm-sweep", daemon=True).start()


@app.get("/health")
def health() -> JSONResponse:
    """Report the REAL GPU / model state — never a cheerful lie.

    * `cuda_available` / `device` / `gpu_*` come straight from torch.
    * `model_loaded` is true only once the pipeline is fully constructed.
    * `status` is `ok` ONLY when the model is loaded and inference can run;
      otherwise `not_ready`, with a human-readable `reason`.
    """
    cuda_available = _runner.cuda_available
    model_loaded = _runner._loaded  # noqa: SLF001 - intentional status read

    ready = cuda_available and _runner.using_cuda and model_loaded and _runner._load_error is None

    if ready:
        status = "ok"
        reason = None
    elif not cuda_available or not _runner.using_cuda:
        status = "not_ready"
        reason = (
            "IDM-VTON requires a CUDA-capable NVIDIA GPU. No usable CUDA device "
            "is present on this host, and the official pipeline does not run "
            "correctly on CPU."
        )
    elif _runner._load_error:
        status = "not_ready"
        reason = "The IDM-VTON model failed to load. See the server log for details."
    else:
        status = "not_ready"
        reason = "The IDM-VTON model is still loading."

    return JSONResponse(
        {
            "status": status,
            "cuda_available": cuda_available,
            "device": _runner.device,
            "model_loaded": model_loaded,
            "gpu_name": _runner.gpu_name,
            "gpu_vram_gb": _runner.gpu_vram_gb,
            "model_path": MODEL_PATH,
            "reason": reason,
        }
    )


@app.post("/virtual-tryon", dependencies=[Depends(require_auth)])
async def virtual_tryon(
    person_image: UploadFile = File(...),
    garment_image: UploadFile = File(...),
    category: str = Form("upper_body"),
    garment_description: str = Form(""),
    denoise_steps: int = Form(DEFAULT_DENOISE_STEPS),
    seed: int = Form(DEFAULT_SEED),
    crop: bool = Form(False),
) -> JSONResponse:
    """Generate a virtual try-on with REAL IDM-VTON inference.

    Multipart/form-data fields: person_image, garment_image, category,
    garment_description, denoise_steps, seed, crop. See README.md.

    Success: 200 { "success": true, "result_url": "/results/<uuid>.png", ... }
    Failure: the appropriate 4xx/5xx with { "success": false, "error": "..." }
    """
    # --- Category -----------------------------------------------------
    category = (category or "").strip().lower()
    if category not in SUPPORTED_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=(
                "category must be one of: "
                + ", ".join(sorted(SUPPORTED_CATEGORIES))
                + "."
            ),
        )

    # --- Numeric bounds ----------------------------------------------
    denoise_steps = max(20, min(40, int(denoise_steps)))
    seed = int(seed)

    # --- Description (configurable fallback) --------------------------
    description = (garment_description or "").strip() or DEFAULT_GARMENT_DESCRIPTION

    # --- Readiness: be honest, do not pretend -------------------------
    if not _runner.using_cuda or not _runner.cuda_available:
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "error": (
                    "The virtual try-on service requires a CUDA-capable NVIDIA "
                    "GPU and this host does not have one available. "
                    "The configured IDM-VTON pipeline cannot run in this "
                    "environment."
                ),
            },
        )
    if not _runner._loaded:  # noqa: SLF001
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "error": (
                    "The virtual try-on model is not ready yet. Please retry "
                    "shortly."
                ),
            },
        )

    # --- Validate uploads --------------------------------------------
    person = _read_validated_image(person_image, "person_image")
    garment = _read_validated_image(garment_image, "garment_image")

    # --- Stage inputs under server-generated names -------------------
    token = uuid.uuid4().hex
    person_path = UPLOAD_DIR / f"{token}-person.png"
    garment_path = UPLOAD_DIR / f"{token}-garment.png"
    result_path = OUTPUT_DIR / f"{token}.png"

    try:
        person.save(person_path, format="PNG")
        garment.save(garment_path, format="PNG")

        request = InferenceRequest(
            person_image=person,
            garment_image=garment,
            category=category,
            garment_description=description,
            denoise_steps=denoise_steps,
            seed=seed,
            crop=crop,
        )

        # One render at a time — a single GPU cannot hold two SDXL pipelines.
        with _inference_lock:
            result = _runner.run(request)

        result.image.save(result_path, format="PNG")

        logger.info(
            "Rendered try-on %s (category=%s steps=%d seed=%d in %.1fs)",
            result_path.name,
            category,
            denoise_steps,
            seed,
            result.seconds,
        )

        return JSONResponse(
            {
                "success": True,
                "result_url": f"/results/{result_path.name}",
                "seed": result.seed,
                "denoise_steps": result.denoise_steps,
                "category": result.category,
                "seconds": result.seconds,
            }
        )

    except CudaUnavailableError:
        logger.warning("Inference refused: CUDA unavailable")
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "error": (
                    "The virtual try-on service requires a CUDA-capable NVIDIA "
                    "GPU. Please check the service configuration."
                ),
            },
        )
    except PipelineNotReadyError:
        logger.warning("Inference refused: pipeline not ready")
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "error": "The virtual try-on model is not ready. Please retry shortly.",
            },
        )
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 - the real error stays server-side
        # Full detail (with stack trace) goes to the log; the caller gets an
        # actionable but non-leaking message.
        logger.exception("IDM-VTON inference failed")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": (
                    "Virtual fitting failed while generating the image. "
                    "Please try again with a different photo."
                ),
            },
        )
    finally:
        # Temporary inputs are disposable; only the result is kept.
        for path in (person_path, garment_path):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                logger.warning("Could not remove temporary file %s", path.name)


@app.get("/results/{filename}")
def get_result(filename: str) -> FileResponse:
    """Serve a generated result PNG.

    `filename` is matched against the safe pattern the service itself emits
    (a uuid4 hex + .png). Anything else is refused, so this cannot be used to
    read arbitrary files.
    """
    stem = Path(filename).stem
    if (
        Path(filename).name != filename
        or not stem
        or len(stem) != 32
        or any(ch not in "0123456789abcdef" for ch in stem)
        or Path(filename).suffix != ".png"
    ):
        raise HTTPException(status_code=400, detail="Invalid result reference.")

    path = OUTPUT_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Result not found.")

    return FileResponse(path, media_type="image/png", filename=filename)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT)
