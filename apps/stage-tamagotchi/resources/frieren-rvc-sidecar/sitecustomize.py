import os
import sys

try:
    # `multiprocessing.resource_tracker` is launched via `python -c ...`.
    # Skipping our heavy bridge bootstrap in that subprocess prevents recursive
    # tracker spawning and keeps helper processes lightweight.
    if sys.argv and sys.argv[0] == "-c":
        raise SystemExit

    rvc_execution_mode = os.getenv("RVC_EXECUTION_MODE", "inprocess").strip().lower() or "inprocess"
    if rvc_execution_mode == "subprocess":
        raise SystemExit

    force_rvc_device = os.getenv("FORCE_RVC_DEVICE", "").strip().lower()

    if force_rvc_device == "cpu":
        import torch.backends.mps

        # Force the upstream RVC config singleton to skip automatic MPS selection on macOS.
        torch.backends.mps.is_available = lambda: False

    import faiss
    import torch.serialization
    from fairseq.data.dictionary import Dictionary

    torch.serialization.add_safe_globals([Dictionary])

    _original_read_index = faiss.read_index
    _index_cache = {}

    def _cached_read_index(path, *args):
        normalized = os.fspath(path)
        cache_key = (normalized, args)
        if cache_key not in _index_cache:
            _index_cache[cache_key] = _original_read_index(normalized, *args)
        return _index_cache[cache_key]

    faiss.read_index = _cached_read_index
except BaseException:
    pass
