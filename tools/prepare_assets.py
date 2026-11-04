"""Build app data: channel lists + optimised logos + home-screen icon.

Run with the bundled Python that has Pillow.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(r"S:\GoSamTV")
APP = ROOT / "app"
VN_SRC = Path(r"S:\TV & Radio Viet\web")
LOGO_OUT = APP / "img" / "logos"
MAX_LOGO_W = 260

# group-title values in the Vietnamese list are short codes; show them in
# Vietnamese in the UI (the M3U group-title keeps its original spelling).
CATEGORY_LABELS = {
    "NORTH": "Miền Bắc",
    "SOUTH": "Miền Nam",
    "CENTRAL": "Miền Trung",
    "NEWS": "Tin tức",
    "VTV": "VTV",
    "HTV": "HTV",
    "VTVCAB": "VTVcab",
    "THVL": "Vĩnh Long",
    "Địa Phương": "Địa phương",
    "Giao Thông": "Giao thông",
    "Âm Nhạc": "Âm nhạc",
    "Quốc Tế": "Quốc tế",
    "VOV Quốc Gia": "VOV",
}


def parse_m3u(path: Path):
    channels = []
    pending = None
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#EXTINF"):
            m = re.search(r'tvg-id="([^"]*)"', line)
            tid = m.group(1) if m else ""
            name = line.split(",", 1)[1].strip() if "," in line else "Kênh"
            name = re.sub(r"\s*\(\d{3,4}p\)\s*$", "", name).strip()
            pending = {"id": tid or name, "name": name}
        elif line.startswith("#"):
            continue
        elif pending is not None:
            pending["url"] = line
            pending["category"] = guess_category(pending["name"], pending["id"])
            channels.append(pending)
            pending = None
    return channels


def guess_category(name: str, tid: str) -> str:
    tag = f"{name} {tid}".lower()
    groups = [
        ("Tin tức", ("news", "cnn", "bbc", "fox news", "msnbc", "abc news")),
        ("Thể thao", ("sport", "espn", "nfl", "nba", "golf", "tennis")),
        ("Phim ảnh", ("movie", "cinema", "film", "hbo", "starz", "showtime")),
        ("Thiếu nhi", ("kids", "cartoon", "disney", "nick", "baby")),
        ("Âm nhạc", ("music", "mtv", "vh1", "radio")),
        ("Quốc tế", ("international", "world", "tv5", "dw", "france 24")),
    ]
    for label, keys in groups:
        if any(k in tag for k in keys):
            return label
    return "Quốc tế"


def build_vn():
    src = json.loads((VN_SRC / "channels.json").read_text(encoding="utf-8"))
    logo_index: dict[str, Path] = {}
    for p in (VN_SRC / "logos").rglob("*"):
        if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
            logo_index.setdefault(p.stem.lower(), p)

    LOGO_OUT.mkdir(parents=True, exist_ok=True)
    out = []
    for ch in src:
        if ch.get("type") not in ("tv", "radio"):
            continue
        slug = re.sub(r"[^a-z0-9]+", "-", ch["id"].lower()).strip("-")
        logo_file = None
        ref = ch.get("logo") or ""
        if ref.startswith("http"):
            # remote logo (imgur etc.) - keep the URL, TV has internet
            out.append(
                {
                    "id": ch["id"],
                    "name": ch["name"],
                    "url": ch["url"],
                    "category": CATEGORY_LABELS.get(ch.get("category"), ch.get("category") or "Khác"),
                    "logo": ref,
                }
            )
            continue
        if ref:
            rel = ref.lstrip("./")
            candidate = VN_SRC / rel
            if candidate.exists():
                logo_file = candidate
            else:
                logo_file = logo_index.get(Path(rel).stem.lower())
        if logo_file:
            dest = LOGO_OUT / f"{slug}.png"
            try:
                im = Image.open(logo_file).convert("RGBA")
                ratio = min(1.0, MAX_LOGO_W / im.width)
                if ratio < 1.0:
                    im = im.resize(
                        (max(1, round(im.width * ratio)), max(1, round(im.height * ratio))),
                        Image.LANCZOS,
                    )
                im.save(dest, "PNG", optimize=True)
                logo_file = f"img/logos/{slug}.png"
            except Exception:  # noqa: BLE001
                logo_file = None
        out.append(
            {
                "id": ch["id"],
                "name": ch["name"],
                "url": ch["url"],
                "category": CATEGORY_LABELS.get(ch.get("category"), ch.get("category") or "Khác"),
                "logo": logo_file,
            }
        )
    return out


def build_intl():
    chans = parse_m3u(ROOT / "us.m3u")
    seen, out = set(), []
    for ch in chans:
        key = (ch["name"], ch["url"])
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "id": ch["id"] or ch["name"],
                "name": ch["name"],
                "url": ch["url"],
                "category": ch["category"],
                "logo": None,
            }
        )
    return out


def make_icon(path: Path, size: int = 512):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # rounded square with vertical indigo -> violet gradient
    grad = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / (size - 1)
        r = int(96 + (150 - 96) * t)
        g = int(86 + (110 - 86) * t)
        b = int(230 + (255 - 230) * t)
        gd.line([(0, y), (size, y)], fill=(r, g, b, 255))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=112, fill=255)
    img.paste(grad, (0, 0), mask)
    # play glyph
    pad = size * 0.30
    d.polygon(
        [(pad, pad * 0.82), (pad, size - pad * 0.82), (size - pad * 0.86, size / 2)],
        fill=(255, 255, 255, 245),
    )
    img.save(path, "PNG", optimize=True)


def build_epg_map():
    """channel id -> EPG provider channel id (same ids as the channel list)."""
    src = VN_SRC / "epg-channel-map.json"
    if not src.exists():
        return {}
    return json.loads(src.read_text(encoding="utf-8"))


def load_status():
    """Stream probe results (tools/stream-status.json), so dead links are dropped."""
    path = ROOT / "tools" / "stream-status.json"
    if not path.exists():
        return {}, {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("intl", {}), data.get("vn", {})


def load_overrides():
    """Replacement stream URLs for channels that were dead (tools/vn-overrides.json)."""
    path = ROOT / "tools" / "vn-overrides.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    APP.mkdir(parents=True, exist_ok=True)
    intl_status, vn_status = load_status()
    overrides = load_overrides()
    for channel_id in overrides:
        # a replaced stream was probed already, so keep the channel
        vn_status[channel_id] = "ok"

    vn = build_vn()
    source_types = {
        c["id"]: c.get("type", "tv")
        for c in json.loads((VN_SRC / "channels.json").read_text(encoding="utf-8"))
    }
    for channel in vn:
        replacement = overrides.get(channel["id"])
        if replacement:
            channel["url"] = replacement["url"]
        # radio stations share the channel list but get their own row and
        # an audio-only player stage
        if source_types.get(channel["id"]) == "radio":
            channel["type"] = "radio"
            channel["category"] = "Radio"
        else:
            channel["type"] = "tv"
    intl = build_intl()
    # radio stations keep their playlist logo
    if vn_status:
        vn = [c for c in vn if vn_status.get(c["id"], "ok") == "ok"]
    if intl_status:
        intl = [c for c in intl if intl_status.get(c["url"], "ok") == "ok"]
    (APP / "data").mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"vn": vn, "intl": intl}, ensure_ascii=False, separators=(",", ":"))
    (APP / "data" / "channels.js").write_text(
        "window.LP_DATA=" + payload + ";\n", encoding="utf-8"
    )
    epg = build_epg_map()
    (APP / "data" / "epg-map.js").write_text(
        "window.LP_EPG=" + json.dumps(epg, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    make_icon(APP / "img" / "icon.png")
    print("vn:", len(vn), "intl:", len(intl), "epg ids:", len(epg))
    print("logos:", len(list(LOGO_OUT.glob('*.png'))))
    print("channels.js KB:", round((APP / 'data' / 'channels.js').stat().st_size / 1024))


if __name__ == "__main__":
    main()
