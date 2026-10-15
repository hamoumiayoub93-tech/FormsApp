#!/bin/sh
# install-cegcc.sh - install the prebuilt cegcc / mingw32ce 0.59.1 toolchain
# (arm-mingw32ce-gcc 4.4.0) on Ubuntu/Debian x86_64, natively or under WSL.
#
# The prebuilt toolchain is a 32-bit (i386) Linux build from 2009. It needs:
#   - the i386 C runtime (multiarch)
#   - libgmp.so.3 and libmpfr.so.1, which current distributions no longer
#     ship. They are taken from the original Ubuntu packages on
#     old-releases.ubuntu.com and unpacked into /opt/mingw32ce/compat-lib.
#
# Optional (for the PC test builds): mingw-w64 and wine.
# Run as root (or with sudo).
set -e

SF=https://sourceforge.net/projects/cegcc/files/cegcc/0.59.1
OLD=http://old-releases.ubuntu.com/ubuntu/pool/main
TMP=${TMPDIR:-/tmp}/cegcc-install.$$
mkdir -p "$TMP"
cd "$TMP"

echo "== i386 runtime"
dpkg --add-architecture i386
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y libc6:i386 zlib1g:i386 libstdc++6:i386 curl bzip2

echo "== cegcc mingw32ce 0.59.1 (prebuilt, from SourceForge)"
if [ ! -x /opt/mingw32ce/bin/arm-mingw32ce-gcc ]; then
    curl -fL -o mingw32ce-0.59.1.tar.bz2 "$SF/mingw32ce-0.59.1.tar.bz2/download"
    tar xjf mingw32ce-0.59.1.tar.bz2 -C /
fi

echo "== legacy libgmp.so.3 / libmpfr.so.1 (i386)"
mkdir -p /opt/mingw32ce/compat-lib
for deb in g/gmp/libgmp3c2_4.3.2+dfsg-1ubuntu1_i386.deb \
           m/mpfr/libmpfr1ldbl_2.4.2-3ubuntu1_i386.deb; do
    curl -fL -o pkg.deb "$OLD/$deb"
    rm -rf x && mkdir x && dpkg-deb -x pkg.deb x
    cp -a x/usr/lib/lib*.so.* /opt/mingw32ce/compat-lib/
done
echo /opt/mingw32ce/compat-lib > /etc/ld.so.conf.d/mingw32ce-compat.conf
ldconfig

echo "== optional PC test tools: mingw-w64, wine, Xvfb"
DEBIAN_FRONTEND=noninteractive apt-get install -y gcc-mingw-w64-i686 || true
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    wine wine32:i386 xvfb imagemagick || true

rm -rf "$TMP"
/opt/mingw32ce/bin/arm-mingw32ce-gcc --version | head -1
echo "OK. Add /opt/mingw32ce/bin to PATH (build.sh does it for you)."
