#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_ROOT="${AIRI_FRIEREN_SIDECAR_RUNTIME_DIR:-$SCRIPT_DIR/..}"
VENV_DIR="${VENV_DIR:-$RUNTIME_ROOT/venv}"
ENV_FILE="${ENV_FILE:-$RUNTIME_ROOT/sidecar.env}"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required before the AIRI-managed Frieren runtime can start." >&2
  exit 1
fi

FFMPEG_PREFIX="${FFMPEG_PREFIX:-$(brew --prefix ffmpeg@6)}"

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  echo "Managed runtime is missing its Python virtual environment: $VENV_DIR" >&2
  echo "Please run bootstrap.sh before starting the AIRI-managed Frieren sidecar." >&2
  exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

export PKG_CONFIG_PATH="$FFMPEG_PREFIX/lib/pkgconfig"
export CPPFLAGS="-I$FFMPEG_PREFIX/include"
export LDFLAGS="-L$FFMPEG_PREFIX/lib"
export DYLD_FALLBACK_LIBRARY_PATH="$FFMPEG_PREFIX/lib:/opt/homebrew/opt/zlib/lib:/usr/lib${DYLD_FALLBACK_LIBRARY_PATH:+:$DYLD_FALLBACK_LIBRARY_PATH}"

export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8010}"
export KOKORO_SYNTH_MODE="${KOKORO_SYNTH_MODE:-embedded}"
export KOKORO_BASE_URL="${KOKORO_BASE_URL:-http://127.0.0.1:8880/v1}"
export KOKORO_DEFAULT_VOICE="${KOKORO_DEFAULT_VOICE:-jf_alpha}"
export KOKORO_PROJECT_DIR="${KOKORO_PROJECT_DIR:-}"
export DUAL_LLM_BASE_URL="${DUAL_LLM_BASE_URL:-https://api.openai.com/v1}"
export DUAL_LLM_MODEL="${DUAL_LLM_MODEL:-gpt-4.1-mini}"
export DUAL_LLM_TIMEOUT="${DUAL_LLM_TIMEOUT:-120}"
export DUAL_LLM_CACHE_SIZE="${DUAL_LLM_CACHE_SIZE:-256}"
export DUAL_LLM_CACHE_TTL_SECONDS="${DUAL_LLM_CACHE_TTL_SECONDS:-3600}"
export FORCE_RVC_DEVICE="${FORCE_RVC_DEVICE:-cpu}"
export KMP_DUPLICATE_LIB_OK="${KMP_DUPLICATE_LIB_OK:-TRUE}"
export RVC_F0_METHOD="${RVC_F0_METHOD:-pm}"
export RVC_EXECUTION_MODE="${RVC_EXECUTION_MODE:-inprocess}"
export RVC_SUBPROCESS_TIMEOUT="${RVC_SUBPROCESS_TIMEOUT:-300}"
export RVC_INDEX_RATE="${RVC_INDEX_RATE:-0}"
export RVC_PRELOAD_MODEL="${RVC_PRELOAD_MODEL:-true}"
export RVC_ENABLE_WARMUP="${RVC_ENABLE_WARMUP:-true}"
export RVC_CLEANUP_RESOURCE_TRACKERS="${RVC_CLEANUP_RESOURCE_TRACKERS:-true}"
export RVC_UNLOAD_AFTER_REQUEST="${RVC_UNLOAD_AFTER_REQUEST:-false}"
export RVC_WORKDIR="${RVC_WORKDIR:-$RUNTIME_ROOT/workdir}"
export RVC_ASSETS_DIR="${RVC_ASSETS_DIR:-$RUNTIME_ROOT/assets}"
export RVC_MODEL_PATH="${RVC_MODEL_PATH:-}"
export RVC_INDEX_PATH="${RVC_INDEX_PATH:-}"
export RVC_WARMUP_TEXT="${RVC_WARMUP_TEXT:-こんにちは。}"

export PYTHONPATH="$SCRIPT_DIR${PYTHONPATH:+:$PYTHONPATH}"

if [[ "$KOKORO_SYNTH_MODE" == "embedded" ]]; then
  if [[ -z "$KOKORO_PROJECT_DIR" ]]; then
    echo "KOKORO_PROJECT_DIR is required when AIRI uses the bundled Frieren runtime in embedded mode." >&2
    exit 1
  fi

  if [[ ! -d "$KOKORO_PROJECT_DIR" ]]; then
    echo "Missing Kokoro project directory: $KOKORO_PROJECT_DIR" >&2
    exit 1
  fi

  export PYTHONPATH="$KOKORO_PROJECT_DIR:$KOKORO_PROJECT_DIR/api:$PYTHONPATH"
  export USE_GPU="${USE_GPU:-false}"
  export DEVICE_TYPE="${DEVICE_TYPE:-cpu}"
  export MODEL_DIR="${MODEL_DIR:-$KOKORO_PROJECT_DIR/api/src/models}"
  export VOICES_DIR="${VOICES_DIR:-$KOKORO_PROJECT_DIR/api/src/voices/v1_0}"
  export PRELOAD_MODEL_ON_STARTUP="${PRELOAD_MODEL_ON_STARTUP:-true}"
  export ENABLE_STARTUP_WARMUP="${ENABLE_STARTUP_WARMUP:-true}"
  export ENABLE_WEB_PLAYER="${ENABLE_WEB_PLAYER:-false}"
  export UNLOAD_MODEL_AFTER_REQUEST="${UNLOAD_MODEL_AFTER_REQUEST:-false}"
fi

if [[ -z "$RVC_MODEL_PATH" ]]; then
  echo "RVC_MODEL_PATH is required before the AIRI-managed Frieren sidecar can start." >&2
  exit 1
fi

if [[ -z "$RVC_INDEX_PATH" ]]; then
  echo "RVC_INDEX_PATH is required before the AIRI-managed Frieren sidecar can start." >&2
  exit 1
fi

if [[ ! -f "$RVC_MODEL_PATH" ]]; then
  echo "Missing RVC model: $RVC_MODEL_PATH" >&2
  exit 1
fi

if [[ ! -f "$RVC_INDEX_PATH" ]]; then
  echo "Missing RVC index: $RVC_INDEX_PATH" >&2
  exit 1
fi

mkdir -p "$RVC_WORKDIR" "$RVC_ASSETS_DIR"

cd "$SCRIPT_DIR"
exec "$VENV_DIR/bin/python" -m uvicorn app:app --host "$HOST" --port "$PORT"
