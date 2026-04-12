import importlib.machinery
import importlib.util
import sys
from pathlib import Path


def _load_real_module():
    current_dir = str(Path(__file__).resolve().parent)
    search_paths = [path for path in sys.path if path and path != current_dir]
    spec = importlib.machinery.PathFinder.find_spec(__name__, search_paths)
    if spec is None or spec.loader is None:
        raise RuntimeError(
            "pyworld is stubbed in this image. Install pyworld or use rmvpe instead of dio/harvest-based F0 extraction."
        )

    module = importlib.util.module_from_spec(spec)
    sys.modules[__name__] = module
    spec.loader.exec_module(module)
    return module


_REAL_MODULE = _load_real_module()


def __getattr__(name: str):
    return getattr(_REAL_MODULE, name)
