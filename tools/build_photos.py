#!/usr/bin/env python3
"""
Rahul Rajesh — photography build step
--------------------------------------------------------------------------
Turns the full-size originals into web-ready copies for photography.html.

  Originals (gitignored, never uploaded):
    assets/img/photography/wildlife/
    assets/img/photography/non-wildlife/

  Output (committed):
    assets/img/photography/web/<set>/card/<name>.jpg   ~900px, for the carousel
    assets/img/photography/web/<set>/full/<name>.jpg   2400px, for the lightbox
    content/photos.json                                 the list the page reads

Every copy is rotated upright and stripped of metadata (so no GPS location
from phone photos ends up on the site).

Run from the project folder:   python3 tools/build_photos.py
Re-running only redoes photos that are new or changed, and cleans up copies
of photos you deleted.

Order: photos show in filename order. To force an order, rename files with a
number prefix (01-heron.jpg, 02-hawk.jpg, ...).
"""
import json
import re
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("Pillow is missing. Install it once with:  python3 -m pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/img/photography"
OUT = SRC / "web"
MANIFEST = ROOT / "content/photos.json"

SETS = {"wildlife": "wildlife", "other": "non-wildlife"}   # key in photos.json -> source folder
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}
CARD = (900, 78)     # long edge px, JPEG quality
FULL = (2400, 86)


def slug(name):
    s = re.sub(r"[^a-z0-9]+", "-", Path(name).stem.lower()).strip("-")
    return s or "photo"


def save(img, dest, size, quality):
    im = img.copy()
    im.thumbnail((size, size), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "JPEG", quality=quality, optimize=True, progressive=True)
    return im.size


def main():
    manifest = {}
    total = made = 0
    for key, folder in SETS.items():
        src_dir = SRC / folder
        files = sorted(
            (p for p in src_dir.glob("*") if p.suffix.lower() in EXTS),
            key=lambda p: p.name.lower(),
        ) if src_dir.is_dir() else []
        entries, used = [], set()
        for p in files:
            name = slug(p.name)
            while name in used:
                name += "-b"
            used.add(name)
            card = OUT / key / "card" / (name + ".jpg")
            full = OUT / key / "full" / (name + ".jpg")
            fresh = card.exists() and full.exists() and min(
                card.stat().st_mtime, full.stat().st_mtime) >= p.stat().st_mtime
            if fresh:
                with Image.open(full) as f:
                    w, h = f.size
            else:
                with Image.open(p) as raw:
                    img = ImageOps.exif_transpose(raw).convert("RGB")
                save(img, card, *CARD)
                w, h = save(img, full, *FULL)
                made += 1
                print(f"  {key}/{name}.jpg  ({w}x{h})")
            entries.append({
                "card": card.relative_to(ROOT).as_posix(),
                "full": full.relative_to(ROOT).as_posix(),
                "w": w, "h": h,
            })
        manifest[key] = entries
        total += len(entries)

        # remove copies whose original was deleted
        keep = {e["card"] for e in entries} | {e["full"] for e in entries}
        for old in (OUT / key).glob("*/*.jpg"):
            if old.relative_to(ROOT).as_posix() not in keep:
                old.unlink()
                print(f"  removed {old.relative_to(ROOT)}")

    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Done: {total} photos ({made} processed). Wrote {MANIFEST.relative_to(ROOT)}.")


if __name__ == "__main__":
    main()
