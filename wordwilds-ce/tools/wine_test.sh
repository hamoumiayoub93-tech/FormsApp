#!/bin/sh
# wine_test.sh - run the Win32 PC build (build/pc/wordwilds-pc.exe, same
# main.c as the Windows CE build) under Wine on a virtual X display, drive it
# with xdotool and take screenshots.
#
#   tools/wine_test.sh <out-dir>
set -e
cd "$(dirname "$0")/.."
OUT=${1:-build/wine}
mkdir -p "$OUT"
[ -f build/pc/wordwilds-pc.exe ] || ./build.sh pc
rm -f build/pc/save.dat
export WINEDEBUG=-all
export WINEPREFIX=${WINEPREFIX:-$HOME/.wine-wordwilds}
Xvfb :77 -screen 0 640x800x24 >/dev/null 2>&1 &
XPID=$!
export DISPLAY=:77
sleep 2
wineboot -i >/dev/null 2>&1 || true
wine build/pc/wordwilds-pc.exe >/dev/null 2>&1 &
sleep 8
WID=$(xdotool search --name "^WordWilds$" | head -1)
echo "window: $WID"
shot() { import -window "$WID" "$OUT/$1.png"; echo "shot $1"; }
key() { xdotool key --window "$WID" "$1"; sleep "${2:-0.3}"; }
xdotool windowactivate --sync "$WID" 2>/dev/null || xdotool windowfocus "$WID"
sleep 1
shot w01_title
# stylus: tap "B1" then "Easy", then keys for Start
eval "$(xdotool getwindowgeometry --shell "$WID")"
xdotool mousemove --window "$WID" 152 192 click 1; sleep 0.4
xdotool mousemove --window "$WID" 60 244 click 1; sleep 0.4
shot w02_title_b1_easy
key Return 1.5
shot w03_map
key Up; key Up; key Up; key Left; key Left
shot w04_walk
# hold the stylus on the map to walk towards the house
xdotool mousemove --window "$WID" 70 120 mousedown 1; sleep 2; xdotool mouseup 1; sleep 0.5
shot w05_touchwalk
key x 0.5
shot w06_wordex
key Return 0.5
key Escape 3
[ -f build/pc/save.dat ] && { echo "save.dat written:"; cat build/pc/save.dat; } || echo "NO save.dat"
sleep 1; ps -eo pid,stat,args | grep -i "wordwilds-pc" | grep -v grep || true; if ps -eo stat,args | grep -i "wordwilds-pc.exe" | grep -v grep | grep -qv "^Z"; then echo "still running"; else echo "exited after Escape"; fi
kill $XPID 2>/dev/null || true
