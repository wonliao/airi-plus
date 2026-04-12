#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

import soundfile as sf

from app import (
    RVC_FILTER_RADIUS,
    RVC_HUBERT_PATH,
    RVC_INDEX_PATH,
    RVC_INDEX_RATE,
    RVC_PROTECT,
    RVC_RMS_MIX_RATE,
    RVC_F0_METHOD,
    ensure_rvc_env,
    initialize_rvc,
)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: rvc_worker.py <input_wav> <output_wav>", file=sys.stderr)
        return 2

    input_wav = Path(sys.argv[1]).resolve()
    output_wav = Path(sys.argv[2]).resolve()
    output_wav.parent.mkdir(parents=True, exist_ok=True)

    ensure_rvc_env()
    initialize_rvc()

    from app import rvc_engine  # Re-read global after initialization.

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

    if info or audio_opt is None or tgt_sr is None:
        print(info or "RVC inference returned no audio", file=sys.stderr)
        return 1

    sf.write(output_wav, audio_opt, tgt_sr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
