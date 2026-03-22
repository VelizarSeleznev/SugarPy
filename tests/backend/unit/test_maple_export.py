import json
import xml.etree.ElementTree as ET
from pathlib import Path

from sugarpy.maple_export.models import MapleInputBlock, SectionBlock, TextBlock, TitleBlock, WarningBlock
from sugarpy.maple_export.render_mw import render_maple_worksheet_xml
from sugarpy.maple_export.translate import translate_notebook_to_maple_ir
from sugarpy.server_extension import export_maple_worksheet_payload


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "maple_export"


def _load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def test_translate_markdown_and_supported_math_fixture():
    worksheet = translate_notebook_to_maple_ir(_load_fixture("basic_notebook.json"))

    assert worksheet.title == "Fixture Notebook"
    assert worksheet.blocks == [
        TitleBlock(text="Algebra"),
        SectionBlock(text="Quadratics"),
        TextBlock(text="Solve the equation with Maple."),
        MapleInputBlock(code="solve(x^2 = 2, x);"),
    ]


def test_translate_mixed_fixture_degrades_unsupported_cells():
    worksheet = translate_notebook_to_maple_ir(_load_fixture("mixed_notebook.json"))

    assert worksheet.blocks[0] == SectionBlock(text="Overview")
    assert worksheet.blocks[1] == TextBlock(text="This fixture includes unsupported cells.")
    assert worksheet.blocks[2] == WarningBlock(text="Unsupported SugarPy code cell exported as plain text.")
    assert worksheet.blocks[3] == TextBlock(text="value = 2 + 2")
    assert worksheet.blocks[4] == WarningBlock(text="Unsupported SugarPy stoich cell exported as plain text.")
    assert worksheet.blocks[5] == TextBlock(text="2H2 + O2 -> 2H2O")


def test_translate_unsafe_math_fixture_falls_back_to_warning_and_text():
    worksheet = translate_notebook_to_maple_ir(_load_fixture("unsafe_math_notebook.json"))

    assert worksheet.blocks == [
        WarningBlock(text="Math cell kept as text because Maple export does not support `render_decimal(` in MVP."),
        TextBlock(text="render_decimal(solve(x^2 = 2, x))"),
    ]


def test_translate_assignment_fixture_supports_only_simple_assignments():
    worksheet = translate_notebook_to_maple_ir(_load_fixture("assignment_notebook.json"))

    assert worksheet.blocks == [
        MapleInputBlock(code="a := 5;"),
        MapleInputBlock(code="f(x) := x^2+1;"),
        WarningBlock(
            text="Math cell kept as text because Maple export supports only simple `name := expr` and `f(x) := expr` assignments in MVP."
        ),
        TextBlock(text="a, b := solve(x^2 = 2, x)"),
    ]


def test_translate_math_normalizes_implicit_multiplication_and_power_for_maple_export():
    worksheet = translate_notebook_to_maple_ir(
        {
            "name": "Mechanics",
            "cells": [
                {"type": "math", "source": "g := 9.81"},
                {"type": "math", "source": "h := 5"},
                {"type": "math", "source": "v := sqrt(2g*h)"},
                {"type": "math", "source": "katet_2 := sqrt(hypotenusen^2-katet_1^2)"},
                {"type": "math", "source": "v = sqrt(2g*h)"},
            ],
        }
    )

    assert worksheet.blocks == [
        MapleInputBlock(code="g := 9.81;"),
        MapleInputBlock(code="h := 5;"),
        MapleInputBlock(code="v := sqrt(2*g*h);"),
        MapleInputBlock(code="katet_2 := sqrt(hypotenusen^2-katet_1^2);"),
        MapleInputBlock(code="v = sqrt(2*g*h);"),
    ]


def test_render_maple_worksheet_xml_matches_golden_fixture():
    worksheet = translate_notebook_to_maple_ir(_load_fixture("basic_notebook.json"))

    xml_text = render_maple_worksheet_xml(worksheet).decode("utf-8")

    assert xml_text.strip() == (FIXTURES / "basic_expected.mw").read_text().strip()


def test_render_maple_worksheet_xml_is_well_formed():
    worksheet = translate_notebook_to_maple_ir(_load_fixture("mixed_notebook.json"))

    xml_bytes = render_maple_worksheet_xml(worksheet)
    root = ET.fromstring(xml_bytes)

    assert root.tag.endswith("Worksheet")
    groups = [child for child in root if child.tag.endswith("Group")]
    assert len(groups) == 7


def test_export_maple_worksheet_payload_returns_filename_and_xml_bytes():
    filename, xml_bytes = export_maple_worksheet_payload(_load_fixture("basic_notebook.json"))

    assert filename == "Fixture-Notebook.mw"
    root = ET.fromstring(xml_bytes)
    assert root.tag.endswith("Worksheet")
