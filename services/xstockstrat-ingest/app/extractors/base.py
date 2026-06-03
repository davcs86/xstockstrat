"""BaseExtractor — abstract interface all signal source extractors must implement."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class SimpleEmailInput:
    body_text: str
    body_html: str


@dataclass
class EmailAttachmentInput:
    body_text: str
    body_html: str
    attachments: list[bytes]


@dataclass
class LinkedEmailInput:
    body_text: str
    body_html: str
    urls: list[str]


@dataclass
class SimpleWebsiteInput:
    url: str
    html: str


@dataclass
class AuthenticatedWebsiteInput:
    url: str
    html: str
    credentials: dict


RawInput = (
    SimpleEmailInput
    | EmailAttachmentInput
    | LinkedEmailInput
    | SimpleWebsiteInput
    | AuthenticatedWebsiteInput
)


class BaseExtractor(ABC):
    @abstractmethod
    async def extract(self, raw: RawInput) -> list[dict]:
        """Extract signals from raw input. Returns a list of signal dicts."""
        ...
