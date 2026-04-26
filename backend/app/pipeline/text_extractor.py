"""PDF → raw text extraction.

Primary: pdfplumber (layout-aware).
Fallback: Tesseract OCR via pdfplumber's page.to_image() when little or no
text is recovered. If OCR isn't available (missing system binaries), we
return whatever pdfplumber gave us and let downstream layers surface a
"sparse text" condition.
"""

from __future__ import annotations

import io
import logging

import pdfplumber

logger = logging.getLogger(__name__)

# If pdfplumber returns less than this many characters across the whole PDF,
# we treat it as image-based and try OCR.
_MIN_TEXT_THRESHOLD = 80


def extract_text(pdf_bytes: bytes) -> str:
    """Return the best-effort extracted text from a PDF byte string."""
    text = _extract_with_pdfplumber(pdf_bytes)
    if len(text.strip()) >= _MIN_TEXT_THRESHOLD:
        return text

    ocr_text = _extract_with_ocr(pdf_bytes)
    if len(ocr_text.strip()) > len(text.strip()):
        return ocr_text
    return text


def _extract_with_pdfplumber(pdf_bytes: bytes) -> str:
    parts: list[str] = []
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                if page_text.strip():
                    parts.append(page_text)
    except Exception as e:
        logger.warning("pdfplumber extraction failed: %s", e)
    return "\n\n".join(parts).strip()


def _extract_with_ocr(pdf_bytes: bytes) -> str:
    try:
        import pytesseract  # type: ignore
    except ImportError:
        logger.info("pytesseract not installed; skipping OCR fallback.")
        return ""

    parts: list[str] = []
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                try:
                    img = page.to_image(resolution=200).original
                    page_text = pytesseract.image_to_string(img) or ""
                    if page_text.strip():
                        parts.append(page_text)
                except Exception as e:
                    logger.warning("OCR failed for a page: %s", e)
    except Exception as e:
        logger.warning("OCR fallback could not open PDF: %s", e)
    return "\n\n".join(parts).strip()
