#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_ROOT="${AIRI_FRIEREN_SIDECAR_RUNTIME_DIR:-$SCRIPT_DIR/..}"
VENV_DIR="${VENV_DIR:-$RUNTIME_ROOT/venv}"
ENV_FILE="${ENV_FILE:-$RUNTIME_ROOT/sidecar.env}"
PYTHON_BIN="${PYTHON_BIN:-3.10}"
KOKORO_PROJECT_DIR="${KOKORO_PROJECT_DIR:-}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

KOKORO_PROJECT_DIR="${KOKORO_PROJECT_DIR:-}"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required before the AIRI-managed Frieren runtime can be bootstrapped." >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required before the AIRI-managed Frieren runtime can be bootstrapped." >&2
  exit 1
fi

echo "Installing AIRI-managed Frieren build dependencies..."
brew install pkg-config cmake libsndfile ffmpeg@6

FFMPEG_PREFIX="${FFMPEG_PREFIX:-$(brew --prefix ffmpeg@6)}"

echo "Creating Python virtual environment: $VENV_DIR"
rm -rf "$VENV_DIR"
uv venv --clear --python "$PYTHON_BIN" "$VENV_DIR"
"$VENV_DIR/bin/python" -m ensurepip --upgrade

export PKG_CONFIG_PATH="$FFMPEG_PREFIX/lib/pkgconfig"
export CPPFLAGS="-I$FFMPEG_PREFIX/include"
export LDFLAGS="-L$FFMPEG_PREFIX/lib"
export DYLD_FALLBACK_LIBRARY_PATH="$FFMPEG_PREFIX/lib:/opt/homebrew/opt/zlib/lib:/usr/lib${DYLD_FALLBACK_LIBRARY_PATH:+:$DYLD_FALLBACK_LIBRARY_PATH}"

echo "Installing core runtime dependencies..."
"$VENV_DIR/bin/python" -m pip install \
  fastapi \
  uvicorn \
  requests \
  pydub \
  python-dotenv \
  python-multipart==0.0.6 \
  soundfile==0.12.1 \
  faiss-cpu==1.13.0

echo "Installing RVC dependencies..."
"$VENV_DIR/bin/python" -m pip install \
  'numpy<1.27' \
  scipy \
  librosa==0.10.2.post1 \
  llvmlite==0.42.0 \
  numba==0.59.0rc1 \
  tensorboardx

echo "Installing fairseq and av..."
"$VENV_DIR/bin/python" -m pip install fairseq==0.12.2
"$VENV_DIR/bin/python" -m pip install av==11.0.0

echo "Installing local F0 extraction dependencies..."
"$VENV_DIR/bin/python" -m pip install \
  praat-parselmouth \
  pyworld \
  torchcrepe==0.0.22

if [[ -n "$KOKORO_PROJECT_DIR" && -d "$KOKORO_PROJECT_DIR" ]]; then
  echo "Installing embedded Kokoro dependencies..."
  "$VENV_DIR/bin/python" -m pip install \
    pydantic-settings==2.7.0 \
    aiofiles==23.2.1 \
    loguru==0.7.3 \
    regex==2024.11.6 \
    tiktoken==0.8.0 \
    munch==4.0.0 \
    kokoro==0.9.4 \
    'misaki[en,ja,ko,zh]==0.9.4' \
    espeakng-loader==0.2.4 \
    spacy==3.8.5 \
    'inflect>=7.5.0' \
    'phonemizer-fork>=3.3.2' \
    'text2num>=2.5.1'

  echo "Preparing UniDic for embedded Kokoro..."
  BRIDGE_UNIDIC_DIR="$("$VENV_DIR/bin/python" - <<'PY'
import unidic

print(unidic.DICDIR)
PY
)"
  BRIDGE_MECABRC="$BRIDGE_UNIDIC_DIR/mecabrc"

  if [[ ! -f "$BRIDGE_MECABRC" ]]; then
    KOKORO_VENV_PYTHON="$KOKORO_PROJECT_DIR/.venv-local/bin/python"
    KOKORO_UNIDIC_DIR=""

    if [[ -x "$KOKORO_VENV_PYTHON" ]]; then
      KOKORO_UNIDIC_DIR="$("$KOKORO_VENV_PYTHON" - <<'PY'
from pathlib import Path

try:
    import unidic

    dicdir = Path(unidic.DICDIR)
    if (dicdir / "mecabrc").exists():
        print(dicdir)
except Exception:
    pass
PY
)"
    fi

    if [[ -n "$KOKORO_UNIDIC_DIR" ]]; then
      rm -rf "$BRIDGE_UNIDIC_DIR"
      mkdir -p "$(dirname "$BRIDGE_UNIDIC_DIR")"
      ln -s "$KOKORO_UNIDIC_DIR" "$BRIDGE_UNIDIC_DIR"
      echo "Reused UniDic from Kokoro virtual environment: $KOKORO_UNIDIC_DIR"
    else
      "$VENV_DIR/bin/python" -m unidic download
    fi
  fi
else
  echo "Skipping embedded Kokoro dependency install because KOKORO_PROJECT_DIR is not configured."
fi

echo "Installing rvc..."
"$VENV_DIR/bin/python" -m pip install --no-deps rvc==0.3.5

echo "Validating critical Python imports..."
PYTHONPATH="$SCRIPT_DIR${PYTHONPATH:+:$PYTHONPATH}" "$VENV_DIR/bin/python" -u - <<'PY'
import av
import faiss
import fairseq
import fastapi
import pydub
import rvc
import soundfile

print("ok av")
print("ok faiss")
print("ok fairseq")
print("ok fastapi")
print("ok pydub")
print("ok rvc")
print("ok soundfile")
PY

PYTHONPATH="$SCRIPT_DIR" "$VENV_DIR/bin/python" -u - <<'PY'
import app

print("ok app import")
PY

if [[ -n "$KOKORO_PROJECT_DIR" && -d "$KOKORO_PROJECT_DIR" ]]; then
  PYTHONPATH="$SCRIPT_DIR:$KOKORO_PROJECT_DIR:$KOKORO_PROJECT_DIR/api" "$VENV_DIR/bin/python" -u - <<'PY'
from api.src.services.tts_service import TTSService

print("ok embedded kokoro import")
print(TTSService.__name__)
PY
fi

cat <<EOF

AIRI-managed Frieren runtime is ready.

Virtual environment:
  $VENV_DIR

Start the sidecar with:
  "$SCRIPT_DIR/run-managed.sh"

EOF
