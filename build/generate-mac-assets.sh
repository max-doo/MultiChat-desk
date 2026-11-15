#!/bin/sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS_DIR="$ROOT_DIR/assets"
ICONSET_DIR="$ASSETS_DIR/logo.iconset"

rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

# Dock/应用图标使用带 ~10% 透明边距的 dock-icon.png（macOS 图标规范：图稿约占画布 82%）；
# 若缺失则退回 logo.png
ICON_SRC="$ASSETS_DIR/dock-icon.png"
[ -f "$ICON_SRC" ] || ICON_SRC="$ASSETS_DIR/logo.png"

sips -z 16 16 "$ICON_SRC" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32 "$ICON_SRC" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$ICON_SRC" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64 "$ICON_SRC" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$ICON_SRC" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256 "$ICON_SRC" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$ICON_SRC" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512 "$ICON_SRC" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$ICON_SRC" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$ICON_SRC" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$ICONSET_DIR" -o "$ASSETS_DIR/logo.icns"
sips -z 44 44 "$ASSETS_DIR/logo.png" --out "$ASSETS_DIR/tray-iconTemplate.png" >/dev/null
rm -rf "$ICONSET_DIR"
