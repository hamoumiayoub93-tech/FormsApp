#!/bin/sh
# compare.sh - side-by-side screenshots: HTML prototype (left) vs native
# code running in the PC harness (right), 2x zoom, one PNG per scene plus
# an overview sheet.
#
#   tools/compare.sh <out-dir>
#
# Needs: node + Playwright (Chromium) for the HTML shots, ImageMagick.
set -e
cd "$(dirname "$0")/.."
OUT=${1:-build/compare}
mkdir -p "$OUT/html" "$OUT/native" "$OUT/run" "$OUT/pairs"
[ -x build/sim/wwsim ] || ./build.sh sim
[ -f "$OUT/html/01_title.png" ] || node tools/html_shots.js "$OUT/html"
python3 tools/gen_scenes.py >/dev/null
cp data/*.csv data/dialog.txt "$OUT/run/"
rm -f "$OUT/run/save.dat"
./build/sim/wwsim "$OUT/run" tests/scenes.txt "$OUT/native"
for p in "$OUT"/native/*.ppm; do
    n=$(basename "$p" .ppm)
    convert "$p" "$OUT/native/$n.png"
    if [ -f "$OUT/html/$n.png" ]; then
        convert "$OUT/html/$n.png" "$OUT/native/$n.png" -scale 200% +append \
            -bordercolor white -border 4 "$OUT/pairs/$n.png"
    fi
done
montage "$OUT"/pairs/*.png -tile 3x -geometry +2+2 "$OUT/overview.png" 2>/dev/null || true
echo "pairs in $OUT/pairs, overview: $OUT/overview.png"
