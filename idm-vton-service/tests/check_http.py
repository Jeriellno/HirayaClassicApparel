"""End-to-end HTTP checks against a running IDM-VTON service.

Exercises the paths that do NOT need a GPU:
  * GET /health          -> must honestly report not_ready when no CUDA
  * POST /virtual-tryon  -> must refuse with a truthful 503, never a fake result
  * POST with bad images -> must reject at the validation layer
  * GET /results/<bad>   -> must reject path traversal / bad names

This is a LOCAL contract/behaviour check. It CANNOT prove real inference —
that requires the GPU host. See README.md.
"""
import io
import json
import sys
import urllib.error
import urllib.request

from PIL import Image

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8012"


def png_bytes(w=256, h=256, color=(180, 170, 160)):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()


def multipart(fields, files):
    """Tiny multipart/form-data encoder (no external deps)."""
    boundary = "----hirayaBoundary7f3a"
    body = bytearray()

    for name, value in fields.items():
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        body += str(value).encode() + b"\r\n"

    for name, (filename, content) in files.items():
        body += f"--{boundary}\r\n".encode()
        body += (
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
        ).encode()
        body += b"Content-Type: application/octet-stream\r\n\r\n"
        body += content + b"\r\n"

    body += f"--{boundary}--\r\n".encode()
    return bytes(body), f"multipart/form-data; boundary={boundary}"


def call(method, path, body=None, headers=None):
    req = urllib.request.Request(BASE + path, data=body, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def main() -> int:
    failures = 0

    def check(name, condition, detail=""):
        nonlocal failures
        mark = "PASS" if condition else "FAIL"
        if not condition:
            failures += 1
        print(f"[{mark}] {name}" + (f"  ({detail})" if detail else ""))

    # --- /health ------------------------------------------------------
    status, raw = call("GET", "/health")
    health = json.loads(raw)
    print("  /health ->", json.dumps(health))
    check("health responds 200", status == 200)
    check("health status is not_ready without CUDA", health.get("status") == "not_ready")
    check("health reports cuda_available=false", health.get("cuda_available") is False)
    check("health reports model_loaded=false", health.get("model_loaded") is False)
    check("health gives a reason", bool(health.get("reason")))

    # --- /virtual-tryon with VALID images, but no GPU -----------------
    body, ctype = multipart(
        {"category": "upper_body", "garment_description": "a blue shirt", "seed": "42",
         "denoise_steps": "30"},
        {"person_image": ("p.png", png_bytes(color=(1, 2, 3))),
         "garment_image": ("g.png", png_bytes(color=(9, 8, 7)))},
    )
    status, raw = call("POST", "/virtual-tryon", body, {"Content-Type": ctype})
    payload = json.loads(raw)
    print("  /virtual-tryon (no GPU) ->", status, json.dumps(payload))
    check("refuses with 503 when no CUDA", status == 503)
    check("success is false (never a fake success)", payload.get("success") is False)
    check("no result_url leaked", "result_url" not in payload)
    check("error is human-readable", isinstance(payload.get("error"), str))
    check("error mentions GPU", "GPU" in payload.get("error", ""))

    # --- /virtual-tryon with an INVALID image -------------------------
    body, ctype = multipart(
        {"category": "upper_body"},
        {"person_image": ("evil.png", b"<?php system($_GET['c']); ?>"),
         "garment_image": ("g.png", png_bytes())},
    )
    status, raw = call("POST", "/virtual-tryon", body, {"Content-Type": ctype})
    print("  /virtual-tryon (bad image) ->", status, raw[:120])
    # On a GPU-less host the CUDA guard fires first (503); the validation layer
    # is exercised directly by tests/check_validation.py. Either way it must NOT
    # be a 200 success.
    check("invalid upload is never a 200 success", status != 200)

    # --- path traversal on /results ----------------------------------
    for bad in ["..%2f..%2fetc%2fpasswd", "not-a-uuid.png", "ffffffffffffffffffffffffffffffff.png"]:
        status, _ = call("GET", f"/results/{bad}")
        check(f"/results/{bad[:20]} rejected", status in (400, 404), f"status={status}")

    print()
    if failures:
        print(f"{failures} check(s) failed.")
        return 1
    print("All HTTP behaviour checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
