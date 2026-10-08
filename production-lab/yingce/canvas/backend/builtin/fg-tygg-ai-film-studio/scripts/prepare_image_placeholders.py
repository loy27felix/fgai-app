"""Prepare blank, same-named PNG targets for a user-generated asset-image batch.

Usage:
  python prepare_image_placeholders.py <image-plan.json> <图片资产目录> --project-root <project> [--revision r0001]

The plan contains an ``images`` array. Each item needs ``filename`` and may set
``aspect_ratio`` (or ``aspect`` / ``ratio``) as ``16:9`` or a two-number list.
Existing files are never changed. The JSON report on stdout can be copied into
the project's asset-reference manifest as placeholder metadata.
"""

from __future__ import annotations

import argparse
import binascii
import hashlib
import json
from pathlib import Path
import struct
import sys
import zlib


DEFAULT_ASPECT_RATIO = "16:9"
MAX_DIMENSION = 320
MIN_DIMENSION = 32
PLACEHOLDER_KEY = "BlenderAIPrevisPlaceholder"


def parse_ratio(value: object) -> tuple[int, int]:
    if isinstance(value, str):
        parts = value.replace("/", ":").split(":")
    elif isinstance(value, (list, tuple)) and len(value) == 2:
        parts = value
    else:
        raise ValueError("ratio must be a string such as 16:9 or a two-number list")
    try:
        width, height = (int(part) for part in parts)
    except (TypeError, ValueError) as exc:
        raise ValueError("ratio values must be whole numbers") from exc
    if width <= 0 or height <= 0:
        raise ValueError("ratio values must be positive")
    return width, height


def dimensions_for_ratio(ratio: tuple[int, int]) -> tuple[int, int]:
    ratio_width, ratio_height = ratio
    scale = min(MAX_DIMENSION / ratio_width, MAX_DIMENSION / ratio_height)
    width = max(MIN_DIMENSION, int(round(ratio_width * scale)))
    height = max(MIN_DIMENSION, int(round(ratio_height * scale)))
    return width, height


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)
    )


def blank_png(width: int, height: int, revision: str | None) -> bytes:
    header = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    metadata = [f"{PLACEHOLDER_KEY}\x00true".encode("latin-1")]
    if revision:
        metadata.append(f"BlenderAIPrevisRevision\x00{revision}".encode("latin-1"))
    scanline = b"\x00" + (b"\xff\xff\xff" * width)
    pixels = zlib.compress(scanline * height, level=9)
    return header + png_chunk(b"IHDR", ihdr) + b"".join(png_chunk(b"tEXt", item) for item in metadata) + png_chunk(b"IDAT", pixels) + png_chunk(b"IEND", b"")


def requested_ratio(image: dict[str, object]) -> tuple[int, int]:
    for field in ("aspect_ratio", "aspect", "ratio"):
        if field in image and image[field] is not None:
            return parse_ratio(image[field])
    return parse_ratio(DEFAULT_ASPECT_RATIO)


def main() -> int:
    parser = argparse.ArgumentParser(description="Create missing blank asset-image placeholders.")
    parser.add_argument("plan", type=Path, help="JSON plan containing an images array")
    parser.add_argument("image_directory", type=Path, help="Project-local 图片资产 directory")
    parser.add_argument("--revision", default=None, help="Current project revision for PNG metadata")
    parser.add_argument("--project-root", type=Path, help="Emit portable paths relative to this project root")
    args = parser.parse_args()

    try:
        plan = json.loads(args.plan.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "error", "error": f"Cannot read plan: {exc}"}, ensure_ascii=False), file=sys.stderr)
        return 2
    images = plan.get("images") if isinstance(plan, dict) else None
    if not isinstance(images, list):
        print(json.dumps({"status": "error", "error": "Plan must contain an images array."}, ensure_ascii=False), file=sys.stderr)
        return 2

    target_dir = args.image_directory.resolve()
    project_root = args.project_root.resolve() if args.project_root else None
    if project_root is not None and not target_dir.is_relative_to(project_root):
        parser.error("image_directory must stay within project-root")
    def report_path(path):
        return path.relative_to(project_root).as_posix() if project_root else str(path)
    target_dir.mkdir(parents=True, exist_ok=True)
    created: list[dict[str, object]] = []
    preserved: list[str] = []
    errors: list[dict[str, str]] = []
    seen: set[str] = set()

    for index, image in enumerate(images, start=1):
        if not isinstance(image, dict):
            errors.append({"index": str(index), "error": "Image entry must be an object."})
            continue
        filename = image.get("filename")
        if not isinstance(filename, str) or not filename.strip():
            errors.append({"index": str(index), "error": "Image entry needs a filename."})
            continue
        name = Path(filename).name
        if name != filename or Path(name).suffix.lower() != ".png":
            errors.append({"index": str(index), "filename": str(filename), "error": "Filename must be a plain .png filename."})
            continue
        if name.casefold() in seen:
            errors.append({"index": str(index), "filename": name, "error": "Duplicate filename in plan."})
            continue
        seen.add(name.casefold())
        try:
            ratio = requested_ratio(image)
        except ValueError as exc:
            errors.append({"index": str(index), "filename": name, "error": str(exc)})
            continue
        output = target_dir / name
        width, height = dimensions_for_ratio(ratio)
        try:
            # Exclusive creation preserves an image another process may have just saved.
            with output.open("xb") as placeholder_file:
                placeholder_file.write(blank_png(width, height, args.revision))
        except FileExistsError:
            preserved.append(name)
            continue
        placeholder_sha256 = hashlib.sha256(output.read_bytes()).hexdigest()
        created.append({
            "filename": name,
            "path": report_path(output),
            "pixels": [width, height],
            "placeholder_metadata_key": PLACEHOLDER_KEY,
            "placeholder_sha256": placeholder_sha256,
            "revision": args.revision,
        })

    print(json.dumps({
        "status": "ok" if not errors else "needs_review",
        "directory": report_path(target_dir),
        "created": created,
        "preserved": preserved,
        "errors": errors,
    }, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
