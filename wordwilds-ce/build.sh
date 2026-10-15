#!/bin/sh
# build.sh - build WordWilds.
#
#   ./build.sh          all targets
#   ./build.sh ce       Windows CE / ARM (Dell Axim X5)  -> build/ce/wordwilds.exe
#   ./build.sh pc       Windows PC test build (i686)     -> build/pc/wordwilds-pc.exe
#   ./build.sh sim      Linux headless test harness      -> build/sim/wwsim
#
# After the CE build the executable is checked: it must be a PE32 for
# Windows CE on ARM, import only COREDLL.dll and contain no floating-point
# helper routines. The data files are copied next to each executable.
set -e
cd "$(dirname "$0")"
PATH=/opt/mingw32ce/bin:$PATH

CORE="src/render.c src/font.c src/sprites.c src/data.c src/save.c src/sound.c src/game.c src/battle.c"
DATA="data/words.csv data/sentences.csv data/creatures.csv data/dialog.txt"
WARN="-Wall -Wextra -Wno-unused-parameter -Wno-missing-field-initializers"
what=${1:-all}

build_ce() {
    echo "== Windows CE (ARM) build"
    mkdir -p build/ce
    arm-mingw32ce-gcc -O2 -march=armv5te -mtune=xscale $WARN -Werror=implicit-function-declaration \
        -D_WIN32_WCE=0x0420 -DUNICODE -D_UNICODE \
        -o build/ce/wordwilds.exe src/main.c $CORE -Wl,--major-subsystem-version=4,--minor-subsystem-version=20
    arm-mingw32ce-strip build/ce/wordwilds.exe
    cp $DATA build/ce/
    echo "== checking build/ce/wordwilds.exe"
    file build/ce/wordwilds.exe
    file build/ce/wordwilds.exe | grep -q "PE32 executable (Windows CE) ARM" \
        || { echo "ERROR: not a Windows CE ARM PE executable"; exit 1; }
    arm-mingw32ce-objdump -f build/ce/wordwilds.exe | grep -E "file format|architecture"
    arm-mingw32ce-objdump -f build/ce/wordwilds.exe | grep -q "pei-arm-wince-little" \
        || { echo "ERROR: objdump does not see a pei-arm-wince image"; exit 1; }
    dlls=$(arm-mingw32ce-objdump -p build/ce/wordwilds.exe | sed -n 's/.*DLL Name: //p' | sort -u | tr '\n' ' ')
    echo "imported DLLs: $dlls"
    [ "$dlls" = "COREDLL.dll " ] || [ "$dlls" = "COREDLL " ] \
        || { echo "ERROR: must import only coredll.dll"; exit 1; }
    arm-mingw32ce-objdump -p build/ce/wordwilds.exe | grep -E "Subsystem|SubsystemVersion"
    # no soft-float helpers (__adddf3, __aeabi_dmul, __floatsisf, ...) may be linked in
    mkdir -p build/obj
    arm-mingw32ce-gcc -O2 -march=armv5te -mtune=xscale -D_WIN32_WCE=0x0420 -DUNICODE -D_UNICODE \
        -o build/obj/wordwilds-syms.exe src/main.c $CORE
    if arm-mingw32ce-nm build/obj/wordwilds-syms.exe | grep -Ei " (__(add|sub|mul|div|float|fix|extend|trunc|cmp|eq|ne|lt|le|gt|ge|un)[a-z]*(sf|df)[a-z0-9]*|__aeabi_[fd][a-z0-9]*)$"; then
        echo "ERROR: floating point code found"; exit 1
    fi
    echo "no floating-point routines: OK"
    ls -l build/ce/wordwilds.exe
}

build_pc() {
    echo "== Windows PC build (same code, i686-w64-mingw32)"
    mkdir -p build/pc
    i686-w64-mingw32-gcc -O2 $WARN -DWW_PC -DUNICODE -D_UNICODE -mwindows \
        -o build/pc/wordwilds-pc.exe src/main.c $CORE -lwinmm
    cp $DATA build/pc/
    file build/pc/wordwilds-pc.exe
}

build_sim() {
    echo "== Linux test harness"
    mkdir -p build/sim
    gcc -O1 -g -fshort-wchar $WARN -Wno-pointer-sign -o build/sim/wwsim src/sim.c $CORE
    cp $DATA build/sim/
    echo "build/sim/wwsim"
}

case $what in
    ce) build_ce ;;
    pc) build_pc ;;
    sim) build_sim ;;
    all) build_sim; build_pc; build_ce ;;
    *) echo "usage: $0 [ce|pc|sim|all]"; exit 2 ;;
esac
