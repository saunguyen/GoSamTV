"""Stage the web app, write config.xml, package and sign it as a Tizen .wgt.

The TV rejects a package it cannot parse ("Load archive info fail"), so the
config.xml variants below mirror the exact element set of packages that are
known to install on this Samsung TV.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(r"S:\GoSamTV")
APP = ROOT / "app"
BUILD = ROOT / "build"
DIST = ROOT / "dist"

CERT_ROOT = Path(r"C:\Users\saunv\AppData\Roaming\Apps2Samsung\Certificate")
PROFILES = {
    "public": ("Jelly2Sams - Public", ""),
    "partner": ("Jelly2Sams - Partner", "-partner"),
}

VERSION = "1.7.3"

# Variant A: element set copied from a TizenTube package that installs on the
# CU8000 this project targets (Samsung TV profile, allow-navigation href form).
CONFIG_MAIN = """<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns:tizen="http://tizen.org/ns/widgets" xmlns="http://www.w3.org/ns/widgets"
        id="https://launchpad.tv" version="{version}" viewmodes="maximized">
    <access origin="*" subdomains="true"></access>
    <tizen:allow-navigation href="*"/>
    <tizen:application id="LPadTV2026.Home" package="LPadTV2026" required_version="3.0"/>
    <author href="https://launchpad.tv">LaunchPad TV</author>
    <content src="index.html"></content>
    <feature name="http://tizen.org/feature/screen.size.all"/>
    <feature name="http://tizen.org/feature/web.service"/>
    <icon src="icon.png" width="512" height="512"/>
    <name>GoSamTV</name>
    <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:privilege name="http://tizen.org/privilege/network.get"/>
  <tizen:privilege name="http://tizen.org/privilege/bluetooth"/>
    <tizen:privilege name="http://tizen.org/privilege/application.launch"/>
    <tizen:profile name="tv-samsung"/>
    <tizen:setting screen-orientation="landscape" context-menu="disable"
                   background-support="disable" encryption="disable"
                   install-location="auto" hwkey-event="enable"/>
</widget>
"""

# Variant B: minimal element set, closer to a plain "Nhà Mình" style package.
CONFIG_COMPAT = """<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets"
        id="http://launchpad.tv/home" version="{version}" viewmodes="maximized">
    <tizen:application id="LPadTV2026.Home" package="LPadTV2026" required_version="2.3"/>
    <content src="index.html"/>
    <feature name="http://tizen.org/feature/screen.size.all"/>
    <icon src="icon.png"/>
    <name>GoSamTV</name>
    <tizen:profile name="tv-samsung"/>
    <access origin="*" subdomains="true"/>
    <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:privilege name="http://tizen.org/privilege/network.get"/>
  <tizen:privilege name="http://tizen.org/privilege/bluetooth"/>
    <tizen:setting screen-orientation="landscape" context-menu="disable"
                   background-support="disable" encryption="disable"
                   install-location="auto" hwkey-event="enable"/>
</widget>
"""

# Variant C: control package - proves whether the TV accepts our packaging at
# all, independently of the app's content.
CONFIG_HELLO = """<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets"
        id="http://launchpad.tv/hello" version="0.0.1" viewmodes="maximized">
    <tizen:application id="LPadTst001.Hello" package="LPadTst001" required_version="2.3"/>
    <content src="index.html"/>
    <icon src="icon.png"/>
    <name>LP Test</name>
    <tizen:profile name="tv-samsung"/>
    <access origin="*" subdomains="true"/>
    <tizen:setting screen-orientation="landscape" hwkey-event="enable"/>
</widget>
"""

HELLO_HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>LP Test</title>
<style>body{background:#0b0d16;color:#fff;font-family:sans-serif;display:grid;
place-items:center;height:100vh;margin:0}h1{font-size:64px}</style></head>
<body><h1>LaunchPad test OK</h1></body></html>
"""

VARIANTS = {
    "main": (CONFIG_MAIN, "GoSamTV-{version}.wgt"),
    "compat": (CONFIG_COMPAT, "GoSamTV-{version}-compat.wgt"),
    "hello": (CONFIG_HELLO, "GoSamTV-hello.wgt"),
}


def stage(variant: str):
    if BUILD.exists():
        shutil.rmtree(BUILD)
    if variant == "hello":
        BUILD.mkdir(parents=True)
        (BUILD / "index.html").write_text(HELLO_HTML, encoding="utf-8")
        shutil.copy2(APP / "img" / "icon.png", BUILD / "icon.png")
    else:
        shutil.copytree(APP, BUILD)
        shutil.copy2(APP / "img" / "icon.png", BUILD / "icon.png")
    template = VARIANTS[variant][0]
    (BUILD / "config.xml").write_text(
        template.format(version=VERSION if variant != "hello" else "0.0.1"),
        encoding="utf-8",
    )


def build(variant: str, profile: str = "public") -> dict:
    sys.path.insert(0, str(ROOT / "tools"))
    import wgtsign

    folder, suffix = PROFILES[profile]
    cert_dir = CERT_ROOT / folder
    password = (cert_dir / "password.txt").read_text(encoding="utf-8").strip()

    stage(variant)
    DIST.mkdir(exist_ok=True)
    name = VARIANTS[variant][1].format(version=VERSION)
    out = DIST / (name if profile == "public" else name.replace(".wgt", f"{suffix}.wgt"))
    info = wgtsign.sign_wgt(str(BUILD), str(out), str(cert_dir), password)
    check = wgtsign.verify_wgt(str(out))
    info.update(
        {
            "file": str(out),
            "variant": variant,
            "profile": profile,
            "verified": check["ok"],
            "problems": check["problems"],
        }
    )
    return info


def main():
    # refresh the baked headlines so the package ships with current news
    try:
        import subprocess

        subprocess.run([sys.executable, str(ROOT / "tools" / "fetch_news.py")],
                       check=True, cwd=str(ROOT))
    except Exception as exc:  # noqa: BLE001
        print("news snapshot skipped:", exc)

    wanted = sys.argv[1:] or ["main", "compat", "hello"]
    results = [build(v) for v in wanted]
    print(json.dumps(results, ensure_ascii=False, indent=2))
    if not all(r["verified"] for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
