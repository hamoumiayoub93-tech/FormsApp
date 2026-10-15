/*
 * sprites.c - everything the prototype draws with code:
 *   - the 6 creature sprites (32x32), built like makeSprite()
 *   - the map, pre-rendered once like renderMap() into a 240x288 buffer
 *   - the battle background (static, pre-rendered once: top 172 px)
 *   - the player sprite (4 directions)
 */
#include "ww.h"

static const char *MAP[ROWS] = {
    "TTTTTTTTTTTTTTT",
    "T.............T",
    "T..HH.....gg..T",
    "T..HH.....ggg.T",
    "T..==.....gg..T",
    "T..=N=........T",
    "T..===........T",
    "T.....==......T",
    "T.gg....=.....T",
    "Tggg....==..~~T",
    "Tgg......=..~~T",
    "T........=gg.~T",
    "T..gggg..=ggg.T",
    "T..gggg..=....T",
    "T..ggg...==...T",
    "T........=....T",
    "T.........=...T",
    "TTTTTTTTTTTTTTT"
};

u16 mapbuf[COLS * T * ROWS * T];
u16 battlebg[W * 172];

char tile(int x, int y)
{
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return 'T';
    return MAP[y][x];
}

int solid(char c) { return c == 'T' || c == '~' || c == 'H' || c == 'N'; }

/* ---------------- creatures ---------------- */
#define KEY 0xF81F      /* transparent key colour while building a sprite */

/* tri=(cx,top,h,col)=>{for(r<h){w=1+floor(r*.9);R(cx-floor(w/2),top+r,w,1,col)}} */
static void tri(int cx, int top, int h, u16 col)
{
    int r;
    for (r = 0; r < h; r++) {
        int w = 1 + (r * 9) / 10;
        R(cx - w / 2, top + r, w, 1, col);
    }
}

static void make_sprite(Creature *c)
{
    u16 dark = C565(c->dark), body = C565(c->body), light = C565(c->light), acc = C565(c->accent);
    int i;
    r_set_target(c->pix, 32, 32);
    R(0, 0, 32, 32, KEY);
    switch (c->kindn) {
    case 4: /* ears */
        tri(9, 3, 8, dark); tri(9, 5, 5, acc); tri(23, 3, 8, dark); tri(23, 5, 5, acc);
        break;
    case 5: /* horn */
        tri(16, 0, 11, dark); tri(16, 2, 8, acc);
        break;
    case 0: /* leaf */
        R(16, 4, 1, 8, C565(0x3d7a3a)); E(20, 5, 4, 2, C565(0x58b44a)); E(12, 7, 3, 2, C565(0x58b44a));
        break;
    case 3: /* fin */
        tri(16, 1, 10, dark); tri(16, 3, 7, acc); E(4, 22, 3, 3, acc); E(28, 22, 3, 3, acc);
        break;
    case 1: /* flame */
        tri(10, 4, 8, C565(0xff8a2a)); tri(16, 0, 11, C565(0xffcf3a)); tri(22, 4, 8, C565(0xff8a2a));
        break;
    case 2: /* cloud */
        E(10, 10, 5, 4, light); E(16, 8, 6, 5, light); E(22, 10, 5, 4, light);
        break;
    }
    E(16, 20, 11, 9, dark); E(16, 20, 10, 8, body); E(16, 23, 6, 5, light);
    R(11, 17, 3, 4, C565(0xffffff)); R(18, 17, 3, 4, C565(0xffffff));
    R(12, 18, 2, 3, C565(0x1b1b2b)); R(19, 18, 2, 3, C565(0x1b1b2b));
    R(12, 18, 1, 1, C565(0xffffff)); R(19, 18, 1, 1, C565(0xffffff));
    R(8, 23, 3, 2, acc); R(21, 23, 3, 2, acc);
    R(14, 25, 4, 1, dark); R(13, 24, 1, 1, dark); R(18, 24, 1, 1, dark);
    r_reset_target();
    for (i = 0; i < 32 * 32; i++) c->mask[i] = c->pix[i] != KEY;
}

/* ---------------- map (renderMap) ---------------- */
static void grass(int x, int y, int tx, int ty)
{
    int k;
    R(x, y, T, T, C565(0x79c36f));
    for (k = 0; k < 4; k++) {
        u32 a = hh(tx, ty, k);
        /* JS: a>>4 is a signed shift, so the offset can be negative (speck lands in the tile above) */
        R(x + (int)(a % 14) + 1, y + (((int)a >> 4) % 13) + 1, 2, 1, C565(0x62ad5f));
    }
}
static void path(int x, int y, int tx, int ty)
{
    int k;
    R(x, y, T, T, C565(0xe8d3a0));
    for (k = 0; k < 4; k++) {
        u32 a = hh(tx, ty, k + 9);
        R(x + (int)(a % 14) + 1, y + (((int)a >> 4) % 13) + 1, 2, 1, C565(0xd3bb82));
    }
}

static void render_map(void)
{
    int tx, ty, i, r;
    r_set_target(mapbuf, COLS * T, ROWS * T);
    for (ty = 0; ty < ROWS; ty++) for (tx = 0; tx < COLS; tx++) {
        char c = tile(tx, ty);
        int x = tx * T, y = ty * T;
        if (c == 'g') {
            R(x, y, T, T, C565(0x3f9b57));
            for (i = 0; i < 6; i++) {
                int bx = x + 1 + (i * 27) / 10, bh = 6 + (int)(hh(tx, ty, i) % 5);
                R(bx, y + T - bh, 1, bh, C565(0x2c7a45));
                R(bx + 1, y + T - bh + 1, 1, 2, C565(0x8be08a));
            }
        } else if (c == 'T') {
            grass(x, y, tx, ty);
            E(x + 8, y + 7, 7, 7, C565(0x2b6a46));
            E(x + 6, y + 5, 3, 3, C565(0x3f8f5a));
            R(x + 6, y + 12, 4, 4, C565(0x7a4b2a));
        } else if (c == '~') {
            R(x, y, T, T, C565(0x4aa3d8));
            for (i = 0; i < 3; i++)
                if ((tx * 7 + ty * 3 + i) % 3 != 1) R(x + ((i * 5 + tx * 3) % 10) + 2, y + 3 + i * 5, 4, 1, C565(0x8fd0f0));
        } else if (c == '=' || c == 'N') {
            path(x, y, tx, ty);
            if (c == 'N') {     /* Prof. Lexi */
                R(x + 5, y + 2, 6, 3, C565(0x7b4fc4)); R(x + 5, y + 5, 6, 4, C565(0xf3c9a0));
                R(x + 6, y + 6, 1, 2, C565(0x1d2b3a)); R(x + 9, y + 6, 1, 2, C565(0x1d2b3a));
                R(x + 4, y + 9, 8, 5, C565(0xffffff)); R(x + 4, y + 9, 1, 5, C565(0xc9d4da));
                R(x + 11, y + 9, 1, 5, C565(0xc9d4da)); R(x + 5, y + 14, 2, 2, C565(0x2a3550));
                R(x + 9, y + 14, 2, 2, C565(0x2a3550));
            }
        } else if (c == 'H') {
            if (tile(tx, ty - 1) != 'H') {     /* roof */
                R(x, y, T, T, C565(0xd2573f));
                for (r = 3; r < T; r += 4) R(x, y + r, T, 1, C565(0xa83f2d));
                R(x, y, T, 1, C565(0xe98068));
            } else {
                R(x, y, T, T, C565(0xf1e6c8)); R(x, y, T, 1, C565(0xc9b98e));
                if (tx == 3) {                 /* window */
                    R(x + 4, y + 3, 8, 6, C565(0x7a5a2a)); R(x + 5, y + 4, 6, 4, C565(0x7fc2e8));
                    R(x + 8, y + 4, 1, 4, C565(0x7a5a2a));
                } else {                       /* door */
                    R(x + 4, y + 3, 8, 13, C565(0x7a4b2a)); R(x + 5, y + 4, 6, 12, C565(0x935c35));
                    R(x + 10, y + 10, 1, 2, C565(0xffcf4a));
                }
            }
        } else grass(x, y, tx, ty);
    }
    r_reset_target();
}

/* static part of drawBattle() */
static void render_battle_bg(void)
{
    int i;
    r_set_target(battlebg, W, 172);
    R(0, 0, W, 172, C565(0xbfe3f2)); R(0, 40, W, 40, C565(0xcfeaf3));
    E(56, 126, 92, 38, C565(0x8fd08a)); E(196, 130, 100, 42, C565(0x79c36f)); R(0, 136, W, 36, C565(0x62ad5f));
    for (i = 0; i < 14; i++) R((int)(hh(i, 1, 2) % 232), 140 + (int)(hh(i, 2, 3) % 28), 3, 1, C565(0x79c36f));
    E(120, 138, 58, 12, C565(0x4e9650)); E(120, 136, 58, 10, C565(0x7ac06f));
    r_reset_target();
}

void sprites_build(void)
{
    int i;
    for (i = 0; i < ncre; i++) make_sprite(&cre[i]);
    render_map();
    render_battle_bg();
}

/* drawPlayer(x,y,dir,bob) */
void draw_player(int x, int y, int dir, int bob)
{
    y += bob;
    RA(x + 4, y + 15, 8, 1, 0, 64);                 /* rgba(0,0,0,.25) shadow */
    R(x + 5, y + 12, 2, 3, C565(0x2a3550)); R(x + 9, y + 12, 2, 3, C565(0x2a3550));
    R(x + 4, y + 7, 8, 5, C565(0x3c6fd1)); R(x + 4, y + 7, 8, 1, C565(0x5b8ae6));
    if (dir == DIR_UP) R(x + 5, y + 8, 6, 3, C565(0xf2b632));
    R(x + 5, y + 3, 6, 5, C565(0xf3c9a0));
    R(x + 4, y + 1, 8, 3, C565(0xd94a3a)); R(x + 3, y + 3, 10, 1, C565(0xb83a2c));
    if (dir == DIR_DOWN) { R(x + 6, y + 5, 1, 2, C565(0x1d2b3a)); R(x + 9, y + 5, 1, 2, C565(0x1d2b3a)); }
    else if (dir == DIR_LEFT) { R(x + 5, y + 5, 1, 2, C565(0x1d2b3a)); R(x + 7, y + 5, 1, 2, C565(0x1d2b3a)); }
    else if (dir == DIR_RIGHT) { R(x + 8, y + 5, 1, 2, C565(0x1d2b3a)); R(x + 10, y + 5, 1, 2, C565(0x1d2b3a)); }
}
