/*
 * render.c - drawing primitives on the RGB565 pixel buffer.
 *
 * These are the prototype's helpers rewritten for a raw frame buffer:
 *   R()  = fillRect             E() = the prototype's per-pixel ellipse
 *   r_sprite() = drawImage scaled with nearest neighbour (imageSmoothing off)
 * plus alpha blending for the CSS opacity effects, an integer sine table and
 * a bit-exact copy of the prototype's hh() hash (used for grass specks).
 * No floating point anywhere.
 */
#include "ww.h"

static u16 screen[W * H];
u16 *fb = screen;
static u16 *tgt = screen;
static int tw = W, th = H;

void r_set_target(u16 *pix, int w, int h) { tgt = pix; tw = w; th = h; }
void r_reset_target(void) { tgt = fb; tw = W; th = H; }

void R(int x, int y, int w, int h, u16 c)
{
    int i, j;
    u16 *p;
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > tw) w = tw - x;
    if (y + h > th) h = th - y;
    if (w <= 0 || h <= 0) return;
    for (j = 0; j < h; j++) {
        p = tgt + (y + j) * tw + x;
        for (i = 0; i < w; i++) p[i] = c;
    }
}

u16 blend(u16 d, u16 s, int a)
{
    int r, g, b;
    if (a >= 256) return s;
    if (a <= 0) return d;
    r = (d >> 11) + ((((s >> 11) - (d >> 11)) * a) >> 8);
    g = ((d >> 5) & 63) + (((((s >> 5) & 63) - ((d >> 5) & 63)) * a) >> 8);
    b = (d & 31) + ((((s & 31) - (d & 31)) * a) >> 8);
    return (u16)((r << 11) | (g << 5) | b);
}

void RA(int x, int y, int w, int h, u16 c, int a)
{
    int i, j;
    u16 *p;
    if (a >= 256) { R(x, y, w, h, c); return; }
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > tw) w = tw - x;
    if (y + h > th) h = th - y;
    if (w <= 0 || h <= 0 || a <= 0) return;
    for (j = 0; j < h; j++) {
        p = tgt + (y + j) * tw + x;
        for (i = 0; i < w; i++) p[i] = blend(p[i], c, a);
    }
}

void r_frame(int x, int y, int w, int h, int t, u16 c)
{
    R(x, y, w, t, c);
    R(x, y + h - t, w, t, c);
    R(x, y + t, t, h - 2 * t, c);
    R(x + w - t, y + t, t, h - 2 * t, c);
}

/* prototype: for j,i in [-r..r]: if i*i/(rx*rx)+j*j/(ry*ry)<=1 fillRect(cx+i,cy+j,1,1) */
void E(int cx, int cy, int rx, int ry, u16 c)
{
    int i, j;
    long lim = (long)rx * rx * ry * ry;
    for (j = -ry; j <= ry; j++) {
        int y = cy + j;
        if (y < 0 || y >= th) continue;
        for (i = -rx; i <= rx; i++) {
            int x = cx + i;
            if (x < 0 || x >= tw) continue;
            if ((long)i * i * ry * ry + (long)j * j * rx * rx <= lim) tgt[y * tw + x] = c;
        }
    }
}

/* vertical gradient between two colours over rows y0..y1-1, positions use pixel centres
   (CSS linear-gradient). Interpolates in 8-bit RGB, then converts to RGB565. */
void r_vgrad(int y0, int y1, u32 c0, u32 c1)
{
    int y, n = y1 - y0;
    for (y = y0; y < y1; y++) {
        int t = ((y - y0) * 2 + 1) * 256 / (2 * n);   /* 0..256 */
        int r = ((c0 >> 16) & 255) + ((((int)(c1 >> 16) & 255) - (int)((c0 >> 16) & 255)) * t >> 8);
        int g = ((c0 >> 8) & 255) + ((((int)(c1 >> 8) & 255) - (int)((c0 >> 8) & 255)) * t >> 8);
        int b = (c0 & 255) + ((((int)c1 & 255) - (int)(c0 & 255)) * t >> 8);
        R(0, y, tw, 1, C565(((u32)r << 16) | ((u32)g << 8) | (u32)b));
    }
}

void r_blit(const u16 *src, int sw, int sh, int dx, int dy)
{
    int j, i;
    for (j = 0; j < sh; j++) {
        int y = dy + j;
        const u16 *s = src + j * sw;
        u16 *d;
        if (y < 0 || y >= th) continue;
        d = tgt + y * tw;
        for (i = 0; i < sw; i++) {
            int x = dx + i;
            if (x >= 0 && x < tw) d[x] = s[i];
        }
    }
}

/* 32x32 sprite drawn as size x size at (dx,dy), nearest neighbour.
   mode 1: CSS "filter:brightness(0);opacity:a" = black silhouette blended. */
void r_sprite(const u16 *pix, const u8 *mask, int dx, int dy, int size, int mode, int a)
{
    int i, j;
    if (size <= 0) return;
    for (j = 0; j < size; j++) {
        int y = dy + j, sy;
        if (y < 0 || y >= th) continue;
        sy = ((2 * j + 1) * 32) / (2 * size);
        for (i = 0; i < size; i++) {
            int x = dx + i, sx, k;
            if (x < 0 || x >= tw) continue;
            sx = ((2 * i + 1) * 32) / (2 * size);
            k = sy * 32 + sx;
            if (!mask[k]) continue;
            if (mode == 0) tgt[y * tw + x] = pix[k];
            else tgt[y * tw + x] = blend(tgt[y * tw + x], 0, a);
        }
    }
}

/* ---- integer trigonometry: quarter sine table, Q14, 1024 steps per turn ---- */
static const short sin_q[257] = {
    0, 101, 201, 302, 402, 503, 603, 704, 804, 904, 1005, 1105, 1205, 1306, 1406, 1506,
    1606, 1706, 1806, 1906, 2006, 2105, 2205, 2305, 2404, 2503, 2603, 2702, 2801, 2900, 2999, 3098,
    3196, 3295, 3393, 3492, 3590, 3688, 3786, 3883, 3981, 4078, 4176, 4273, 4370, 4467, 4563, 4660,
    4756, 4852, 4948, 5044, 5139, 5235, 5330, 5425, 5520, 5614, 5708, 5803, 5897, 5990, 6084, 6177,
    6270, 6363, 6455, 6547, 6639, 6731, 6823, 6914, 7005, 7096, 7186, 7276, 7366, 7456, 7545, 7635,
    7723, 7812, 7900, 7988, 8076, 8163, 8250, 8337, 8423, 8509, 8595, 8680, 8765, 8850, 8935, 9019,
    9102, 9186, 9269, 9352, 9434, 9516, 9598, 9679, 9760, 9841, 9921, 10001, 10080, 10159, 10238, 10316,
    10394, 10471, 10549, 10625, 10702, 10778, 10853, 10928, 11003, 11077, 11151, 11224, 11297, 11370, 11442, 11514,
    11585, 11656, 11727, 11797, 11866, 11935, 12004, 12072, 12140, 12207, 12274, 12340, 12406, 12472, 12537, 12601,
    12665, 12729, 12792, 12854, 12916, 12978, 13039, 13100, 13160, 13219, 13279, 13337, 13395, 13453, 13510, 13567,
    13623, 13678, 13733, 13788, 13842, 13896, 13949, 14001, 14053, 14104, 14155, 14206, 14256, 14305, 14354, 14402,
    14449, 14497, 14543, 14589, 14635, 14680, 14724, 14768, 14811, 14854, 14896, 14937, 14978, 15019, 15059, 15098,
    15137, 15175, 15213, 15250, 15286, 15322, 15357, 15392, 15426, 15460, 15493, 15525, 15557, 15588, 15619, 15649,
    15679, 15707, 15736, 15763, 15791, 15817, 15843, 15868, 15893, 15917, 15941, 15964, 15986, 16008, 16029, 16049,
    16069, 16088, 16107, 16125, 16143, 16160, 16176, 16192, 16207, 16221, 16235, 16248, 16261, 16273, 16284, 16295,
    16305, 16315, 16324, 16332, 16340, 16347, 16353, 16359, 16364, 16369, 16373, 16376, 16379, 16381, 16383, 16384,
    16384
};

int isin(int a)
{
    a &= 1023;
    if (a < 256) return sin_q[a];
    if (a < 512) return sin_q[512 - a];
    if (a < 768) return -sin_q[a - 512];
    return -sin_q[1024 - a];
}
int icos(int a) { return isin(a + 256); }

/* ---- hh(): bit-exact port of
   hh=(x,y,k)=>{let n=(x*374761393+y*668265263+k*2147483647)|0;
                n=(n^(n>>>13))*1274126177|0;return (n^(n>>>16))>>>0}
   The multiplication happens in doubles in JavaScript: the exact 62-bit
   product is first rounded to 53 significant bits, then wrapped to 32 bits.
   We reproduce that rounding with 64-bit integers. */
static long long round53(long long p)
{
    unsigned long long a = p < 0 ? (unsigned long long)(-p) : (unsigned long long)p;
    int bits = 0, sh;
    unsigned long long t = a, half, rem, q;
    while (t) { bits++; t >>= 1; }
    if (bits <= 53) return p;
    sh = bits - 53;
    q = a >> sh;
    rem = a & ((1ULL << sh) - 1);
    half = 1ULL << (sh - 1);
    if (rem > half || (rem == half && (q & 1))) q++;      /* round half to even */
    a = q << sh;
    return p < 0 ? -(long long)a : (long long)a;
}

u32 hh(int x, int y, int k)
{
    long long s = (long long)x * 374761393LL + (long long)y * 668265263LL + (long long)k * 2147483647LL;
    int n = (int)(u32)(unsigned long long)s;
    int a = n ^ (int)((u32)n >> 13);
    long long p = round53((long long)a * 1274126177LL);
    n = (int)(u32)(unsigned long long)p;
    return (u32)(n ^ (int)((u32)n >> 16));
}

/* ---- CSS group opacity: an element (box + text) drawn at opacity a is
   blended as a whole over what was underneath. Save the area, draw the
   element opaque, then mix it with the saved pixels. ---- */
#define GMAX (W * 96)
static u16 gsave[GMAX];
static int gx, gy, gw, gh;

void r_group_begin(int x, int y, int w, int h)
{
    int j;
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > W) w = W - x;
    if (y + h > H) h = H - y;
    if (w < 0) w = 0;
    if (h < 0) h = 0;
    if (w * h > GMAX) h = GMAX / (w ? w : 1);
    gx = x; gy = y; gw = w; gh = h;
    for (j = 0; j < h; j++) {
        int i;
        for (i = 0; i < w; i++) gsave[j * w + i] = fb[(y + j) * W + x + i];
    }
}

void r_group_end(int a)
{
    int j, i;
    for (j = 0; j < gh; j++)
        for (i = 0; i < gw; i++) {
            u16 *p = &fb[(gy + j) * W + gx + i];
            *p = blend(gsave[j * gw + i], *p, a);
        }
}
