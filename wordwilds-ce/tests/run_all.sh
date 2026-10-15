#!/bin/sh
# run_all.sh - every harness test, in fresh copies of the data folder
set -e
cd "$(dirname "$0")/.."
./build.sh sim >/dev/null
T=${TMPDIR:-/tmp}/wwtests.$$
fresh() { rm -rf "$T/$1"; mkdir -p "$T/$1"; cp data/*.csv data/dialog.txt "$T/$1/"; }
python3 tools/gen_scenes.py >/dev/null
for t in scenes logic modes modes2 stylus; do fresh $t; ./build/sim/wwsim "$T/$t" tests/$t.txt "$T/$t"; done
./build/sim/wwsim "$T/logic" tests/reload.txt "$T/logic"        # reads logic's save.dat
fresh err; rm "$T/err/words.csv"; ./build/sim/wwsim "$T/err" tests/error.txt "$T/err"
fresh bad; sed -i 's/#e0483d/#zz/' "$T/bad/creatures.csv"; ./build/sim/wwsim "$T/bad" tests/error.txt "$T/bad"
fresh save; printf 'WWSAVE 1\nlevel=9\nmode=x\ndex=nobody,applet,,\nmissed0=w999f,w3,c9_9,zz\n' > "$T/save/save.dat"
printf 'expect level 2\nexpect mode 1\nexpect dex 1\nexpect missed0 0\n' > "$T/save.txt"
./build/sim/wwsim "$T/save" "$T/save.txt" "$T/save"                # damaged save.dat
rm -rf "$T"
echo "ALL TESTS PASSED"
