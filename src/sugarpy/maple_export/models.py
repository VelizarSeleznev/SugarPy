from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class TitleBlock:
    text: str


@dataclass(slots=True)
class SectionBlock:
    text: str


@dataclass(slots=True)
class TextBlock:
    text: str


@dataclass(slots=True)
class MapleInputBlock:
    code: str


@dataclass(slots=True)
class WarningBlock:
    text: str


MapleBlock = TitleBlock | SectionBlock | TextBlock | MapleInputBlock | WarningBlock


@dataclass(slots=True)
class MapleWorksheet:
    title: str
    blocks: list[MapleBlock] = field(default_factory=list)

