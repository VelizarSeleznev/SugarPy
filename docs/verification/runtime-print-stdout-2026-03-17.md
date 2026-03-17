# Runtime Print Stdout Verification

- Change class: runtime-critical notebook code-cell output fix
- Impacted runtime or execution paths:
  - `src/sugarpy/server_extension.py`
- Verification mapping:
  - `src/sugarpy/server_extension.py` -> `tests/backend/unit/test_server_extension.py`
- Regression tests added:
  - `test_execute_notebook_request_merges_stdout_into_visible_mime_output`
- Browser verification:
  - Local Chromium validation against `http://localhost:5173` with a clean notebook and a code cell containing `print("hello")`
  - Result: visible output text was `hello`, no trailing `None`, no page errors, no console errors
- Recovery paths covered:
  - Trailing top-level `print(...)` still avoids emitting its `None` return value
  - Non-`print(...)` trailing expressions still render through the existing last-expression output path
