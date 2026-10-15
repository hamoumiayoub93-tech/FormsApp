/*
 * font.c - built-in proportional pixel font (replaces "Pixelify Sans").
 *
 * Glyph cell: up to 7 columns x 10 rows.
 *   row 0      accent on capitals (É, À...)
 *   rows 1-7   capitals and digits (cap height 7)
 *   rows 3-7   lowercase x-height (accents on lowercase sit in rows 1-2)
 *   rows 8-9   descenders (g j p q y , ç)
 * The art below lists rows 1..9 separated by '/', '#' = ink. The width of a
 * glyph is the length of its rows. Accented letters are composed at start-up
 * from the base letter and an accent pattern.
 * Text can be drawn scaled (x1..x4) and bold (ink doubled one pixel right).
 */
#include "ww.h"

typedef struct { u16 code; const char *art; } GlyphArt;

static const GlyphArt ART[] = {
    {'A', ".###./#...#/#...#/#####/#...#/#...#/#...#"},
    {'B', "####./#...#/#...#/####./#...#/#...#/####."},
    {'C', ".###./#...#/#..../#..../#..../#...#/.###."},
    {'D', "####./#...#/#...#/#...#/#...#/#...#/####."},
    {'E', "#####/#..../#..../####./#..../#..../#####"},
    {'F', "#####/#..../#..../####./#..../#..../#...."},
    {'G', ".###./#...#/#..../#.###/#...#/#...#/.####"},
    {'H', "#...#/#...#/#...#/#####/#...#/#...#/#...#"},
    {'I', "###/.#./.#./.#./.#./.#./###"},
    {'J', "..##/...#/...#/...#/#..#/#..#/.##."},
    {'K', "#...#/#..#./#.#../##.../#.#../#..#./#...#"},
    {'L', "#.../#.../#.../#.../#.../#.../####"},
    {'M', "#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#"},
    {'N', "#...#/##..#/#.#.#/#..##/#...#/#...#/#...#"},
    {'O', ".###./#...#/#...#/#...#/#...#/#...#/.###."},
    {'P', "####./#...#/#...#/####./#..../#..../#...."},
    {'Q', ".###./#...#/#...#/#...#/#.#.#/#..#./.##.#"},
    {'R', "####./#...#/#...#/####./#.#../#..#./#...#"},
    {'S', ".####/#..../#..../.###./....#/....#/####."},
    {'T', "#####/..#../..#../..#../..#../..#../..#.."},
    {'U', "#...#/#...#/#...#/#...#/#...#/#...#/.###."},
    {'V', "#...#/#...#/#...#/#...#/#...#/.#.#./..#.."},
    {'W', "#...#/#...#/#...#/#.#.#/#.#.#/#.#.#/.#.#."},
    {'X', "#...#/#...#/.#.#./..#../.#.#./#...#/#...#"},
    {'Y', "#...#/#...#/.#.#./..#../..#../..#../..#.."},
    {'Z', "#####/....#/...#./..#../.#.../#..../#####"},
    {'a', "..../..../.##./...#/.###/#..#/.###"},
    {'b', "#.../#.../###./#..#/#..#/#..#/###."},
    {'c', "..../..../.###/#.../#.../#.../.###"},
    {'d', "...#/...#/.###/#..#/#..#/#..#/.###"},
    {'e', "..../..../.##./#..#/####/#.../.###"},
    {'f', "..##/.#../###./.#../.#../.#../.#.."},
    {'g', "..../..../.###/#..#/#..#/#..#/.###/...#/.##."},
    {'h', "#.../#.../###./#..#/#..#/#..#/#..#"},
    {'i', "#/./#/#/#/#/#"},
    {'j', "..#/.../..#/..#/..#/..#/..#/#.#/.#."},
    {'k', "#.../#.../#..#/#.#./##../#.#./#..#"},
    {'l', "#./#./#./#./#./#./.#"},
    {'m', "...../...../####./#.#.#/#.#.#/#.#.#/#.#.#"},
    {'n', "..../..../###./#..#/#..#/#..#/#..#"},
    {'o', "..../..../.##./#..#/#..#/#..#/.##."},
    {'p', "..../..../###./#..#/#..#/#..#/###./#.../#..."},
    {'q', "..../..../.###/#..#/#..#/#..#/.###/...#/...#"},
    {'r', "..../..../#.##/##../#.../#.../#..."},
    {'s', "..../..../.###/#.../.##./...#/###."},
    {'t', ".#../.#../###./.#../.#../.#../..##"},
    {'u', "..../..../#..#/#..#/#..#/#..#/.###"},
    {'v', "...../...../#...#/#...#/.#.#./.#.#./..#.."},
    {'w', "...../...../#...#/#.#.#/#.#.#/#.#.#/.#.#."},
    {'x', "..../..../#..#/#..#/.##./#..#/#..#"},
    {'y', "..../..../#..#/#..#/#..#/#..#/.###/...#/.##."},
    {'z', "..../..../####/...#/.##./#.../####"},
    {'0', ".##./#..#/#.##/##.#/#..#/#..#/.##."},
    {'1', ".#./##./.#./.#./.#./.#./###"},
    {'2', ".##./#..#/...#/..#./.#../#.../####"},
    {'3', "###./...#/...#/.##./...#/...#/###."},
    {'4', "#..#/#..#/#..#/####/...#/...#/...#"},
    {'5', "####/#.../#.../###./...#/...#/###."},
    {'6', ".##./#.../#.../###./#..#/#..#/.##."},
    {'7', "####/...#/..#./..#./.#../.#../.#.."},
    {'8', ".##./#..#/#..#/.##./#..#/#..#/.##."},
    {'9', ".##./#..#/#..#/.###/...#/...#/.##."},
    {'!', "#/#/#/#/#/./#"},
    {'"', "#.#/#.#"},
    {'#', "...../.#.#./#####/.#.#./#####/.#.#."},
    {'$', "..#../.####/#.#../.###./..#.#/####./..#.."},
    {'%', "...../##..#/##.#./..#../.#.##/#..##"},
    {'&', ".#.../#.#../#.#../.#.../#.#.#/#..#./.##.#"},
    {'\'', "#/#"},
    {'(', ".#/#./#./#./#./#./.#"},
    {')', "#./.#/.#/.#/.#/.#/#."},
    {'*', ".../.../#.#/.#./#.#"},
    {'+', ".../.../.#./###/.#."},
    {',', "../../../../../../.#/#."},
    {'-', ".../.../.../.../###"},
    {'.', "././././././#"},
    {'/', "...#/...#/..#./..#./.#../#.../#..."},
    {':', "./././#/././#"},
    {';', "../../../.#/../../.#/#."},
    {'<', "..../...#/..#./.#../..#./...#"},
    {'=', "..../..../####/..../####"},
    {'>', "..../#.../.#../..#./.#../#..."},
    {'?', ".###./#...#/....#/...#./..#../...../..#.."},
    {'@', ".###./#...#/#.###/#.#.#/#.###/#..../.###."},
    {'[', "##/#./#./#./#./#./##"},
    {'\\', "#.../#.../.#../..#./..#./...#/...#"},
    {']', "##/.#/.#/.#/.#/.#/##"},
    {'^', ".#./#.#"},
    {'_', "..../..../..../..../..../..../..../####"},
    {'`', "#./.#"},
    {'{', "..#/.#./.#./#../.#./.#./..#"},
    {'|', "#/#/#/#/#/#/#/#"},
    {'}', "#../.#./.#./..#/.#./.#./#.."},
    {'~', "..../..../..../.#.#/#.#."},
    {0x00B7, "././././#"},                    /* middle dot (hearts, HUD) */
    {0x2013, "..../..../..../..../####"},     /* en dash */
    {0x2014, "....../....../....../....../######"},
    {0x2018, ".#/#./#."},                     /* ' */
    {0x2019, ".#/.#/#."},                     /* ' */
    {0x201C, ".#.#/#.#./#.#."},               /* " */
    {0x201D, ".#.#/.#.#/#.#."},               /* " */
    {0x00AB, "...../...../.#.#./#.#../.#.#."}, /* << */
    {0x00BB, "...../...../.#.#./..#.#/.#.#."}, /* >> */
    {0x2026, "...../...../...../...../...../...../#.#.#"},
    {0x00B0, ".#./#.#/.#."},
    {0x0153, "......./......./.##.##./#..#..#/#..####/#..#.../.##.###"}, /* oe */
    {0x0152, ".######/#..#.../#..#.../#..###./#..#.../#..#.../.######"}, /* OE */
    {0x00E6, "......./......./.##.##./...#..#/.######/#..#.../.##.###"}, /* ae */
    {0x00DF, ".##./#..#/#..#/#.#./#..#/#..#/#.#."},
    {0x2665, "......./.##.##./#######/#######/.#####./..###../...#..."}, /* heart */
    {0x2713, "...../...../....#/...#./#.#../.#.../....."},  /* check mark */
    {0x2717, "...../...../#...#/.#.#./..#../.#.#./#...#"},  /* ballot x */
    {0x25B8, ".../.../#../##./###/##./#.."},  /* small right triangle */
    {0x0131, "././#/#/#/#/#"},              /* dotless i (accent base) */
    {0x20AC, ".###/#.../####/#.../####/#.../.###"},
};
#define NART (int)(sizeof ART / sizeof ART[0])

/* accent compositions: code, base, accent (A acute, G grave, C circumflex,
   D diaeresis, T tilde, R ring, Z cedilla) */
static const struct { u16 code, base; char acc; } COMP[] = {
    {0xE0, 'a', 'G'}, {0xE1, 'a', 'A'}, {0xE2, 'a', 'C'}, {0xE3, 'a', 'T'}, {0xE4, 'a', 'D'}, {0xE5, 'a', 'R'},
    {0xE7, 'c', 'Z'}, {0xE8, 'e', 'G'}, {0xE9, 'e', 'A'}, {0xEA, 'e', 'C'}, {0xEB, 'e', 'D'},
    {0xEC, 0x131, 'G'}, {0xED, 0x131, 'A'}, {0xEE, 0x131, 'C'}, {0xEF, 0x131, 'D'},
    {0xF1, 'n', 'T'}, {0xF2, 'o', 'G'}, {0xF3, 'o', 'A'}, {0xF4, 'o', 'C'}, {0xF5, 'o', 'T'}, {0xF6, 'o', 'D'},
    {0xF9, 'u', 'G'}, {0xFA, 'u', 'A'}, {0xFB, 'u', 'C'}, {0xFC, 'u', 'D'}, {0xFF, 'y', 'D'},
    {0xC0, 'A', 'G'}, {0xC1, 'A', 'A'}, {0xC2, 'A', 'C'}, {0xC4, 'A', 'D'}, {0xC7, 'C', 'Z'},
    {0xC8, 'E', 'G'}, {0xC9, 'E', 'A'}, {0xCA, 'E', 'C'}, {0xCB, 'E', 'D'}, {0xCE, 'I', 'C'}, {0xCF, 'I', 'D'},
    {0xD4, 'O', 'C'}, {0xD6, 'O', 'D'}, {0xD9, 'U', 'G'}, {0xDB, 'U', 'C'}, {0xDC, 'U', 'D'}, {0xD1, 'N', 'T'},
};
#define NCOMP (int)(sizeof COMP / sizeof COMP[0])

typedef struct { u16 code; u8 w; u8 rows[10]; } Glyph;   /* bit c = column c */
static Glyph glyphs[NART + NCOMP];
static int nglyphs;
static short ascii_idx[128];

static int parse_art(const char *art, Glyph *g)
{
    int r = 1, c = 0, w = 0;
    const char *p;
    for (p = art; *p; p++) {
        if (*p == '/') { if (c > w) w = c; r++; c = 0; continue; }
        if (*p == '#' && r < 10) g->rows[r] |= (u8)(1 << c);
        c++;
    }
    if (c > w) w = c;
    g->w = (u8)w;
    return w;
}

static Glyph *find(u16 code)
{
    int i;
    if (code < 128) return ascii_idx[code] >= 0 ? &glyphs[ascii_idx[code]] : 0;
    for (i = 0; i < nglyphs; i++) if (glyphs[i].code == code) return &glyphs[i];
    return 0;
}

void font_init(void)
{
    int i, r;
    for (i = 0; i < 128; i++) ascii_idx[i] = -1;
    nglyphs = 0;
    for (i = 0; i < NART; i++) {
        Glyph *g = &glyphs[nglyphs];
        g->code = ART[i].code;
        for (r = 0; r < 10; r++) g->rows[r] = 0;
        parse_art(ART[i].art, g);
        if (g->code < 128) ascii_idx[g->code] = (short)nglyphs;
        nglyphs++;
    }
    for (i = 0; i < NCOMP; i++) {
        Glyph *b = find(COMP[i].base), *g = &glyphs[nglyphs];
        int cap = COMP[i].base < 128 && COMP[i].base >= 'A' && COMP[i].base <= 'Z';
        int w, off, ar0, ar1;          /* accent rows */
        u8 a0 = 0, a1 = 0;             /* accent pattern, 3 columns */
        if (!b) continue;
        *g = *b;
        g->code = COMP[i].code;
        switch (COMP[i].acc) {
        case 'A': a0 = 4; a1 = 2; break;      /* ..# / .#. */
        case 'G': a0 = 1; a1 = 2; break;      /* #.. / .#. */
        case 'C': a0 = 2; a1 = 5; break;      /* .#. / #.# */
        case 'D': a0 = 0; a1 = 5; break;      /* ... / #.# */
        case 'T': a0 = 6; a1 = 3; break;      /* .## / ##. */
        case 'R': a0 = 2; a1 = 2; break;
        case 'Z': a0 = 2; a1 = 1; break;      /* cedilla: below */
        }
        w = g->w < 3 ? 3 : g->w;
        if (w > g->w) {                       /* widen narrow bases (i) and centre them */
            int sh = (w - g->w) / 2;
            for (r = 0; r < 10; r++) g->rows[r] = (u8)(g->rows[r] << sh);
            g->w = (u8)w;
        }
        off = (w - 3) / 2;
        if (COMP[i].acc == 'Z') { ar0 = 8; ar1 = 9; }
        else if (cap) {                       /* capitals: one accent row above */
            ar0 = -1; ar1 = 0;
            a1 = (u8)(COMP[i].acc == 'A' ? 4 : COMP[i].acc == 'G' ? 1 : COMP[i].acc == 'C' ? 2 :
                      COMP[i].acc == 'T' ? 6 : 5);
        }
        else { ar0 = 1; ar1 = 2; }
        if (ar0 >= 0) g->rows[ar0] |= (u8)(a0 << off);
        g->rows[ar1] |= (u8)(a1 << off);
        nglyphs++;
    }
}

static const Glyph *glyph(wch c)
{
    const Glyph *g = find((u16)c);
    if (!g) g = find('?');
    return g;
}

/* gap mode: "___" in a question is drawn as a 34 px yellow underline (<u>) */
int font_gap;

/* advance in pixels; bold ink is one pixel wider at any scale */
static int adv(wch c, int bold, int scale)
{
    if (c == ' ') return 3 * scale;
    if (font_gap && c == '_') return 11 * scale;
    return (glyph(c)->w + 1) * scale + bold;
}

int wlen(const wch *s) { int n = 0; while (s[n]) n++; return n; }

void wcopy(wch *d, const wch *s, int max)
{
    int i = 0;
    while (s[i] && i < max - 1) { d[i] = s[i]; i++; }
    d[i] = 0;
}
void wcat(wch *d, const wch *s, int max)
{
    int n = wlen(d);
    wcopy(d + n, s, max - n);
}
void wcat_int(wch *d, int v, int max)
{
    wch tmp[12];
    int i = 11;
    tmp[i] = 0;
    if (v == 0) tmp[--i] = '0';
    while (v > 0 && i > 0) { tmp[--i] = (wch)('0' + v % 10); v /= 10; }
    wcat(d, tmp + i, max);
}

/* width of n chars; the first nbold chars of the string are bold */
static int measure(const wch *s, int n, int scale, int nbold)
{
    int i, w = 0;
    for (i = 0; i < n; i++) w += adv(s[i], i < nbold, scale);
    if (n > 0 && s[n - 1] != ' ' && !(font_gap && s[n - 1] == '_')) w -= scale;   /* no spacing after the last glyph */
    return w;
}

int text_w(const wch *s, int n, int scale, int bold)
{
    if (n < 0) n = wlen(s);
    return measure(s, n, scale, bold ? 0x7fff : 0);
}

/* draws a line of text, y = top of the 10-row cell; first nbold chars bold in colour cb */
static int text_rich(int x, int y, const wch *s, int n, u16 c, u16 cb, int scale, int nbold)
{
    int i, x0 = x;
    for (i = 0; i < n; i++) {
        const Glyph *g;
        int r, col, bold = i < nbold;
        if (s[i] == ' ') { x += 3 * scale; continue; }
        if (font_gap && s[i] == '_') {
            R(x, y + 8 * scale, 11 * scale, 2, C565(0xffcf4a));
            x += 11 * scale;
            continue;
        }
        g = glyph(s[i]);
        for (r = 0; r < 10; r++) {
            u8 bits = g->rows[r];
            if (!bits) continue;
            for (col = 0; col < g->w; col++) {
                if (!(bits & (1 << col))) continue;
                R(x + col * scale, y + r * scale, scale + bold, scale, bold ? cb : c);
            }
        }
        x += adv(s[i], bold, scale);
    }
    return x - x0;
}

int text(int x, int y, const wch *s, int n, u16 c, int scale, int bold)
{
    if (n < 0) n = wlen(s);
    return text_rich(x, y, s, n, c, c, scale, bold ? 0x7fff : 0);
}

/* greedy word wrap on spaces (like the browser's), long words are kept whole.
   nbold counts from the start of s. */
static int wrap_rich(const wch *s, int maxw, int scale, int nbold, const wch **starts, int *lens, int maxlines)
{
    int n = 0;
    const wch *p = s;
    while (*p && n < maxlines) {
        const wch *line = p, *best = 0, *q = p;
        int nb = nbold - (int)(line - s);
        for (;;) {
            const wch *e = q;
            while (*e && *e != ' ') e++;                   /* end of word */
            if (best && measure(line, (int)(e - line), scale, nb) > maxw) break;
            best = e;
            if (!*e) break;
            q = e + 1;
        }
        starts[n] = line;
        lens[n] = (int)(best - line);
        n++;
        p = best;
        while (*p == ' ') p++;
    }
    return n;
}

int wrap(const wch *s, int maxw, int scale, int bold, const wch **starts, int *lens, int maxlines)
{
    return wrap_rich(s, maxw, scale, bold ? 0x7fff : 0, starts, lens, maxlines);
}

int para_rich(int x, int y, int w, const wch *s, int nbold, u16 c, u16 cb, int scale, int lh, int align, int maxlines)
{
    const wch *st[16];
    int ln[16], n, i;
    if (maxlines > 16) maxlines = 16;
    n = wrap_rich(s, w, scale, nbold, st, ln, maxlines);
    for (i = 0; i < n; i++) {
        int nb = nbold - (int)(st[i] - s), lx = x;
        if (align == 1) lx = x + (w - measure(st[i], ln[i], scale, nb)) / 2;
        text_rich(lx, y + i * lh, st[i], ln[i], c, cb, scale, nb);
    }
    return n;
}

int para(int x, int y, int w, const wch *s, u16 c, int scale, int bold, int lh, int align, int maxlines)
{
    return para_rich(x, y, w, s, bold ? 0x7fff : 0, c, c, scale, lh, align, maxlines);
}

/* number of lines a paragraph needs */
int para_lines(const wch *s, int w, int scale, int bold, int maxlines)
{
    const wch *st[16];
    int ln[16];
    if (maxlines > 16) maxlines = 16;
    return wrap(s, w, scale, bold, st, ln, maxlines);
}
