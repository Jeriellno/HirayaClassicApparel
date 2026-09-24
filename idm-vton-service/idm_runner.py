"""
idm_runner.py — the ACTUAL IDM-VTON inference pipeline.

This module is a faithful, headless re-implementation of the official IDM-VTON
demo (`gradio_demo/app.py` from https://github.com/yisol/IDM-VTON). It performs
the SAME steps, in the SAME order, using the SAME upstream classes — it does
NOT invent a simplified "two images in, image out" shortcut.

Pipeline (matching the official app.py `start_tryon`):

    1. Load the IDM-VTON SDXL weights (unet, unet_encoder, vae, text encoders,
       image encoder, scheduler, tokenizers) from MODEL_PATH.
    2. Garment image  -> convert("RGB").resize((768, 1024)).
    3. Human image    -> optional 3:4 auto-crop, then resize((768, 1024)).
    4. OpenPose       -> 18 body keypoints from the human image (384x512).
    5. HumanParsing   -> SCHP ONNX segmentation (384x512), CPU provider.
    6. Mask generation-> get_mask_location(...) builds the agnostic inpainting
                         mask from parsing + keypoints (utils_mask.py).
    7. DensePose      -> detectron2 apply_net produces the pose conditioning
                         image from the 384x512 human image.
    8. Diffusion      -> the modified SDXL inpaint pipeline renders the try-on
                         at 768x1024, conditioned on the garment embedding
                         (IP-Adapter), the cloth tensor, the pose image, the
                         mask and the two text prompts.
    9. Output         -> a PIL image, saved as a PNG.

Everything is imported from the official IDM-VTON checkout (cloned to
IDM_VTON_REPO_DIR, default ./IDM-VTON) and from the configured CKPT_DIR. None
of the model logic is re-written here.

WHY THE MODULE IMPORTS THE OFFICIAL CODE RATHER THAN VENDORING IT
----------------------------------------------------------------
The custom UNet subclasses and the modified SDXL inpainting pipeline are large
and are exactly the parts that must NOT be paraphrased. Importing them keeps a
single source of truth (the official repo) and makes the licence/attribution
relationship obvious.

GPU NOTE
--------
IDM-VTON is an SDXL-based fp16 model. Its official preprocessing modules call
`torch.cuda.set_device(...)` unconditionally, and a full render needs roughly
16 GB of VRAM. CPU execution is NOT practical and is NOT silently substituted:
`CudaUnavailableError` is raised and surfaced to the caller as an honest
failure. See README.md.
"""

from __future__ import annotations

import logging
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from PIL import Image

logger = logging.getLogger("idm_runner")


class CudaUnavailableError(RuntimeError):
    """Raised when IDM-VTON is asked to run without a usable CUDA device.

    IDM-VTON's own preprocessing (`preprocess.openpose.run_openpose.OpenPose`
    and `preprocess.humanparsing.run_parsing.Parsing`) calls
    `torch.cuda.set_device(gpu_id)` in its constructor and DensePose is invoked
    with `--opts MODEL.DEVICE cuda`. Those calls fail outright on a CPU-only
    box, so we refuse up front rather than letting the pipeline explode halfway
    through (or, worse, appear to succeed with a degraded result).
    """


class PipelineNotReadyError(RuntimeError):
    """Raised when inference is requested before the model finished loading."""


@dataclass
class InferenceRequest:
    """Normalised, validated inputs for one try-on render."""

    person_image: Image.Image
    garment_image: Image.Image
    category: str                    # 'upper_body' | 'lower_body' | 'dresses'
    garment_description: str
    denoise_steps: int = 30
    seed: int = 42
    crop: bool = False               # official demo's "auto-crop & resizing"


@dataclass
class InferenceResult:
    """The output of a real render."""

    image: Image.Image
    seed: int
    denoise_steps: int
    category: str
    seconds: float


class IDMVtonRunner:
    """Holds the loaded IDM-VTON pipeline and runs real inference.

    Loading the model is expensive (several gigabytes, tens of seconds), so the
    service constructs ONE runner at startup and reuses it. `load()` is
    idempotent and thread-guarded by the caller (the FastAPI layer serialises
    inference — a single GPU cannot run two SDXL renders at once anyway).
    """

    def __init__(
        self,
        model_path: str,
        ckpt_dir: str,
        device: str = "auto",
        repo_dir: Optional[str] = None,
        width: int = 768,
        height: int = 1024,
        guidance_scale: float = 2.0,
    ) -> None:
        self.model_path = model_path
        self.ckpt_dir = Path(ckpt_dir).resolve()
        self.repo_dir = Path(repo_dir or "./IDM-VTON").resolve()
        self.width = width
        self.height = height
        self.guidance_scale = guidance_scale

        self.device = self._resolve_device(device)

        self._loaded = False
        self._load_error: Optional[str] = None

        # Populated by load().
        self.pipe = None
        self.unet_encoder = None
        self.parsing_model = None
        self.openpose_model = None
        self._apply_net = None
        self._densepose_args = None
        self._tensor_transform = None
        self._get_mask_location = None
        self._pil_to_binary_mask = None

    # ------------------------------------------------------------------ #
    # Device / environment
    # ------------------------------------------------------------------ #
    @staticmethod
    def _torch_available() -> bool:
        """Is PyTorch importable at all?

        torch is only installed on the GPU host. On a machine that merely runs
        the service to inspect /health (or a misconfigured deployment) torch may
        be absent — and that must degrade honestly to `not_ready`, not crash the
        whole process at import time.
        """
        import importlib.util

        return importlib.util.find_spec("torch") is not None

    @classmethod
    def _resolve_device(cls, requested: str) -> str:
        requested = (requested or "auto").strip().lower()

        if requested == "auto":
            # Without torch there is no CUDA either; report `cpu` so /health is
            # truthful rather than raising on import.
            if not cls._torch_available():
                return "cpu"

            import torch

            return "cuda:0" if torch.cuda.is_available() else "cpu"

        return requested

    @property
    def cuda_available(self) -> bool:
        if not self._torch_available():
            return False

        try:
            import torch

            return bool(torch.cuda.is_available())
        except Exception:  # pragma: no cover - torch import failure
            return False

    @property
    def using_cuda(self) -> bool:
        return self.device.startswith("cuda")

    @property
    def gpu_name(self) -> Optional[str]:
        try:
            import torch

            if not torch.cuda.is_available():
                return None
            return torch.cuda.get_device_name(0)
        except Exception:  # pragma: no cover
            return None

    @property
    def gpu_vram_gb(self) -> Optional[float]:
        try:
            import torch

            if not torch.cuda.is_available():
                return None
            total = torch.cuda.get_device_properties(0).total_memory
            return round(total / (1024 ** 3), 1)
        except Exception:  # pragma: no cover
            return None

    def assert_cuda_ready(self) -> None:
        """Refuse to run inference on a device IDM-VTON cannot actually use.

        This is the guard that keeps the service HONEST: rather than falling
        back to a CPU path that the upstream code does not support (its
        preprocessing calls torch.cuda.set_device) — or returning a fake
        "success" — we raise, and the API layer turns that into a truthful
        error.
        """
        if not self.using_cuda:
            raise CudaUnavailableError(
                "IDM-VTON requires a CUDA-capable NVIDIA GPU. The configured "
                "device is '%s' and torch.cuda.is_available() is %s. The "
                "official IDM-VTON pipeline (SDXL fp16, ~16 GB VRAM) does not "
                "run correctly on CPU: its preprocessing modules call "
                "torch.cuda.set_device() and DensePose is invoked with "
                "MODEL.DEVICE cuda." % (self.device, self.cuda_available)
            )

        import torch

        if not torch.cuda.is_available():
            raise CudaUnavailableError(
                "Device is set to '%s' but CUDA is not available to PyTorch "
                "(torch.cuda.is_available() -> False). Check the NVIDIA driver "
                "and that the CUDA-enabled torch wheel is installed."
                % self.device
            )

    # ------------------------------------------------------------------ #
    # Loading
    # ------------------------------------------------------------------ #
    def load(self) -> None:
        """Load every model the pipeline needs. Safe to call once at startup.

        Any failure is recorded (not raised) so /health can report an accurate
        `model_loaded: false` plus the reason, and the API can refuse inference
        with a clear message instead of a stack trace.
        """
        if self._loaded:
            return

        try:
            self._load()
            self._loaded = True
            self._load_error = None
            logger.info("IDM-VTON pipeline loaded on %s", self.device)
        except Exception as exc:  # noqa: BLE001 - reported, not swallowed
            self._load_error = f"{type(exc).__name__}: {exc}"
            logger.exception("IDM-VTON pipeline failed to load")
            raise

    def _load(self) -> None:
        import torch
        from torchvision import transforms

        # The official repo must be importable (`src.*`, `ip_adapter.*`,
        # `preprocess.*`, `gradio_demo.utils_mask`, `gradio_demo.apply_net`).
        self._ensure_repo_on_path()

        # --- Heavy imports (deferred so `import idm_runner` stays cheap) ---
        from transformers import (
            CLIPImageProcessor,
            CLIPImageProcessor as _CLIPImageProcessor,  # noqa: F401 (parity)
            CLIPTextModel,
            CLIPTextModelWithProjection,
            CLIPVisionModelWithProjection,
            AutoTokenizer,
        )
        from diffusers import DDPMScheduler, AutoencoderKL

        from src.tryon_pipeline import (
            StableDiffusionXLInpaintPipeline as TryonPipeline,
        )
        from src.unet_hacked_garmnet import (
            UNet2DConditionModel as UNet2DConditionModel_ref,
        )
        from src.unet_hacked_tryon import UNet2DConditionModel
        from preprocess.humanparsing.run_parsing import Parsing
        from preprocess.openpose.run_openpose import OpenPose

        from gradio_demo.utils_mask import get_mask_location
        from gradio_demo import apply_net as apply_net_module

        base_path = self.model_path

        # --- Preprocessing models -------------------------------------
        # These constructors call torch.cuda.set_device(); on a CPU-only host
        # they raise, which is exactly the honest signal we want. (gpu_id 0.)
        self.parsing_model = Parsing(0)
        self.openpose_model = OpenPose(0)

        # --- IDM-VTON SDXL components ---------------------------------
        unet = UNet2DConditionModel.from_pretrained(
            base_path, subfolder="unet", torch_dtype=torch.float16
        )
        unet.requires_grad_(False)

        tokenizer_one = AutoTokenizer.from_pretrained(
            base_path, subfolder="tokenizer", revision=None, use_fast=False
        )
        tokenizer_two = AutoTokenizer.from_pretrained(
            base_path, subfolder="tokenizer_2", revision=None, use_fast=False
        )
        noise_scheduler = DDPMScheduler.from_pretrained(
            base_path, subfolder="scheduler"
        )

        text_encoder_one = CLIPTextModel.from_pretrained(
            base_path, subfolder="text_encoder", torch_dtype=torch.float16
        )
        text_encoder_two = CLIPTextModelWithProjection.from_pretrained(
            base_path, subfolder="text_encoder_2", torch_dtype=torch.float16
        )
        image_encoder = CLIPVisionModelWithProjection.from_pretrained(
            base_path, subfolder="image_encoder", torch_dtype=torch.float16
        )
        vae = AutoencoderKL.from_pretrained(
            base_path, subfolder="vae", torch_dtype=torch.float16
        )
        unet_encoder = UNet2DConditionModel_ref.from_pretrained(
            base_path, subfolder="unet_encoder", torch_dtype=torch.float16
        )

        for module in (
            unet_encoder,
            image_encoder,
            vae,
            unet,
            text_encoder_one,
            text_encoder_two,
        ):
            module.requires_grad_(False)

        pipe = TryonPipeline.from_pretrained(
            base_path,
            unet=unet,
            vae=vae,
            feature_extractor=CLIPImageProcessor(),
            text_encoder=text_encoder_one,
            text_encoder_2=text_encoder_two,
            tokenizer=tokenizer_one,
            tokenizer_2=tokenizer_two,
            scheduler=noise_scheduler,
            image_encoder=image_encoder,
            torch_dtype=torch.float16,
        )
        pipe.unet_encoder = unet_encoder

        self.pipe = pipe
        self.unet_encoder = unet_encoder

        # --- Preprocessing helpers ------------------------------------
        self._tensor_transform = transforms.Compose(
            [transforms.ToTensor(), transforms.Normalize([0.5], [0.5])]
        )
        self._to_tensor = transforms.ToTensor()
        self._get_mask_location = get_mask_location
        self._pil_to_binary_mask = self._make_pil_to_binary_mask()
        self._apply_net = apply_net_module

        # DensePose is driven through apply_net's OWN argument parser, exactly
        # as the official demo does, so we inherit its pipeline defaults.
        self._densepose_args = apply_net_module.create_argument_parser().parse_args(
            (
                "show",
                "./configs/densepose_rcnn_R_50_FPN_s1x.yaml",
                str(self.ckpt_dir / "densepose" / "model_final_162be9.pkl"),
                "dp_segm",
                "-v",
                "--opts",
                "MODEL.DEVICE",
                "cuda",
            )
        )

    def _ensure_repo_on_path(self) -> None:
        """Make the official IDM-VTON checkout importable.

        The repo is cloned to `IDM_VTON_REPO_DIR` (default ./IDM-VTON). Its
        modules are imported with the repo root on sys.path, matching how the
        official `gradio_demo/app.py` does `sys.path.append('./')`.
        """
        if not self.repo_dir.exists():
            raise FileNotFoundError(
                "The official IDM-VTON repository was not found at '%s'. "
                "Clone it there (see README.md) or set IDM_VTON_REPO_DIR."
                % self.repo_dir
            )

        repo_str = str(self.repo_dir)
        if repo_str not in sys.path:
            sys.path.insert(0, repo_str)

        # The demo modules import as `gradio_demo.utils_mask` / `gradio_demo.apply_net`,
        # which requires the repo ROOT (whose child is `gradio_demo/`) on the
        # path — that is `repo_dir` itself. Verified against the upstream tree.
        for required in ("src", "gradio_demo", "preprocess", "ip_adapter", "configs"):
            if not (self.repo_dir / required).exists():
                raise FileNotFoundError(
                    "IDM-VTON checkout at '%s' is missing the '%s' directory. "
                    "It does not look like a complete clone of "
                    "https://github.com/yisol/IDM-VTON." % (self.repo_dir, required)
                )

    @staticmethod
    def _make_pil_to_binary_mask():
        """The official `pil_to_binary_mask` (used only for the manual-mask path).

        Kept for parity with the upstream demo. Normal inference uses the
        auto-generated mask (`get_mask_location`), which is the documented path
        for a try-on without a user-drawn mask.
        """
        import numpy as np

        def pil_to_binary_mask(pil_image, threshold=0):
            np_image = np.array(pil_image)
            grayscale_image = Image.fromarray(np_image).convert("L")
            binary_mask = np.array(grayscale_image) > threshold
            mask = np.zeros(binary_mask.shape, dtype=np.uint8)
            mask[binary_mask] = 1
            return Image.fromarray((mask * 255).astype(np.uint8))

        return pil_to_binary_mask

    # ------------------------------------------------------------------ #
    # Inference
    # ------------------------------------------------------------------ #
    def run(self, request: InferenceRequest) -> InferenceResult:
        """Run a REAL IDM-VTON render. No caching, no mock, no passthrough."""
        if not self._loaded:
            raise PipelineNotReadyError(
                "The IDM-VTON model is not loaded yet. "
                + (self._load_error or "It may still be loading.")
            )

        self.assert_cuda_ready()

        import numpy as np
        import torch
        from torchvision.transforms.functional import to_pil_image
        from detectron2.data.detection_utils import (
            _apply_exif_orientation,
            convert_PIL_to_numpy,
        )

        started = time.time()

        device = self.device
        pipe = self.pipe

        # Preprocessing modules live on the GPU only when inference runs, the
        # same lifetime the official demo uses.
        self.openpose_model.preprocessor.body_estimation.model.to(device)
        pipe.to(device)
        pipe.unet_encoder.to(device)

        # --- 1. Garment: RGB, fixed 768x1024 --------------------------
        garm_img = request.garment_image.convert("RGB").resize(
            (self.width, self.height)
        )

        # --- 2. Human: optional 3:4 auto-crop, then 768x1024 ----------
        human_img_orig = request.person_image.convert("RGB")

        crop_size = None
        left = top = 0
        if request.crop:
            width, height = human_img_orig.size
            target_width = int(min(width, height * (3 / 4)))
            target_height = int(min(height, width * (4 / 3)))
            left = (width - target_width) / 2
            top = (height - target_height) / 2
            right = (width + target_width) / 2
            bottom = (height + target_height) / 2
            cropped_img = human_img_orig.crop((left, top, right, bottom))
            crop_size = cropped_img.size
            human_img = cropped_img.resize((self.width, self.height))
        else:
            human_img = human_img_orig.resize((self.width, self.height))

        # --- 3. OpenPose keypoints + 4. HumanParsing ------------------
        # Auto-mask path (official demo's default): the agnostic mask is
        # derived from the body parsing + pose, so the garment region is
        # determined by IDM-VTON's own pipeline rather than by us.
        keypoints = self.openpose_model(human_img.resize((384, 512)))
        model_parse, _ = self.parsing_model(human_img.resize((384, 512)))

        # --- 5. Agnostic mask generation ------------------------------
        mask, _mask_gray = self._get_mask_location(
            "hd", request.category, model_parse, keypoints
        )
        mask = mask.resize((self.width, self.height))

        mask_gray = (1 - self._to_tensor(mask)) * self._tensor_transform(human_img)
        mask_gray = to_pil_image((mask_gray + 1.0) / 2.0)

        # --- 6. DensePose conditioning image --------------------------
        human_img_arg = _apply_exif_orientation(human_img.resize((384, 512)))
        human_img_arg = convert_PIL_to_numpy(human_img_arg, format="BGR")

        args = self._densepose_args
        pose_img = args.func(args, human_img_arg)
        pose_img = pose_img[:, :, ::-1]
        pose_img = Image.fromarray(pose_img).resize((self.width, self.height))

        # --- 7. Diffusion inference -----------------------------------
        with torch.no_grad():
            with torch.cuda.amp.autocast():
                # Human-context prompt (idm-vton upstream default wording).
                prompt = "model is wearing " + request.garment_description
                negative_prompt = (
                    "monochrome, lowres, bad anatomy, worst quality, low quality"
                )

                (
                    prompt_embeds,
                    negative_prompt_embeds,
                    pooled_prompt_embeds,
                    negative_pooled_prompt_embeds,
                ) = pipe.encode_prompt(
                    prompt,
                    num_images_per_prompt=1,
                    do_classifier_free_guidance=True,
                    negative_prompt=negative_prompt,
                )

                # Garment-context prompt (drives the cloth text embedding).
                prompt = "a photo of " + request.garment_description
                if not isinstance(prompt, list):
                    prompt = [prompt]
                if not isinstance(negative_prompt, list):
                    negative_prompt = [negative_prompt]

                (prompt_embeds_c, _, _, _) = pipe.encode_prompt(
                    prompt,
                    num_images_per_prompt=1,
                    do_classifier_free_guidance=False,
                    negative_prompt=negative_prompt,
                )

                pose_tensor = (
                    self._tensor_transform(pose_img)
                    .unsqueeze(0)
                    .to(device, torch.float16)
                )
                garm_tensor = (
                    self._tensor_transform(garm_img)
                    .unsqueeze(0)
                    .to(device, torch.float16)
                )

                generator = (
                    torch.Generator(device).manual_seed(request.seed)
                    if request.seed is not None
                    else None
                )

                images = pipe(
                    prompt_embeds=prompt_embeds.to(device, torch.float16),
                    negative_prompt_embeds=negative_prompt_embeds.to(device, torch.float16),
                    pooled_prompt_embeds=pooled_prompt_embeds.to(device, torch.float16),
                    negative_pooled_prompt_embeds=negative_pooled_prompt_embeds.to(
                        device, torch.float16
                    ),
                    num_inference_steps=request.denoise_steps,
                    generator=generator,
                    strength=1.0,
                    pose_img=pose_tensor,
                    text_embeds_cloth=prompt_embeds_c.to(device, torch.float16),
                    cloth=garm_tensor,
                    mask_image=mask,
                    image=human_img,
                    height=self.height,
                    width=self.width,
                    ip_adapter_image=garm_img.resize((self.width, self.height)),
                    guidance_scale=self.guidance_scale,
                )[0]

        # --- 8. Output (mirror the official crop-back behaviour) ------
        if request.crop and crop_size is not None:
            out_img = images[0].resize(crop_size)
            human_img_orig.paste(out_img, (int(left), int(top)))
            result_image = human_img_orig
        else:
            result_image = images[0]

        return InferenceResult(
            image=result_image,
            seed=request.seed,
            denoise_steps=request.denoise_steps,
            category=request.category,
            seconds=round(time.time() - started, 2),
        )