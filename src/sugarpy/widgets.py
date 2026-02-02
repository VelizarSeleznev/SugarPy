"""Jupyter widgets for students."""

from __future__ import annotations

import textwrap
from typing import Callable

import ipywidgets as widgets
from IPython import get_ipython
from IPython.display import display, Markdown

from .chem import balance_equation, FormulaError


def function_builder() -> widgets.VBox:
    """Return a widget to create a simple Python function."""
    title = widgets.HTML("<h3>Function Builder</h3>")
    name = widgets.Text(description="Name:", value="find_hypotenuse")
    args = widgets.Text(description="Args:", value="a, b")
    expr = widgets.Textarea(
        description="Expr:",
        value="(a**2 + b**2) ** 0.5",
        layout=widgets.Layout(width="100%"),
    )
    btn = widgets.Button(description="Create Function", button_style="success")
    output = widgets.Output()

    def _on_click(_):
        output.clear_output()
        func_name = name.value.strip()
        func_args = args.value.strip()
        func_expr = expr.value.strip()
        if not func_name or not func_args or not func_expr:
            with output:
                display(Markdown("**Fill all fields first.**"))
            return
        code = textwrap.dedent(
            f"""
            def {func_name}({func_args}):
                return {func_expr}
            """
        ).strip()
        with output:
            display(Markdown("**Created function:**"))
            display(Markdown(f"```python\n{code}\n```"))
        _exec(code)

    btn.on_click(_on_click)
    return widgets.VBox([title, name, args, expr, btn, output])


def balance_widget() -> widgets.VBox:
    """Return a widget that balances chemistry reactions."""
    title = widgets.HTML("<h3>Balance Reaction</h3>")
    inp = widgets.Text(
        description="Reaction:",
        value="H2 + O2 -> H2O",
        layout=widgets.Layout(width="100%"),
    )
    btn = widgets.Button(description="Balance", button_style="primary")
    output = widgets.Output()

    def _on_click(_):
        output.clear_output()
        try:
            balanced = balance_equation(inp.value)
        except FormulaError as exc:
            with output:
                display(Markdown(f"**Error:** {exc}"))
            return
        with output:
            display(Markdown("**Balanced:**"))
            display(Markdown(f"`{balanced}`"))

    btn.on_click(_on_click)
    return widgets.VBox([title, inp, btn, output])


def _exec(code: str) -> None:
    """Execute code in the notebook's global scope."""
    ip = get_ipython()  # type: ignore[name-defined]
    if ip is None:
        return
    ip.run_cell(code)
