"""Bake a news snapshot into the app so the front page is never empty."""

from __future__ import annotations

import html
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(r"S:\GoSamTV")
OUT = ROOT / "app" / "data" / "news.json"
OUT_JS = ROOT / "app" / "data" / "news.js"

FEEDS = [
    ("VnExpress", "https://vnexpress.net/rss/tin-moi-nhat.rss"),
    ("Tuổi Trẻ", "https://tuoitre.vn/rss/tin-moi-nhat.rss"),
    ("Thanh Niên", "https://thanhnien.vn/rss/home.rss"),
    ("BBC Việt", "https://feeds.bbci.co.uk/vietnamese/rss.xml"),
]

UA = ("Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36 "
      "(KHTML, like Gecko) SamsungBrowser/5.0 Chrome/76.0.3809.146 TV Safari/537.36")


def first_image(description: str, content: str, node) -> str | None:
    for child in node:
        tag = child.tag.split("}")[-1]
        if tag in ("content", "thumbnail") and child.get("url"):
            return child.get("url")
    for blob in (content, description):
        if not blob:
            continue
        match = re.search(r'<img[^>]+src="([^"]+)"', blob)
        if match:
            return html.unescape(match.group(1))
    return None


def strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def parse_date(value: str) -> int:
    if not value:
        return int(datetime.now(timezone.utc).timestamp() * 1000)
    try:
        return int(parsedate_to_datetime(value).timestamp() * 1000)
    except Exception:  # noqa: BLE001
        try:
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
        except Exception:  # noqa: BLE001
            return int(datetime.now(timezone.utc).timestamp() * 1000)


items = []
for name, url in FEEDS:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        raw = urllib.request.urlopen(req, timeout=25).read()
        root = ET.fromstring(raw)
        for node in root.findall(".//item")[:8]:
            title = (node.findtext("title") or "").strip()
            if not title:
                continue
            description = node.findtext("description") or ""
            content = node.findtext("{http://purl.org/rss/1.0/modules/content/}encoded") or ""
            items.append({
                "title": html.unescape(title),
                "link": (node.findtext("link") or "").strip(),
                "source": name,
                "date": parse_date((node.findtext("pubDate") or "").strip()),
                "description": strip_html(description)[:400],
                "content": description or content,
                "image": first_image(description, content, node),
            })
        print(f"{name}: {len(root.findall('.//item'))} items")
    except Exception as exc:  # noqa: BLE001
        print(f"{name}: FAIL {exc}")

items.sort(key=lambda item: item["date"], reverse=True)
seen, unique = set(), []
for item in items:
    key = item["title"].lower()[:60]
    if key in seen:
        continue
    seen.add(key)
    unique.append(item)

payload = {
    "fetchedAt": datetime.now().isoformat(timespec="seconds"),
    "items": unique[:30],
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
OUT_JS.write_text(
    "window.LP_NEWS=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
    encoding="utf-8",
)
print(f"wrote {len(payload['items'])} items -> {OUT} + {OUT_JS.name} ({OUT_JS.stat().st_size / 1024:.0f} KB)")
