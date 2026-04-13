import asyncio
import base64
import gc
import io
import json
import logging
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Literal

import requests
import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pydub import AudioSegment

logger = logging.getLogger("frieren_rvc_bridge")

KOKORO_SYNTH_MODE = os.getenv("KOKORO_SYNTH_MODE", "http").strip().lower() or "http"
KOKORO_BASE_URL = os.getenv("KOKORO_BASE_URL", "http://127.0.0.1:8880/v1")
KOKORO_DEFAULT_VOICE = os.getenv("KOKORO_DEFAULT_VOICE", "jf_alpha")
KOKORO_PROJECT_DIR = Path(
    os.getenv(
        "KOKORO_PROJECT_DIR",
        str(Path(__file__).resolve().parent.parent / "Kokoro-FastAPI"),
    )
).resolve()
KOKORO_REQUEST_TIMEOUT = float(os.getenv("KOKORO_REQUEST_TIMEOUT", "120"))
KOKORO_MODEL_PATH = Path(
    os.getenv(
        "KOKORO_MODEL_PATH",
        str(KOKORO_PROJECT_DIR / "api" / "src" / "models" / "v1_0" / "kokoro-v1_0.pth"),
    )
).resolve()
KOKORO_CONFIG_PATH = Path(
    os.getenv(
        "KOKORO_CONFIG_PATH",
        str(KOKORO_PROJECT_DIR / "api" / "src" / "models" / "v1_0" / "config.json"),
    )
).resolve()
KOKORO_VOICES_DIR = Path(
    os.getenv(
        "VOICES_DIR",
        str(KOKORO_PROJECT_DIR / "api" / "src" / "voices" / "v1_0"),
    )
).resolve()
KOKORO_USE_GPU = os.getenv("USE_GPU", "false").strip().lower() in {"1", "true", "yes", "on"}
KOKORO_DEVICE_TYPE = os.getenv("DEVICE_TYPE", "cpu").strip().lower() or "cpu"
KOKORO_PRELOAD_MODEL = os.getenv("PRELOAD_MODEL_ON_STARTUP", "false").strip().lower() in {"1", "true", "yes", "on"}
KOKORO_UNLOAD_AFTER_REQUEST = os.getenv("UNLOAD_MODEL_AFTER_REQUEST", "true").strip().lower() in {"1", "true", "yes", "on"}
DUAL_LLM_BASE_URL = os.getenv("DUAL_LLM_BASE_URL", "https://api.openai.com/v1")
DUAL_LLM_API_KEY = os.getenv("DUAL_LLM_API_KEY", "")
DUAL_LLM_MODEL = os.getenv("DUAL_LLM_MODEL", "gpt-4.1-mini")
DUAL_LLM_TIMEOUT = float(os.getenv("DUAL_LLM_TIMEOUT", "120"))
DUAL_LLM_CACHE_SIZE = int(os.getenv("DUAL_LLM_CACHE_SIZE", "256"))
DUAL_LLM_CACHE_TTL_SECONDS = int(os.getenv("DUAL_LLM_CACHE_TTL_SECONDS", "3600"))
DUAL_LLM_PROMPT = os.getenv(
    "DUAL_LLM_PROMPT",
    """你是一个双输出对话助手。

你必须根据用户输入，输出两份内容：

1. display_text
给画面显示的繁体中文回复。
要求：
- 自然、简洁、好读
- 保持原意
- 不要过长
- 不要加入多余说明
- 不要输出系统解释

2. speech_text
给语音合成使用的日文回复。
要求：
- 与 display_text 语义一致
- 使用自然、简短、适合口语朗读的日文
- 风格平静、克制、冷静、温柔
- 不要过度可爱，不要热血，不要夸张
- 尽量像《葬送的芙莉蓮》中芙莉蓮平常说话的感觉
- 优先使用短句
- 避免太复杂的书面语
- 避免使用特殊符号、emoji、旁白说明
- 只输出适合直接念出来的台词

输出格式必须是严格 JSON：
{
  "display_text": "...",
  "speech_text": "..."
}

不要输出 JSON 以外的任何文字。""",
)
RVC_WORKDIR = Path(os.getenv("RVC_WORKDIR", "/data/rvc-workdir"))
RVC_ASSETS_DIR = Path(os.getenv("RVC_ASSETS_DIR", "/data/rvc-assets"))
RVC_MODEL_PATH = Path(
    os.getenv(
        "RVC_MODEL_PATH",
        "/data/models/Frieren_e720_s6480.pth",
    )
)
RVC_INDEX_PATH = Path(
    os.getenv(
        "RVC_INDEX_PATH",
        "/data/models/added_IVF280_Flat_nprobe_1_Frieren_v2.index",
    )
)
RVC_HUBERT_URL = os.getenv(
    "RVC_HUBERT_URL",
    "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/hubert_base.pt",
)
RVC_RMVPE_URL = os.getenv(
    "RVC_RMVPE_URL",
    "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.pt",
)
RVC_HUBERT_PATH = RVC_ASSETS_DIR / "hubert_base.pt"
RVC_F0_METHOD = os.getenv("RVC_F0_METHOD", "rmvpe").strip().lower() or "rmvpe"
RVC_EXECUTION_MODE = os.getenv("RVC_EXECUTION_MODE", "inprocess").strip().lower() or "inprocess"
RVC_SUBPROCESS_TIMEOUT = float(os.getenv("RVC_SUBPROCESS_TIMEOUT", "300"))
RVC_INDEX_RATE = float(os.getenv("RVC_INDEX_RATE", "0.6"))
RVC_FILTER_RADIUS = int(os.getenv("RVC_FILTER_RADIUS", "3"))
RVC_RMS_MIX_RATE = float(os.getenv("RVC_RMS_MIX_RATE", "0.25"))
RVC_PROTECT = float(os.getenv("RVC_PROTECT", "0.33"))
RVC_WARMUP_TEXT = os.getenv("RVC_WARMUP_TEXT", "こんにちは。")
RVC_DEVICE_OVERRIDE = os.getenv("FORCE_RVC_DEVICE", "").strip().lower()
RVC_PRELOAD_MODEL = os.getenv("RVC_PRELOAD_MODEL", "true").strip().lower() in {"1", "true", "yes", "on"}
RVC_ENABLE_WARMUP = os.getenv("RVC_ENABLE_WARMUP", "true").strip().lower() in {"1", "true", "yes", "on"}
RVC_CLEANUP_RESOURCE_TRACKERS = os.getenv("RVC_CLEANUP_RESOURCE_TRACKERS", "false").strip().lower() in {"1", "true", "yes", "on"}
RVC_UNLOAD_AFTER_REQUEST = os.getenv("RVC_UNLOAD_AFTER_REQUEST", "false").strip().lower() in {"1", "true", "yes", "on"}


class SpeechRequest(BaseModel):
    model: str = Field(default="frieren-rvc")
    input: str = Field(min_length=1)
    voice: str | None = None
    response_format: Literal["mp3", "wav", "flac", "opus"] = "mp3"
    speed: float = 1.0


class DualTextRequest(BaseModel):
    input: str = Field(min_length=1)


class DualTextResponse(BaseModel):
    display_text: str
    speech_text: str


class DualSpeechRequest(BaseModel):
    input: str = Field(min_length=1)
    voice: str | None = None
    response_format: Literal["mp3", "wav", "flac", "opus"] = "mp3"
    speed: float = 0.95


class DualSpeechResponse(BaseModel):
    display_text: str
    speech_text: str
    audio_base64: str
    audio_format: str
    media_type: str


def timing_header_value(duration_seconds: float) -> str:
    return f"{duration_seconds * 1000:.3f}"


def apply_timing_headers(response: Response, timings: dict[str, float], cache_hit: bool | None = None) -> None:
    response.headers["X-Frieren-Timing-Total-Ms"] = timing_header_value(timings["total"])

    if "dual_text" in timings:
        response.headers["X-Frieren-Timing-Dual-Text-Ms"] = timing_header_value(timings["dual_text"])
    if "llm" in timings:
        response.headers["X-Frieren-Timing-Llm-Ms"] = timing_header_value(timings["llm"])
    if "kokoro" in timings:
        response.headers["X-Frieren-Timing-Kokoro-Ms"] = timing_header_value(timings["kokoro"])
    if "rvc" in timings:
        response.headers["X-Frieren-Timing-Rvc-Ms"] = timing_header_value(timings["rvc"])
    if "encode" in timings:
        response.headers["X-Frieren-Timing-Encode-Ms"] = timing_header_value(timings["encode"])
    if cache_hit is not None:
        response.headers["X-Frieren-Dual-Cache-Hit"] = "1" if cache_hit else "0"


app = FastAPI(title="Frieren RVC Bridge")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

rvc_lock = threading.Lock()
rvc_engine = None
dual_text_cache_lock = threading.Lock()
dual_text_cache: "OrderedDict[str, tuple[float, DualTextResponse]]" = OrderedDict()
kokoro_runtime: dict[str, Any] | None = None
kokoro_model = None
kokoro_pipelines: dict[str, Any] = {}
kokoro_preloaded = False
kokoro_init_lock: asyncio.Lock | None = None
kokoro_request_lock: asyncio.Lock | None = None


def normalize_rvc_device_override(raw_override: str) -> str:
    if raw_override != "mps":
        return raw_override

    logger.warning(
        "FORCE_RVC_DEVICE=mps requested, but the current managed Frieren runtime is unstable on MPS. Using cpu instead."
    )
    return "cpu"


EFFECTIVE_RVC_DEVICE_OVERRIDE = normalize_rvc_device_override(RVC_DEVICE_OVERRIDE)


def build_dual_schema() -> dict:
    return {
        "name": "dual_text_response",
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["display_text", "speech_text"],
            "properties": {
                "display_text": {
                    "type": "string",
                    "minLength": 1,
                    "description": "给前端显示的繁体中文回复",
                },
                "speech_text": {
                    "type": "string",
                    "minLength": 1,
                    "description": "给日语语音合成使用的日文台词",
                },
            },
        },
        "strict": True,
    }


def get_cached_dual_text(user_input: str) -> DualTextResponse | None:
    now = time.time()
    with dual_text_cache_lock:
        cached = dual_text_cache.get(user_input)
        if not cached:
            return None

        expires_at, value = cached
        if expires_at < now:
            dual_text_cache.pop(user_input, None)
            return None

        dual_text_cache.move_to_end(user_input)
        return value


def set_cached_dual_text(user_input: str, value: DualTextResponse) -> None:
    if DUAL_LLM_CACHE_SIZE <= 0 or DUAL_LLM_CACHE_TTL_SECONDS <= 0:
        return

    expires_at = time.time() + DUAL_LLM_CACHE_TTL_SECONDS
    with dual_text_cache_lock:
        dual_text_cache[user_input] = (expires_at, value)
        dual_text_cache.move_to_end(user_input)
        while len(dual_text_cache) > DUAL_LLM_CACHE_SIZE:
            dual_text_cache.popitem(last=False)


def use_embedded_kokoro() -> bool:
    return KOKORO_SYNTH_MODE == "embedded"


def get_embedded_kokoro_device() -> str:
    if not KOKORO_USE_GPU:
        return "cpu"
    if KOKORO_DEVICE_TYPE in {"cuda", "mps"}:
        return KOKORO_DEVICE_TYPE
    return "cpu"


def ensure_embedded_kokoro_project() -> None:
    if not KOKORO_PROJECT_DIR.exists():
        raise RuntimeError(f"Missing Kokoro project directory: {KOKORO_PROJECT_DIR}")


def ensure_embedded_kokoro_env() -> None:
    ensure_embedded_kokoro_project()

    required_paths = {
        "Kokoro model": KOKORO_MODEL_PATH,
        "Kokoro config": KOKORO_CONFIG_PATH,
        "Kokoro voices": KOKORO_VOICES_DIR,
    }
    for label, path in required_paths.items():
        if not path.exists():
            raise RuntimeError(f"Missing {label}: {path}")


def load_embedded_kokoro_runtime() -> dict[str, Any]:
    global kokoro_runtime

    if kokoro_runtime is not None:
        return kokoro_runtime

    if not use_embedded_kokoro():
        raise RuntimeError("Embedded Kokoro runtime requested while KOKORO_SYNTH_MODE is disabled")

    ensure_embedded_kokoro_env()
    import torch
    from kokoro import KModel, KPipeline

    kokoro_runtime = {
        "KModel": KModel,
        "KPipeline": KPipeline,
        "device": get_embedded_kokoro_device(),
        "torch": torch,
    }
    return kokoro_runtime


def resolve_embedded_kokoro_voice_path(voice: str) -> Path:
    voice_path = Path(voice)
    if voice_path.is_absolute():
        resolved = voice_path
    else:
        resolved = KOKORO_VOICES_DIR / f"{voice}.pt"
    if not resolved.exists():
        raise HTTPException(status_code=400, detail=f"Unknown Kokoro voice: {voice}")
    return resolved


def get_embedded_kokoro_pipeline(lang_code: str):
    runtime = load_embedded_kokoro_runtime()
    if kokoro_model is None:
        raise RuntimeError("Embedded Kokoro model is not loaded")
    if lang_code not in kokoro_pipelines:
        kokoro_pipelines[lang_code] = runtime["KPipeline"](
            lang_code=lang_code,
            model=kokoro_model,
            device=runtime["device"],
        )
    return kokoro_pipelines[lang_code]


def unload_embedded_kokoro() -> None:
    global kokoro_model, kokoro_preloaded

    if kokoro_model is None:
        return

    runtime = load_embedded_kokoro_runtime()
    kokoro_pipelines.clear()
    kokoro_model = None
    kokoro_preloaded = False
    gc.collect()

    torch_mod = runtime["torch"]
    if torch_mod.cuda.is_available():
        torch_mod.cuda.empty_cache()
        torch_mod.cuda.synchronize()


async def ensure_embedded_kokoro_model(preload: bool = False):
    global kokoro_init_lock, kokoro_model, kokoro_preloaded

    runtime = load_embedded_kokoro_runtime()
    if kokoro_init_lock is None:
        kokoro_init_lock = asyncio.Lock()

    async with kokoro_init_lock:
        if kokoro_model is None:
            model = runtime["KModel"](
                config=str(KOKORO_CONFIG_PATH),
                model=str(KOKORO_MODEL_PATH),
            ).eval()
            if runtime["device"] == "cuda":
                model = model.cuda()
            elif runtime["device"] == "mps":
                model = model.to(runtime["torch"].device("mps"))
            else:
                model = model.cpu()
            kokoro_model = model
            logger.info(
                "Loaded embedded Kokoro model from %s on %s",
                KOKORO_MODEL_PATH,
                runtime["device"],
            )

        if preload and not kokoro_preloaded:
            get_embedded_kokoro_pipeline(KOKORO_DEFAULT_VOICE[:1].lower())
            kokoro_preloaded = True
            logger.info("Embedded Kokoro preload complete")

    return kokoro_model


def ensure_file(path: Path, url: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return
    with requests.get(url, stream=True, timeout=120) as response:
        response.raise_for_status()
        with path.open("wb") as output:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    output.write(chunk)


def ensure_rvc_env() -> None:
    RVC_WORKDIR.mkdir(parents=True, exist_ok=True)
    RVC_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    ensure_file(RVC_ASSETS_DIR / "hubert_base.pt", RVC_HUBERT_URL)
    ensure_file(RVC_ASSETS_DIR / "rmvpe.pt", RVC_RMVPE_URL)

    env_values = {
        "weight_root": str(RVC_MODEL_PATH.parent),
        "weight_uvr5_root": "",
        "index_root": str(RVC_INDEX_PATH.parent),
        "rmvpe_root": str(RVC_ASSETS_DIR),
        "hubert_path": str(RVC_HUBERT_PATH),
        "save_uvr_path": "",
        "TEMP": str(RVC_WORKDIR / "tmp"),
        "pretrained": "",
    }
    os.environ.update(env_values)

    env_path = RVC_WORKDIR / ".env"
    env_path.write_text(
        "\n".join(f"{key}={value}" for key, value in env_values.items()) + "\n",
        encoding="utf-8",
    )


def kokoro_voice(requested_voice: str | None) -> str:
    if not requested_voice or requested_voice in {"frieren", "default", "rvc_frieren"}:
        return KOKORO_DEFAULT_VOICE
    return requested_voice


def extract_dual_payload(response_json: dict) -> DualTextResponse:
    try:
        content = response_json["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="LLM response missing message content") from exc

    if not isinstance(content, str):
        raise HTTPException(status_code=502, detail="LLM response content is not text")

    try:
        payload = json.loads(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="LLM response is not valid JSON") from exc

    try:
        return DualTextResponse.model_validate(payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="LLM response missing required fields") from exc


def generate_dual_text_with_metrics(user_input: str) -> tuple[DualTextResponse, dict[str, float], bool]:
    total_started_at = time.perf_counter()

    if not DUAL_LLM_API_KEY:
        raise HTTPException(status_code=500, detail="Missing DUAL_LLM_API_KEY")

    cached = get_cached_dual_text(user_input)
    if cached is not None:
        return cached, {
            "llm": 0.0,
            "total": time.perf_counter() - total_started_at,
        }, True

    headers = {
        "Authorization": f"Bearer {DUAL_LLM_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": DUAL_LLM_MODEL,
        "messages": [
            {"role": "system", "content": DUAL_LLM_PROMPT},
            {"role": "user", "content": user_input},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": build_dual_schema(),
        },
    }

    llm_started_at = time.perf_counter()
    response = requests.post(
        f"{DUAL_LLM_BASE_URL}/chat/completions",
        headers=headers,
        json=payload,
        timeout=DUAL_LLM_TIMEOUT,
    )
    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "LLM request failed",
                "status_code": response.status_code,
                "body": response.text[:1000],
            },
        )

    result = extract_dual_payload(response.json())
    set_cached_dual_text(user_input, result)
    total_elapsed = time.perf_counter() - total_started_at
    llm_elapsed = time.perf_counter() - llm_started_at
    return result, {
        "llm": llm_elapsed,
        "total": total_elapsed,
    }, False


def generate_dual_text(user_input: str) -> DualTextResponse:
    result, _, _ = generate_dual_text_with_metrics(user_input)
    return result


def synthesize_base_wav_via_http(text: str, voice: str, speed: float, output_path: Path) -> None:
    response = requests.post(
        f"{KOKORO_BASE_URL}/audio/speech",
        json={
            "model": "kokoro",
            "input": text,
            "voice": voice,
            "response_format": "wav",
            "speed": speed,
        },
        timeout=KOKORO_REQUEST_TIMEOUT,
    )
    if response.status_code != 200 or not response.content:
        raise HTTPException(
            status_code=502,
            detail=f"Kokoro TTS failed: status={response.status_code} bytes={len(response.content)}",
        )
    output_path.write_bytes(response.content)


async def synthesize_base_wav_embedded(
    text: str,
    voice: str,
    speed: float,
    output_path: Path,
) -> None:
    global kokoro_request_lock

    await ensure_embedded_kokoro_model()
    if kokoro_request_lock is None:
        kokoro_request_lock = asyncio.Lock()

    voice_path = resolve_embedded_kokoro_voice_path(voice)
    lang_code = voice_path.stem[:1].lower()
    samples_written = 0

    try:
        async with kokoro_request_lock:
            pipeline = get_embedded_kokoro_pipeline(lang_code)
            with sf.SoundFile(
                str(output_path),
                mode="w",
                samplerate=24000,
                channels=1,
                format="WAV",
                subtype="PCM_16",
            ) as output_file:
                for result in pipeline(text, voice=str(voice_path), speed=speed):
                    audio = result.audio
                    if audio is None:
                        continue
                    if hasattr(audio, "numpy"):
                        audio = audio.numpy()
                    audio = np.asarray(audio)
                    if audio.size == 0:
                        continue
                    if audio.dtype != np.int16:
                        audio = np.clip(audio * 32767, -32768, 32767).astype(np.int16)
                    output_file.write(audio)
                    samples_written += len(audio)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Embedded Kokoro TTS failed: {exc}",
        ) from exc
    finally:
        if KOKORO_UNLOAD_AFTER_REQUEST:
            unload_embedded_kokoro()

    if samples_written <= 0 or not output_path.exists():
        raise HTTPException(status_code=500, detail="Embedded Kokoro TTS produced no audio")


async def synthesize_base_wav(text: str, voice: str, speed: float, output_path: Path) -> None:
    if use_embedded_kokoro():
        await synthesize_base_wav_embedded(text, voice, speed, output_path)
        return

    await asyncio.to_thread(synthesize_base_wav_via_http, text, voice, speed, output_path)


def initialize_rvc() -> None:
    global rvc_engine
    if rvc_engine is not None:
        return

    ensure_rvc_env()

    from rvc.modules.vc.modules import VC
    from rvc.modules.vc.utils import load_hubert

    engine = VC()
    apply_rvc_device_override(engine)
    engine.get_vc(str(RVC_MODEL_PATH))
    engine.hubert_model = load_hubert(engine.config, str(RVC_HUBERT_PATH))
    rvc_engine = engine


def resolve_rvc_device_override() -> str | None:
    if not EFFECTIVE_RVC_DEVICE_OVERRIDE or EFFECTIVE_RVC_DEVICE_OVERRIDE == "auto":
        return None
    return EFFECTIVE_RVC_DEVICE_OVERRIDE


def should_skip_rvc_startup_preload() -> bool:
    return RVC_DEVICE_OVERRIDE == "mps"


def should_force_subprocess_rvc() -> bool:
    return False


def get_rvc_device_layout(is_half: bool) -> tuple[int, int, int, int]:
    if is_half:
        return 3, 10, 60, 65
    return 1, 6, 38, 41


def probe_rvc_device_support(device: str) -> tuple[bool, str]:
    probe_code = """
import os
from rvc.modules.vc.modules import VC
from rvc.modules.vc.utils import load_hubert

device = os.environ["RVC_PROBE_DEVICE"]
model_path = os.environ["RVC_MODEL_PATH"]
hubert_path = os.environ["RVC_HUBERT_PATH"]

engine = VC()
engine.config.device = device
engine.config.instead = device
engine.config.is_half = False
engine.config.x_pad, engine.config.x_query, engine.config.x_center, engine.config.x_max = (1, 6, 38, 41)
engine.config.use_fp32_config()
engine.get_vc(model_path)
engine.hubert_model = load_hubert(engine.config, hubert_path)
print("ok")
"""

    probe_env = os.environ.copy()
    probe_env["RVC_PROBE_DEVICE"] = device
    result = subprocess.run(
        [sys.executable, "-c", probe_code],
        capture_output=True,
        text=True,
        check=False,
        env=probe_env,
        timeout=180,
    )

    if result.returncode == 0:
        return True, result.stdout.strip() or "ok"

    stderr = (result.stderr or "").strip()
    stdout = (result.stdout or "").strip()
    reason = stderr or stdout or f"probe exited with code {result.returncode}"
    return False, reason[-1000:]


def resolve_forced_rvc_device() -> tuple[str | None, bool]:
    override = resolve_rvc_device_override()
    if override is None:
        return None, False

    import torch

    if override == "cpu":
        return "cpu", False

    if override == "mps":
        if not hasattr(torch.backends, "mps") or not torch.backends.mps.is_available():
            logger.warning("FORCE_RVC_DEVICE=mps requested, but PyTorch MPS is unavailable. Falling back to cpu.")
            return "cpu", False

        logger.warning(
            "FORCE_RVC_DEVICE=mps requested, but the current managed Frieren runtime is unstable on MPS. Falling back to cpu."
        )
        return "cpu", False

    if override == "cuda" or override.startswith("cuda:"):
        if not torch.cuda.is_available():
            logger.warning("FORCE_RVC_DEVICE=%s requested, but CUDA is unavailable. Falling back to cpu.", override)
            return "cpu", False
        return ("cuda:0" if override == "cuda" else override), True

    raise RuntimeError(
        f"Unsupported FORCE_RVC_DEVICE={override!r}. Expected auto, cpu, mps, cuda, or cuda:N"
    )


def apply_rvc_device_override(engine: Any) -> None:
    device, is_half = resolve_forced_rvc_device()
    if device is None:
        return

    engine.config.device = device
    engine.config.instead = device
    engine.config.is_half = is_half
    engine.config.x_pad, engine.config.x_query, engine.config.x_center, engine.config.x_max = get_rvc_device_layout(is_half)

    if not is_half:
        engine.config.use_fp32_config()

    logger.info("Using forced RVC device override: %s (is_half=%s)", device, is_half)


def unload_rvc() -> None:
    global rvc_engine

    if rvc_engine is None:
        return

    try:
        if getattr(rvc_engine, "hubert_model", None) is not None:
            del rvc_engine.hubert_model
            rvc_engine.hubert_model = None

        if getattr(rvc_engine, "net_g", None) is not None:
            del rvc_engine.net_g
            rvc_engine.net_g = None

        if getattr(rvc_engine, "pipeline", None) is not None:
            del rvc_engine.pipeline
            rvc_engine.pipeline = None
    finally:
        rvc_engine = None
        cleanup_resource_trackers()
        schedule_resource_tracker_cleanup()


def cleanup_resource_trackers() -> None:
    if not RVC_CLEANUP_RESOURCE_TRACKERS:
        return

    current_pid = os.getpid()
    result = subprocess.run(
        ["ps", "-axo", "pid=,ppid=,command="],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return

    tracker_command_fragment = f"{Path(sys.executable).resolve()} -c from multiprocessing.resource_tracker import main;main("
    children_by_parent: dict[int, list[int]] = {}
    orphaned: list[int] = []
    for line in result.stdout.splitlines():
        if "from multiprocessing.resource_tracker import main;main(" not in line:
            continue
        parts = line.strip().split(None, 2)
        if len(parts) < 3:
            continue
        try:
            pid = int(parts[0])
            ppid = int(parts[1])
        except ValueError:
            continue
        command = parts[2]
        if tracker_command_fragment not in command:
            continue
        children_by_parent.setdefault(ppid, []).append(pid)
        if ppid == 1:
            orphaned.append(pid)

    descendants: list[int] = []
    stack = [current_pid]
    while stack:
        parent = stack.pop()
        for child in children_by_parent.get(parent, []):
            descendants.append(child)
            stack.append(child)

    for pid in reversed(descendants + orphaned):
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except PermissionError:
            logger.warning("Unable to terminate leaked resource_tracker pid=%s", pid)

    cleaned = len(set(descendants + orphaned))
    if cleaned:
        logger.info("Cleaned up %s leaked resource_tracker processes", cleaned)


def schedule_resource_tracker_cleanup(delay_seconds: float = 0.5) -> None:
    if not RVC_CLEANUP_RESOURCE_TRACKERS:
        return

    def _delayed_cleanup() -> None:
        time.sleep(delay_seconds)
        cleanup_resource_trackers()

    threading.Thread(target=_delayed_cleanup, daemon=True).start()


def run_rvc(input_wav: Path, output_wav: Path) -> None:
    if RVC_EXECUTION_MODE == "subprocess" or should_force_subprocess_rvc():
        worker_script = Path(__file__).with_name("rvc_worker.py")
        base_worker_env = os.environ.copy()
        base_worker_env["RVC_EXECUTION_MODE"] = "inprocess"

        def run_rvc_worker(device_override: str | None) -> subprocess.CompletedProcess[str]:
            worker_env = base_worker_env.copy()
            if device_override:
                worker_env["FORCE_RVC_DEVICE"] = device_override
            else:
                worker_env.pop("FORCE_RVC_DEVICE", None)

            return subprocess.run(
                [sys.executable, str(worker_script), str(input_wav), str(output_wav)],
                env=worker_env,
                capture_output=True,
                text=True,
                timeout=RVC_SUBPROCESS_TIMEOUT,
                check=False,
            )

        requested_override = resolve_rvc_device_override()
        attempted_device = requested_override
        result = run_rvc_worker(requested_override)

        if (result.returncode != 0 or not output_wav.exists()) and requested_override == "mps":
            logger.warning(
                "RVC subprocess failed on mps; retrying on cpu. returncode=%s stderr=%s",
                result.returncode,
                (result.stderr or "").strip()[-1000:],
            )
            output_wav.unlink(missing_ok=True)
            attempted_device = "cpu"
            result = run_rvc_worker("cpu")

        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail={
                    "message": "RVC subprocess failed",
                    "device": attempted_device or "auto",
                    "returncode": result.returncode,
                    "stdout": result.stdout[-1000:],
                    "stderr": result.stderr[-1000:],
                },
            )
        if not output_wav.exists():
            raise HTTPException(
                status_code=500,
                detail=f"RVC subprocess finished without output audio on {attempted_device or 'auto'}",
            )
        cleanup_resource_trackers()
        schedule_resource_tracker_cleanup()
        return

    initialize_rvc()
    cleanup_resource_trackers()

    with rvc_lock:
        tgt_sr, audio_opt, _, info = rvc_engine.vc_single(
            0,
            input_wav,
            f0_method=RVC_F0_METHOD,
            index_file=str(RVC_INDEX_PATH) if RVC_INDEX_RATE > 0 and RVC_INDEX_PATH.exists() else "",
            index_rate=RVC_INDEX_RATE,
            filter_radius=RVC_FILTER_RADIUS,
            rms_mix_rate=RVC_RMS_MIX_RATE,
            protect=RVC_PROTECT,
            hubert_path=str(RVC_HUBERT_PATH),
        )
    cleanup_resource_trackers()
    schedule_resource_tracker_cleanup()

    if info or audio_opt is None or tgt_sr is None:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "RVC inference failed",
                "info": info,
            },
        )

    sf.write(output_wav, audio_opt, tgt_sr)


async def warmup_rvc() -> None:
    try:
        with tempfile.TemporaryDirectory(prefix="frieren-rvc-warmup-") as tmp_dir:
            tmp_path = Path(tmp_dir)
            base_wav = tmp_path / "warmup-base.wav"
            converted_wav = tmp_path / "warmup-converted.wav"
            await synthesize_base_wav(RVC_WARMUP_TEXT, KOKORO_DEFAULT_VOICE, 1.0, base_wav)
            await asyncio.to_thread(run_rvc, base_wav, converted_wav)
        logger.info("RVC warmup complete")
    except Exception:
        logger.exception("RVC warmup failed")


def encode_audio(input_wav: Path, response_format: str) -> tuple[bytes, str]:
    if response_format == "wav":
        return input_wav.read_bytes(), "audio/wav"

    audio = AudioSegment.from_wav(input_wav)
    output = io.BytesIO()
    export_format = "ogg" if response_format == "opus" else response_format
    parameters = ["-c:a", "libopus"] if response_format == "opus" else None
    audio.export(output, format=export_format, parameters=parameters)
    media_type = {
        "mp3": "audio/mpeg",
        "flac": "audio/flac",
        "opus": "audio/ogg",
    }[response_format]
    return output.getvalue(), media_type


@app.on_event("startup")
async def startup() -> None:
    if KOKORO_SYNTH_MODE not in {"http", "embedded"}:
        raise RuntimeError(f"Unsupported KOKORO_SYNTH_MODE: {KOKORO_SYNTH_MODE}")

    logger.warning(
        "Frieren startup config: kokoro_preload=%s, kokoro_unload_after_request=%s, rvc_preload=%s, rvc_warmup=%s, rvc_device_override=%s",
        KOKORO_PRELOAD_MODEL,
        KOKORO_UNLOAD_AFTER_REQUEST,
        RVC_PRELOAD_MODEL,
        RVC_ENABLE_WARMUP,
        f"{RVC_DEVICE_OVERRIDE or 'auto'} -> {EFFECTIVE_RVC_DEVICE_OVERRIDE or 'auto'}",
    )
    ensure_rvc_env()
    if not RVC_MODEL_PATH.exists():
        raise RuntimeError(f"Missing RVC model: {RVC_MODEL_PATH}")
    if not RVC_INDEX_PATH.exists():
        raise RuntimeError(f"Missing RVC index: {RVC_INDEX_PATH}")
    if use_embedded_kokoro():
        ensure_embedded_kokoro_env()
        if KOKORO_PRELOAD_MODEL:
            await ensure_embedded_kokoro_model(preload=True)
    skip_rvc_startup_preload = should_skip_rvc_startup_preload()
    if skip_rvc_startup_preload:
        logger.warning(
            "Skipping RVC preload and warmup during startup because FORCE_RVC_DEVICE=%s is experimental on this runtime",
            RVC_DEVICE_OVERRIDE,
        )
    if RVC_EXECUTION_MODE != "subprocess" and not skip_rvc_startup_preload and (RVC_PRELOAD_MODEL or RVC_ENABLE_WARMUP):
        initialize_rvc()
    if RVC_EXECUTION_MODE != "subprocess" and not skip_rvc_startup_preload and RVC_ENABLE_WARMUP:
        await warmup_rvc()
    cleanup_resource_trackers()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/models")
def list_models() -> dict[str, list[dict[str, str]]]:
    return {"data": [{"id": "frieren-rvc", "object": "model"}]}


@app.get("/v1/audio/voices")
def list_voices() -> dict[str, list[str]]:
    return {"voices": ["frieren", KOKORO_DEFAULT_VOICE]}


@app.post("/v1/dual/text", response_model=DualTextResponse)
def create_dual_text(request: DualTextRequest, response: Response) -> DualTextResponse:
    result, timings, cache_hit = generate_dual_text_with_metrics(request.input)
    apply_timing_headers(response, timings, cache_hit)
    return result


@app.post("/v1/dual/speech", response_model=DualSpeechResponse)
async def create_dual_speech(request: DualSpeechRequest, response: Response) -> DualSpeechResponse:
    total_started_at = time.perf_counter()
    dual_text, dual_text_timings, cache_hit = await asyncio.to_thread(generate_dual_text_with_metrics, request.input)
    ensure_rvc_env()
    voice = kokoro_voice(request.voice)

    try:
        with tempfile.TemporaryDirectory(prefix="frieren-dual-") as tmp_dir:
            tmp_path = Path(tmp_dir)
            base_wav = tmp_path / "base.wav"
            converted_wav = tmp_path / "converted.wav"

            kokoro_started_at = time.perf_counter()
            await synthesize_base_wav(dual_text.speech_text, voice, request.speed, base_wav)
            kokoro_elapsed = time.perf_counter() - kokoro_started_at
            rvc_started_at = time.perf_counter()
            await asyncio.to_thread(run_rvc, base_wav, converted_wav)
            rvc_elapsed = time.perf_counter() - rvc_started_at
            encode_started_at = time.perf_counter()
            audio_bytes, media_type = await asyncio.to_thread(
                encode_audio, converted_wav, request.response_format
            )
            encode_elapsed = time.perf_counter() - encode_started_at
    finally:
        if RVC_UNLOAD_AFTER_REQUEST:
            unload_rvc()

    apply_timing_headers(response, {
        "dual_text": dual_text_timings["total"],
        "llm": dual_text_timings["llm"],
        "kokoro": kokoro_elapsed,
        "rvc": rvc_elapsed,
        "encode": encode_elapsed,
        "total": time.perf_counter() - total_started_at,
    }, cache_hit)
    return DualSpeechResponse(
        display_text=dual_text.display_text,
        speech_text=dual_text.speech_text,
        audio_base64=base64.b64encode(audio_bytes).decode("ascii"),
        audio_format=request.response_format,
        media_type=media_type,
    )


@app.post("/v1/audio/speech")
async def create_speech(request: SpeechRequest) -> Response:
    if request.model not in {"frieren-rvc", "kokoro-rvc-frieren"}:
        raise HTTPException(status_code=400, detail=f"Unsupported model: {request.model}")

    total_started_at = time.perf_counter()
    ensure_rvc_env()
    voice = kokoro_voice(request.voice)

    try:
        with tempfile.TemporaryDirectory(prefix="frieren-rvc-") as tmp_dir:
            tmp_path = Path(tmp_dir)
            base_wav = tmp_path / "base.wav"
            converted_wav = tmp_path / "converted.wav"

            kokoro_started_at = time.perf_counter()
            await synthesize_base_wav(request.input, voice, request.speed, base_wav)
            kokoro_elapsed = time.perf_counter() - kokoro_started_at
            rvc_started_at = time.perf_counter()
            await asyncio.to_thread(run_rvc, base_wav, converted_wav)
            rvc_elapsed = time.perf_counter() - rvc_started_at
            encode_started_at = time.perf_counter()
            audio_bytes, media_type = await asyncio.to_thread(
                encode_audio, converted_wav, request.response_format
            )
            encode_elapsed = time.perf_counter() - encode_started_at
            response = Response(content=audio_bytes, media_type=media_type)
            apply_timing_headers(response, {
                "kokoro": kokoro_elapsed,
                "rvc": rvc_elapsed,
                "encode": encode_elapsed,
                "total": time.perf_counter() - total_started_at,
            })
            return response
    finally:
        if RVC_UNLOAD_AFTER_REQUEST:
            unload_rvc()
