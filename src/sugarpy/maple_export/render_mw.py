from __future__ import annotations

import xml.etree.ElementTree as ET

from .models import MapleInputBlock, MapleWorksheet, SectionBlock, TextBlock, TitleBlock, WarningBlock


def render_maple_worksheet_xml(worksheet: MapleWorksheet) -> bytes:
    root = ET.Element(
        "Worksheet",
        {
            "xmlns": "http://www.maplesoft.com/worksheet",
            "source": "SugarPy",
            "version": "1.0",
        },
    )
    title = worksheet.title.strip()
    if title:
        root.append(_make_group("Text", title, block_kind="worksheet-title"))
    for block in worksheet.blocks:
        if isinstance(block, TitleBlock):
            root.append(_make_group("Title", block.text, block_kind="title"))
        elif isinstance(block, SectionBlock):
            root.append(_make_group("Section", block.text, block_kind="section"))
        elif isinstance(block, TextBlock):
            root.append(_make_group("Text", block.text, block_kind="text"))
        elif isinstance(block, WarningBlock):
            root.append(_make_group("Text", f"Warning: {block.text}", block_kind="warning"))
        elif isinstance(block, MapleInputBlock):
            root.append(_make_group("Maple Input", block.code, prompt="> ", block_kind="maple-input"))
    tree = ET.ElementTree(root)
    if hasattr(ET, "indent"):
        ET.indent(tree, space="  ")
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _make_group(style: str, text: str, *, block_kind: str, prompt: str | None = None) -> ET.Element:
    group = ET.Element(
        "Group",
        {
            "view": "presentation",
            "hide-input": "false",
            "hide-output": "false",
            "inline-output": "false",
            "drawlabel": "true",
            "sugarpy-kind": block_kind,
        },
    )
    input_node = ET.SubElement(group, "Input")
    field_attrs = {
        "alignment": "left",
        "style": style,
        "layout": "Normal",
    }
    if prompt is not None:
        field_attrs["prompt"] = prompt
    text_field = ET.SubElement(input_node, "Text-field", field_attrs)
    text_field.text = text
    return group
