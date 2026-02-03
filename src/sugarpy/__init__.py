"""Student-friendly Jupyter helpers."""

from .chem import balance_equation
from .library import load_catalog
from .stoichiometry import render_stoichiometry
from .user_library import append_function, load_user_functions
from .widgets import function_builder, balance_widget

__all__ = [
    "balance_equation",
    "function_builder",
    "balance_widget",
    "load_catalog",
    "render_stoichiometry",
    "append_function",
    "load_user_functions",
]
