"""Standalone check of the upload magic-byte validation logic.

The GPU host cannot be reached from this machine, so this exercises the ONE
piece of app.py that does not require torch/fastapi: `_read_validated_image`'s
content sniffing. It is copied verbatim from app.py's magic-byte branch and run
against real and hostile inputs to prove the validation actually rejects
non-images the way the docstring claims.

This is a LOCAL logic check only — it does NOT prove IDM-VTON inference works.
That must be verified on the GPU host.
"""
import io
import sys

from PIL import Image

ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}


def sniff_and_validate(raw: bytes, field: str = "image") -> tuple[bool, str]:
    """Mirror of app.py's checks, minus the HTTPException plumbing."""
    if not raw:
        return False, f"{field} is empty."
    if len(raw) > 12_000_000:
        return False, f"{field} is too large."

    head = raw[:16]
    looks_like = (
        head.startswith(b"\xff\xd8\xff")
        or head.startswith(b"\x89PNG\r\n\x1a\n")
        or (head[:4] == b"RIFF" and raw[8:12] == b"WEBP")
    )
    if not looks_like:
        return False, f"{field} is not a supported image (JPG, PNG or WebP)."

    try:
        probe = Image.open(io.BytesIO(raw))
        probe.verify()
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception:
        return False, f"{field} is not a valid image."

    if image.format not in ALLOWED_IMAGE_FORMATS:
        return False, f"{field} must be JPG, PNG or WebP."
    if image.width < 64 or image.height < 64:
        return False, f"{field} is too small."
    if image.width > 12000 or image.height > 12000:
        return False, f"{field} is too large in dimensions."
    return True, "ok"


def make_png():
    buf = io.BytesIO()
    Image.new("RGB", (256, 256), (200, 180, 160)).save(buf, format="PNG")
    return buf.getvalue()


def make_jpeg():
    buf = io.BytesIO()
    Image.new("RGB", (256, 256), (10, 20, 30)).save(buf, format="JPEG")
    return buf.getvalue()


def make_webp():
    buf = io.BytesIO()
    Image.new("RGB", (256, 256), (10, 20, 30)).save(buf, format="WEBP")
    return buf.getvalue()


def main() -> int:
    cases = [
        ("valid PNG", make_png(), True),
        ("valid JPEG", make_jpeg(), True),
        ("valid WebP", make_webp(), True),
        ("empty", b"", False),
        ("text disguised as image", b"hello this is not an image", False),
        ("PHP snippet as .png", b"<?php system($_GET['c']); ?>", False),
        ("MZ executable", b"MZ\x90\x00\x03\x00\x00\x00", False),
        ("ELF executable", b"\x7fELF\x02\x01\x01\x00", False),
        ("truncated PNG header only", b"\x89PNG\r\n\x1a\n" + b"\x00" * 4, False),
        ("1x1 PNG (too small)", None, False),
    ]

    # Build the too-small case properly.
    buf = io.BytesIO()
    Image.new("RGB", (1, 1), (0, 0, 0)).save(buf, format="PNG")
    cases[-1] = ("1x1 PNG (too small)", buf.getvalue(), False)

    failures = 0
    for name, raw, expect_accept in cases:
        accepted, why = sniff_and_validate(raw)
        ok = accepted == expect_accept
        mark = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        print(f"[{mark}] {name:34s} accepted={accepted!s:5s} ({why})")

    print()
    if failures:
        print(f"{failures} case(s) behaved unexpectedly.")
        return 1
    print("All validation cases behaved as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
