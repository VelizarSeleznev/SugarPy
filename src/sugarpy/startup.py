"""IPython startup helper to preload SugarPy and user functions."""

from sugarpy.user_library import load_user_functions

try:
    import math  # noqa: F401
    load_user_functions()
except Exception:
    # Fail silently so notebooks still start.
    pass
