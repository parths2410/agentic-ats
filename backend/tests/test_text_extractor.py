"""Unit tests for the PDF text extractor.

We don't ship sample PDFs in tests — instead we mock pdfplumber to drive the
two branches (good text / OCR fallback).
"""

from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from app.pipeline import text_extractor as te


class _FakePage:
    def __init__(self, text: str, ocr_text: str = "") -> None:
        self._text = text
        self._ocr_text = ocr_text

    def extract_text(self) -> str:
        return self._text

    def to_image(self, resolution: int = 200):
        img = MagicMock()
        img.original = self._ocr_text
        return img


@contextmanager
def _fake_pdf(pages):
    pdf = MagicMock()
    pdf.pages = pages
    pdf.__enter__.return_value = pdf
    pdf.__exit__.return_value = False
    yield pdf


def test_extract_text_returns_long_pdfplumber_output(monkeypatch):
    long_text = "Hello there I am a long resume with plenty of content " * 5

    def fake_open(_buf):
        return _fake_pdf([_FakePage(long_text)])

    monkeypatch.setattr(te.pdfplumber, "open", fake_open)
    out = te.extract_text(b"%PDF")
    assert long_text.strip() in out


def test_extract_text_falls_back_to_ocr(monkeypatch):
    pages = [_FakePage("", ocr_text="ocr-img")]

    def fake_open(_buf):
        return _fake_pdf(pages)

    fake_pyt = MagicMock()
    fake_pyt.image_to_string = MagicMock(return_value="extracted via OCR " * 10)
    monkeypatch.setattr(te.pdfplumber, "open", fake_open)
    monkeypatch.setitem(__import__("sys").modules, "pytesseract", fake_pyt)

    out = te.extract_text(b"%PDF")
    assert "extracted via OCR" in out


def test_extract_text_returns_pdfplumber_when_open_fails(monkeypatch, caplog):
    def fake_open(_buf):
        raise RuntimeError("can't open")

    monkeypatch.setattr(te.pdfplumber, "open", fake_open)
    out = te.extract_text(b"%PDF")
    assert out == ""


def test_ocr_returns_empty_when_pytesseract_missing(monkeypatch):
    pages = [_FakePage("")]

    def fake_open(_buf):
        return _fake_pdf(pages)

    import sys

    monkeypatch.setattr(te.pdfplumber, "open", fake_open)
    # Simulate ImportError by removing pytesseract from the modules cache and
    # blocking re-import.
    monkeypatch.setitem(sys.modules, "pytesseract", None)
    out = te.extract_text(b"%PDF")
    assert out == ""


def test_extract_text_per_page_ocr_failure_is_swallowed(monkeypatch):
    bad = MagicMock()
    bad.extract_text = MagicMock(return_value="")
    bad.to_image = MagicMock(side_effect=RuntimeError("boom"))

    def fake_open(_buf):
        return _fake_pdf([bad])

    fake_pyt = MagicMock()
    fake_pyt.image_to_string = MagicMock(return_value="ok")
    monkeypatch.setattr(te.pdfplumber, "open", fake_open)
    monkeypatch.setitem(__import__("sys").modules, "pytesseract", fake_pyt)

    out = te.extract_text(b"%PDF")
    # Both branches yielded nothing — should fall through to "" (the empty
    # pdfplumber result).
    assert out == ""
