#!/bin/bash
# アイコン一式を作り直す（icons/・icon-source.svg・android の mipmap）。要る物：python3、node と playwright（Chromium）
# 絵を変えるときは make-svg.py（羅針盤 compass と錨 anchor）を直してから、リポジトリの一番上で：  bash tools/icons/make-icons.sh
set -e
R="$(cd "$(dirname "$0")/../.." && pwd)"; T="$(mktemp -d)"; A="$R/android/app/src/main/res"
(cd "$T" && python3 "$R/tools/icons/make-svg.py")
J='['
for n in 16 32 48; do J="$J[\"$T/small.svg\",$n,\"$R/icons/icon-$n.png\"],"; done
for n in 72 96 128 144 152 180 192 384 512; do J="$J[\"$T/full.svg\",$n,\"$R/icons/icon-$n.png\"],"; done
J="$J[\"$T/maskable.svg\",512,\"$R/icons/icon-maskable-512.png\"]"
for d in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do
  IFS=: read n l a <<< "$d"; mkdir -p "$A/mipmap-$n"
  J="$J,[\"$T/full.svg\",$l,\"$A/mipmap-$n/ic_launcher.png\"],[\"$T/bg.svg\",$a,\"$A/mipmap-$n/ic_launcher_background.png\"],[\"$T/fg.svg\",$a,\"$A/mipmap-$n/ic_launcher_foreground.png\"]"
done
node "$R/tools/icons/render.js" "$J]"
cp "$T/full.svg" "$R/icon-source.svg"
echo "アイコンを作り直しました（Android のアイコンを変えたときは APK も作り直す）"
