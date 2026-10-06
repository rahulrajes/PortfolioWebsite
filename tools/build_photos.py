#!/usr/bin/env python3
"""
Rahul Rajesh — photography importer (optional)
--------------------------------------------------------------------------
The easy way to manage photos is the Studio (studio.html -> Photos tab):
upload, reorder, move between Wildlife / Other, delete. This script is the
batch alternative for originals sitting on your Mac.

  Originals (gitignored, never uploaded):
    assets/img/photography/wildlife/
    assets/img/photography/non-wildlife/

  Output (committed):
    assets/img/photography/web/<set>/card/<name>.jpg   ~900px, for the carousel
    assets/img/photography/web/<set>/full/<name>.jpg   2400px, for the lightbox
    content/photos.json                                 the list the page reads

content/photos.json is the source of truth. This script only ADDS originals
the site doesn't have yet (new photos go to the end of their set). It never
re-adds a photo you deleted in the Studio (those are listed in "removed"),
never moves or reorders anything, and only deletes files in web/ that
photos.json no longer points to. If you replace an original with an edited
version (same file name), its web copies are regenerated in place.

Every copy is rotated upright and stripped of metadata (so no GPS location
from phone photos ends up on the site).

Run from the project folder:   python3 tools/build_photos.py
Then commit + merge as usual. Pull main first if you've used the Studio.
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
CARD = (900, 78)     # long edge px, JPEG quality (the Studio uses the same)
FULL = (2400, 86)


def slug(name):
    s = re.sub(r"[^a-z0-9]+", "-", Path(name).stem.lower()).strip("-")
    return s or "photo"


def name_of(entry):
    return entry.get("name") or Path(entry["card"]).stem


def save(img, dest, size, quality):
    im = img.copy()
    im.thumbnail((size, size), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "JPEG", quality=quality, optimize=True, progressive=True)
    return im.size


def render(src, set_key, name):
    card = OUT / set_key / "card" / (name + ".jpg")
    full = OUT / set_key / "full" / (name + ".jpg")
    with Image.open(src) as raw:
        img = ImageOps.exif_transpose(raw).convert("RGB")
    save(img, card, *CARD)
    w, h = save(img, full, *FULL)
    return {
        "name": name,
        "card": card.relative_to(ROOT).as_posix(),
        "full": full.relative_to(ROOT).as_posix(),
        "w": w, "h": h,
    }


def main():
    m = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    manifest = {k: m.get(k, []) for k in SETS}
    removed = set(m.get("removed", []))
    where = {}                                   # name -> (set, index)
    for k, entries in manifest.items():
        for i, e in enumerate(entries):
            e.setdefault("name", name_of(e))
            where[e["name"]] = (k, i)

    added = updated = 0
    for key, folder in SETS.items():
        src_dir = SRC / folder
        if not src_dir.is_dir():
            continue
        files = sorted((p for p in src_dir.glob("*") if p.suffix.lower() in EXTS), key=lambda p: p.name.lower())
        for p in files:
            name = slug(p.name)
            if name in removed:
                continue                          # deleted in the Studio: stay deleted
            if name in where:
                k, i = where[name]
                full = ROOT / manifest[k][i]["full"]
                if full.exists() and full.stat().st_mtime >= p.stat().st_mtime:
                    continue                      # already on the site and up to date
                manifest[k][i] = render(p, k, name)   # original was edited: refresh in its current set
                updated += 1
                print(f"  updated {k}/{name}.jpg")
                continue
            entry = render(p, key, name)
            manifest[key].append(entry)
            where[name] = (key, len(manifest[key]) - 1)
            added += 1
            print(f"  added   {key}/{name}.jpg  ({entry['w']}x{entry['h']})")

    # remove web copies nothing points to anymore
    keep = {e[f] for entries in manifest.values() for e in entries for f in ("card", "full")}
    for old in OUT.glob("*/*/*.jpg"):
        if old.relative_to(ROOT).as_posix() not in keep:
            old.unlink()
            print(f"  removed {old.relative_to(ROOT)}")

    out = dict(manifest)
    out["removed"] = sorted(removed)
    MANIFEST.write_text(json.dumps(out, indent=2) + "\n")
    total = sum(len(v) for v in manifest.values())
    print(f"Done: {total} photos on the site ({added} added, {updated} updated). Wrote {MANIFEST.relative_to(ROOT)}.")


if __name__ == "__main__":
    main()
