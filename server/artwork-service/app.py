"""
Thermal artwork drawing service.

Turns a product photo's line map into a clean illustrated drawing the way an
image-generation model would: Stable Diffusion 1.5 guided by ControlNet
Lineart, with LCM-LoRA so a handful of steps is enough on a CPU. The ERP
backend sends the line map it already produces (Informative Drawings) and gets
a drawing back; everything stays on this box.

Endpoints
  GET  /health   -> {ok, loaded, loading, model, ...}
  POST /draw     -> {image: base64 PNG, width, height, ms, seed}
"""

import base64
import io
import os
import threading
import time

from fastapi import FastAPI, HTTPException
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

MODEL = os.environ.get("SD_MODEL", "Lykon/dreamshaper-8")
CONTROLNET = os.environ.get("SD_CONTROLNET", "lllyasviel/control_v11p_sd15_lineart")
LCM_LORA = os.environ.get("SD_LCM_LORA", "latent-consistency/lcm-lora-sdv1-5")
THREADS = int(os.environ.get("SD_THREADS", "5"))
MAX_SIDE = int(os.environ.get("SD_MAX_SIDE", "448"))
# float32 is the safe default on any CPU; bfloat16 halves the memory traffic
# and is much faster where the CPU has native bf16 (Zen 4, Sapphire Rapids).
DTYPE = os.environ.get("SD_DTYPE", "float32").strip().lower()
WARM_ON_START = os.environ.get("SD_WARM_ON_START", "1") != "0"

# "Coloring book page" is the phrase that reliably buys a white background and
# outline-only rendering from SD 1.5; the earlier "technical line art" wording
# came back with a grey backdrop and soft shading.
# "every surface left white / no black areas" matters for dark products: with
# the shorter wording a black shoe came back as a black shoe, and the label
# then had to hollow the fills out itself.
DEFAULT_PROMPT = (
    "coloring book page of a sneaker shoe, black outline drawing only, every surface left white, "
    "no fill, no black areas, pure white background, line art, monochrome, no shading, "
    "simple flat vector illustration, thick uniform lines"
)
DEFAULT_NEGATIVE = (
    "black fill, solid black, dark, silhouette, gray, grey, shading, gradient, color, colours, photo, "
    "realistic, texture, background, shadow, blurry, noise, text, watermark, dark background, halftone"
)

app = FastAPI(title="thermal-artwork-drawing")

_state = {"loaded": False, "loading": False, "error": "", "load_ms": 0}
_lock = threading.Lock()
_pipe = None


def _load_pipeline():
    global _pipe
    import torch
    from diffusers import ControlNetModel, LCMScheduler, StableDiffusionControlNetPipeline

    torch.set_num_threads(THREADS)
    dtype = torch.bfloat16 if DTYPE in ("bf16", "bfloat16") else torch.float32
    started = time.time()
    controlnet = ControlNetModel.from_pretrained(CONTROLNET, torch_dtype=dtype)
    pipe = StableDiffusionControlNetPipeline.from_pretrained(
        MODEL,
        controlnet=controlnet,
        torch_dtype=dtype,
        safety_checker=None,
        requires_safety_checker=False,
    )
    pipe.scheduler = LCMScheduler.from_config(pipe.scheduler.config)
    pipe.load_lora_weights(LCM_LORA)
    pipe.fuse_lora()
    pipe.to("cpu")
    pipe.set_progress_bar_config(disable=True)
    _pipe = pipe
    _state["load_ms"] = int((time.time() - started) * 1000)


def get_pipe():
    global _pipe
    if _pipe is not None:
        return _pipe
    with _lock:
        if _pipe is None:
            _state["loading"] = True
            try:
                _load_pipeline()
                _state["loaded"] = True
                _state["error"] = ""
            except Exception as error:  # noqa: BLE001 - reported through /health
                _state["error"] = f"{type(error).__name__}: {error}"
                raise
            finally:
                _state["loading"] = False
    return _pipe


@app.on_event("startup")
def warm():
    if not WARM_ON_START:
        return

    def run():
        try:
            get_pipe()
        except Exception:  # noqa: BLE001 - /health carries the reason
            pass

    threading.Thread(target=run, daemon=True).start()


@app.get("/health")
def health():
    return {
        "ok": True,
        "loaded": _state["loaded"],
        "loading": _state["loading"],
        "error": _state["error"],
        "load_ms": _state["load_ms"],
        "model": MODEL,
        "controlnet": CONTROLNET,
        "lcm_lora": LCM_LORA,
        "threads": THREADS,
        "max_side": MAX_SIDE,
        "dtype": DTYPE,
    }


class DrawRequest(BaseModel):
    control: str = Field(..., description="base64 PNG of the line map, black lines on white")
    prompt: str = DEFAULT_PROMPT
    negative_prompt: str = DEFAULT_NEGATIVE
    steps: int = Field(6, ge=1, le=12)
    guidance: float = Field(1.8, ge=0.0, le=8.0)
    controlnet_scale: float = Field(1.0, ge=0.0, le=2.0)
    seed: int = 0
    max_side: int = Field(0, ge=0, le=768)
    # ControlNet 1.1 Lineart was trained on white lines over black; the
    # annotator output people look at is the opposite. Inverted by default.
    invert_control: bool = True


def _decode(data: str) -> Image.Image:
    if "," in data and data.strip().startswith("data:"):
        data = data.split(",", 1)[1]
    try:
        return Image.open(io.BytesIO(base64.b64decode(data)))
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"control image could not be decoded: {error}") from error


def _fit(image: Image.Image, max_side: int) -> Image.Image:
    """Scale to the working size on a white canvas, sides rounded to 64 px."""
    image = image.convert("L")
    width, height = image.size
    scale = max_side / max(width, height)
    target_w = max(64, int(round((width * scale) / 64)) * 64)
    target_h = max(64, int(round((height * scale) / 64)) * 64)
    return image.resize((target_w, target_h), Image.LANCZOS)


@app.post("/draw")
def draw(req: DrawRequest):
    import torch

    pipe = get_pipe()
    control = _fit(_decode(req.control), req.max_side or MAX_SIDE)
    if req.invert_control:
        control = ImageOps.invert(control)
    control = control.convert("RGB")

    generator = torch.Generator(device="cpu").manual_seed(int(req.seed))
    started = time.time()
    with _lock:
        result = pipe(
            prompt=req.prompt,
            negative_prompt=req.negative_prompt,
            image=control,
            num_inference_steps=req.steps,
            guidance_scale=req.guidance,
            controlnet_conditioning_scale=req.controlnet_scale,
            generator=generator,
        )
    image = result.images[0].convert("L")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return {
        "image": base64.b64encode(buffer.getvalue()).decode("ascii"),
        "width": image.width,
        "height": image.height,
        "ms": int((time.time() - started) * 1000),
        "seed": req.seed,
        "steps": req.steps,
    }
