/*
 * save.c - progress in save.dat next to the exe (plain text, ASCII):
 *
 *   WWSAVE 1
 *   level=1
 *   mode=0
 *   sound=1
 *   dex=applet,keyko
 *   missed0=w3f,w12e
 *   missed1=c1_4
 *   missed2=
 *
 * Wordex entries are creature ids (like the prototype's localStorage), missed
 * questions use the prototype's specKey(): "w<i><f|e>" or "c<lvl>_<i>".
 * Unknown or out-of-range values are dropped; a damaged file never crashes
 * the game, it just falls back to the defaults.
 */
#include "ww.h"
#include "plat.h"

static char buf[16384];

static int put(char *d, int n, int max, const char *s)
{
    while (*s && n < max - 1) d[n++] = *s++;
    return n;
}
static int put_int(char *d, int n, int max, int v)
{
    char t[12];
    int i = 11;
    t[i] = 0;
    if (v == 0) t[--i] = '0';
    while (v > 0) { t[--i] = (char)('0' + v % 10); v /= 10; }
    return put(d, n, max, t + i);
}
static int put_w(char *d, int n, int max, const wch *s)
{
    while (*s && n < max - 1) { d[n++] = (*s < 128) ? (char)*s : '?'; s++; }
    return n;
}

void save_game(void)
{
    int n = 0, i, l, max = (int)sizeof buf;
    n = put(buf, n, max, "WWSAVE 1\r\nlevel=");
    n = put_int(buf, n, max, S.level);
    n = put(buf, n, max, "\r\nmode=");
    n = put_int(buf, n, max, S.mode);
    n = put(buf, n, max, "\r\nsound=");
    n = put_int(buf, n, max, !S.muted);
    n = put(buf, n, max, "\r\ndex=");
    for (i = 0, l = 0; i < ncre; i++) if (S.dex[i]) {
        if (l++) n = put(buf, n, max, ",");
        n = put_w(buf, n, max, cre[i].id);
    }
    for (l = 0; l < 3; l++) {
        n = put(buf, n, max, "\r\nmissed");
        n = put_int(buf, n, max, l);
        n = put(buf, n, max, "=");
        for (i = 0; i < S.nmissed[l]; i++) {
            Spec *s = &S.missed[l][i];
            if (i) n = put(buf, n, max, ",");
            if (s->t == 'w') {
                n = put(buf, n, max, "w");
                n = put_int(buf, n, max, s->i);
                n = put(buf, n, max, s->dir ? "f" : "e");
            } else {
                n = put(buf, n, max, "c");
                n = put_int(buf, n, max, s->lvl);
                n = put(buf, n, max, "_");
                n = put_int(buf, n, max, s->i);
            }
        }
    }
    n = put(buf, n, max, "\r\n");
    plat_write(L"save.dat", buf, n);
}

/* ---- loading ---- */
static int num(const char **pp, const char *end, int *v)
{
    const char *p = *pp;
    int n = 0, any = 0;
    while (p < end && *p >= '0' && *p <= '9' && n < 100000) { n = n * 10 + (*p - '0'); p++; any = 1; }
    *pp = p;
    *v = n;
    return any;
}

static int idmatch(const char *a, int n, const wch *id)
{
    int i;
    for (i = 0; i < n; i++) if (!id[i] || (wch)(unsigned char)a[i] != id[i]) return 0;
    return id[n] == 0;
}

static void parse_missed(int l, const char *p, const char *end)
{
    S.nmissed[l] = 0;
    while (p < end) {
        Spec s;
        int a, b, ok = 0;
        s.t = 0; s.dir = 0; s.lvl = 0; s.i = 0;
        if (*p == 'w') {
            p++;
            if (num(&p, end, &a) && p < end && (*p == 'f' || *p == 'e') && a < nwords && l == 0) {
                s.t = 'w'; s.i = (u16)a; s.dir = (u8)(*p == 'f'); ok = 1;
            }
            if (p < end && (*p == 'f' || *p == 'e')) p++;
        } else if (*p == 'c') {
            p++;
            if (num(&p, end, &a) && p < end && *p == '_') {
                p++;
                if (num(&p, end, &b) && a == l && a >= 1 && a <= 2 && b < nsents[a]) {
                    s.t = 'c'; s.lvl = (u8)a; s.i = (u16)b; ok = 1;
                }
            }
        }
        if (ok && S.nmissed[l] < MAXMISSED) S.missed[l][S.nmissed[l]++] = s;
        while (p < end && *p != ',') p++;
        if (p < end) p++;
    }
}

static int memcmp_w(const char *a, const char *b, int n)
{
    int i;
    for (i = 0; i < n; i++) if (a[i] != b[i]) return 1;
    return 0;
}

void load_game(void)
{
    int n = plat_read(L"save.dat", buf, (int)sizeof buf - 1), v;
    const char *p = buf, *end;
    if (n <= 8 || n >= (int)sizeof buf - 1) return;
    end = buf + n;
    if (buf[0] != 'W' || buf[1] != 'W' || buf[2] != 'S') return;
    while (p < end) {
        const char *e = p, *val;
        while (e < end && *e != '\r' && *e != '\n') e++;
        val = p;
        while (val < e && *val != '=') val++;
        if (val < e) {
            int klen = (int)(val - p);
            const char *q = val + 1;
            if (klen == 5 && !memcmp_w(p, "level", 5) && num(&q, e, &v)) S.level = v > 2 ? 2 : v;
            else if (klen == 4 && !memcmp_w(p, "mode", 4) && num(&q, e, &v)) S.mode = v > 2 ? 2 : v;
            else if (klen == 5 && !memcmp_w(p, "sound", 5) && num(&q, e, &v)) S.muted = !v;
            else if (klen == 3 && !memcmp_w(p, "dex", 3)) {
                while (q < e) {
                    const char *c = q;
                    int i;
                    while (c < e && *c != ',') c++;
                    for (i = 0; i < ncre; i++) if (idmatch(q, (int)(c - q), cre[i].id)) S.dex[i] = 1;
                    q = c < e ? c + 1 : c;
                }
            } else if (klen == 7 && !memcmp_w(p, "missed", 6) && p[6] >= '0' && p[6] <= '2')
                parse_missed(p[6] - '0', q, e);
        }
        p = e;
        while (p < end && (*p == '\r' || *p == '\n')) p++;
    }
}
