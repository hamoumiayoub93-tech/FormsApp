/*
 * game.c - scenes and input: title, map, dialog (Prof. Lexi), Wordex,
 * transition flash, toast, HUD. The battle lives in battle.c.
 *
 * Coordinates come from the prototype's CSS layout (measured in Chromium),
 * timings from its setTimeout/transition values. Time is in milliseconds
 * (now), positions in pixels, the smoothed player position in tile units
 * with 8 fractional bits.
 */
#include "ww.h"
#include "plat.h"

State S;
u32 now;
int kb_focus;               /* draw focus rings once the keys are used */

static const wch *LV[3] = { L"A1", L"A2", L"B1" };
static const wch *MODES[3] = { L"Easy", L"Normal", L"Hard" };
static const wch *MODEHINT[3] = { L"Hints and French help", L"No help, no timer", L"12 s timer, no help" };

/* ---------------- random ---------------- */
static u32 seed = 0x2545F491;
static u32 forced[16];          /* test harness: values returned before the generator */
static int nforced;
void rng_seed(u32 s) { seed = s ? s : 0x2545F491; }
void rng_push(u32 v) { if (nforced < 16) forced[nforced++] = v; }
u32 rng(void)
{
    if (nforced) {
        u32 v = forced[0];
        int i;
        for (i = 1; i < nforced; i++) forced[i - 1] = forced[i];
        nforced--;
        return v;
    }
    seed ^= seed << 13;
    seed ^= seed >> 17;
    seed ^= seed << 5;
    return seed;
}
int rnd(int n) { return n > 0 ? (int)(rng() % (u32)n) : 0; }
void shuffle_idx(int *a, int n)
{
    int i;
    for (i = n - 1; i > 0; i--) { int j = rnd(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; }
}

/* ---------------- small UI helpers ---------------- */
int hit(int px, int py, int x, int y, int w, int h)
{
    /* stylus targets are at least 24 px high and wide */
    if (h < 24) { y -= (24 - h) / 2; h = 24; }
    if (w < 24) { x -= (24 - w) / 2; w = 24; }
    return px >= x && px < x + w && py >= y && py < y + h;
}

/* single line of text vertically centred in a box like the HTML element */
static void tbox(int x, int y, int w, int h, const wch *s, u16 c, int scale, int bold, int align)
{
    int tw = text_w(s, -1, scale, bold), tx = x;
    if (align == 1) tx = x + (w - tw) / 2;
    else if (align == 2) tx = x + w - tw;
    text(tx, y + (h - 9 * scale) / 2, s, -1, c, scale, bold);
}

void focus_ring(int x, int y, int w, int h)      /* :focus-visible outline 2px #fff, offset 1px */
{
    r_frame(x - 3, y - 3, w + 6, h + 6, 2, C565(0xffffff));
}

/* .mini: #ffcf4a, text #1d2b3a, border-bottom 2px #b8891a, padding 1px 5px */
int mini_w(const wch *s) { return text_w(s, -1, 1, 0) + 10; }
void mini_btn(int x, int y, int w, int h, const wch *s, int a, int focus)
{
    if (a < 256) r_group_begin(x, y, w, h);
    R(x, y, w, h - 2, C565(0xffcf4a));
    R(x, y + h - 2, w, 2, C565(0xb8891a));
    tbox(x, y, w, h - 2, s, C565(0x1d2b3a), 1, 0, 1);
    if (a < 256) r_group_end(a);
    if (focus && kb_focus) focus_ring(x, y, w, h);
}

/* ---------------- toast ---------------- */
static wch toast_txt[64];
static u32 toast_show, toast_hide;    /* times; hide==0 while visible */
static int toast_on;

void toast(const wch *t)
{
    wcopy(toast_txt, t, 64);
    if (!toast_on || toast_hide) toast_show = now;   /* (re)start the fade-in */
    toast_on = 1;
    toast_hide = now + 1900;
}

static void draw_toast(void)
{
    int a, y, n, h;
    if (!toast_on) return;
    if (now < toast_hide) a = (int)(now - toast_show) * 256 / 200;
    else a = 256 - (int)(now - toast_hide) * 256 / 200;
    if (a > 256) a = 256;
    if (a <= 0) { if (now >= toast_hide) toast_on = 0; return; }
    /* .toast: left/right 20, top 22, translateY(-6px) when hidden, padding 4px 6px */
    y = 16 + 6 * a / 256;
    n = para_lines(toast_txt, 188, 1, 1, 3);
    h = 8 + 15 * n;
    r_group_begin(20, y, 200, h);
    R(20, y, 200, h, C565(0xffcf4a));
    para(26, y + 4 + 2, 188, toast_txt, C565(0x1d2b3a), 1, 1, 15, 1, 3);
    r_group_end(a);
}

/* ---------------- HUD ---------------- */
static int map_ui;
static wch hud_l[32], hud_dex[32];

void update_hud(void)
{
    int n = 0, i;
    for (i = 0; i < ncre; i++) n += S.dex[i];
    wcopy(hud_l, LV[S.level], 32);
    wcat(hud_l, L" \x00b7 ", 32);
    wcat(hud_l, MODES[S.mode], 32);
    wcopy(hud_dex, L"Wordex ", 32);
    wcat_int(hud_dex, n, 32);
    wcat(hud_dex, L"/", 32);
    wcat_int(hud_dex, ncre, 32);
}
void show_map_ui(int on) { map_ui = on; }

static int hud_dex_x(void) { return 237 - mini_w(hud_dex); }

static void draw_hud(void)
{
    /* .hud 240x16 #1d2b3a, text 10px at left 6; Wordex mini at the right (17 px high) */
    R(0, 0, W, 16, C565(0x1d2b3a));
    tbox(6, 2, 100, 12, hud_l, C565(0xf6efd5), 1, 0, 0);
    mini_btn(hud_dex_x(), 0, mini_w(hud_dex), 17, hud_dex, 256, 0);
    /* .foot */
    R(0, 304, W, 16, C565(0x1d2b3a));
    tbox(0, 304, W, 16, L"Walk into the tall grass!", C565(0xc9d4da), 1, 0, 1);
}

/* ---------------- dialog ---------------- */
static const DLine *dlines[MAXDLG + 1];
static int dl_n, dl_i, dl_fr;
#define DLG_Y 193        /* the FR button is 24 px high: the box grows 7 px upwards */

static int fr_visible(void) { return !(S.level == 2 || S.mode == 2); }

static void talk(void)
{
    int i;
    S.scene = SC_DIALOG;
    dl_n = 0;
    for (i = 0; i < ndlg_common; i++) dlines[dl_n++] = &dlg_common[i];
    dlines[dl_n++] = &dlg_lv[S.level];
    dl_i = 0;
    dl_fr = 0;
}

static void advance_dialog(void)
{
    dl_i++;
    if (dl_i >= dl_n) S.scene = SC_MAP;
    else dl_fr = 0;
}

static void draw_dialog(void)
{
    /* .dialog: left/right 6, bottom 22, border 2px #1d2b3a + 2px #f6efd5 ring, padding 8 8 6 */
    int y = DLG_Y, h = 298 - DLG_Y;
    const DLine *L = dlines[dl_i];
    R(4, y - 2, 232, h + 4, C565(0xf6efd5));
    R(6, y, 228, h, C565(0x1d2b3a));
    R(8, y + 2, 224, h - 4, C565(0xf6efd5));
    tbox(16, y + 10, 208, 15, L"Prof. Lexi", C565(0xb04a1f), 1, 1, 0);
    para(16, y + 29, 208, dl_fr ? L->fr : L->en, C565(0x1d2b3a), 1, 0, 12, 0, 4);
    if (fr_visible()) mini_btn(16, y + 73, mini_w(L"FR"), 24, L"FR", 256, 0);
    tbox(100, y + 73, 124, 24, L"tap or A \x25b8", C565(0x6a6040), 1, 0, 2);
}

/* ---------------- Wordex ---------------- */
static int dex_sel = -1;
#define DEX_GY 35
#define DEX_CH 67

static void dex_card_rect(int i, int *x, int *y)
{
    *x = (i & 1) ? 122 : 6;
    *y = DEX_GY + (i >> 1) * (DEX_CH + 5);
}

static int dex_count(void) { int n = 0, i; for (i = 0; i < ncre; i++) n += S.dex[i]; return n; }

static void open_dex(void)
{
    if (S.scene != SC_MAP) return;
    S.scene = SC_DEX;
    show_map_ui(0);
    dex_sel = -1;
}
static void close_dex(void) { S.scene = SC_MAP; show_map_ui(1); }

static void draw_dex(void)
{
    wch t[32];
    int i;
    R(0, 0, W, H, C565(0x1d2b3a));
    wcopy(t, L"Wordex ", 32); wcat_int(t, dex_count(), 32); wcat(t, L"/", 32); wcat_int(t, ncre, 32);
    tbox(6, 6, 150, 24, t, C565(0xf6efd5), 1, 1, 0);
    mini_btn(234 - mini_w(L"Close"), 6, mini_w(L"Close"), 24, L"Close", 256, 0);
    for (i = 0; i < ncre; i++) {
        int x, y, got = S.dex[i];
        dex_card_rect(i, &x, &y);
        R(x, y, 112, DEX_CH - 3, C565(0x2b4258));
        R(x, y + DEX_CH - 3, 112, 3, C565(0x14202c));
        r_sprite(cre[i].pix, cre[i].mask, x + 32, y + 2, 48, got ? 0 : 1, 102);
        tbox(x, y + 51, 112, 11, got ? cre[i].name : L"???", C565(0xf6efd5), 1, 0, 1);
        if (i == dex_sel) r_frame(x - 2, y - 2, 116, DEX_CH + 4, 2, C565(0xffcf4a));
    }
    /* .dinfo */
    R(6, 252, 228, 62, C565(0xf6efd5));
    if (dex_sel < 0) para(13, 258, 214, L"Tap a card.", C565(0x1d2b3a), 1, 0, 12, 0, 4);
    else if (!S.dex[dex_sel]) para(13, 258, 214, L"Not caught yet. Look in the tall grass!", C565(0x1d2b3a), 1, 0, 12, 0, 4);
    else {
        static wch b[256];
        const Creature *c = &cre[dex_sel];
        int n, nb = wlen(c->word);
        wcopy(b, c->word, 256);
        wcat(b, L" \x2013 ", 256);
        wcat(b, c->s, 256);
        n = para_rich(13, 258, 214, b, nb, C565(0x1d2b3a), C565(0x1d2b3a), 1, 12, 0, 3);
        para(13, 258 + n * 12 + 2, 214, c->fr, C565(0x6a6040), 1, 0, 11, 0, 2);
    }
}

/* ---------------- title ---------------- */
static int title_row = 2, title_col;     /* keyboard focus: 0 level, 1 mode, 2 start, 3 top bar */
static int reset_armed;
#define SEG_Y_LV 180
#define SEG_Y_MODE 232

static int seg_layout(const wch **names, int *xs, int *ws)
{
    int i, total = 0;
    for (i = 0; i < 3; i++) { ws[i] = text_w(names[i], -1, 1, 1) + 20; total += ws[i]; }
    total += 8;
    xs[0] = (W - total) / 2;
    xs[1] = xs[0] + ws[0] + 4;
    xs[2] = xs[1] + ws[1] + 4;
    return total;
}

static void draw_seg(const wch **names, int y, int on, int row)
{
    int xs[3], ws[3], i;
    seg_layout(names, xs, ws);
    for (i = 0; i < 3; i++) {
        int sel = i == on;
        R(xs[i], y, ws[i], 22, sel ? C565(0xffcf4a) : C565(0x2b4258));
        R(xs[i], y + 22, ws[i], 3, sel ? C565(0xb8891a) : C565(0x14202c));
        tbox(xs[i], y, ws[i], 22, names[i], sel ? C565(0x1d2b3a) : C565(0xf6efd5), 1, sel, 1);
        if (kb_focus && title_row == row && i == on) focus_ring(xs[i], y, ws[i], 25);
    }
}

/* top bar of the title: sound / reset / exit (outside the screen in the prototype) */
static const wch *top_label(int i)
{
    if (i == 0) return S.muted ? L"Sound: off" : L"Sound: on";
    if (i == 1) return reset_armed ? L"Sure?" : L"Reset";
    return L"Exit";
}
static void top_rect(int i, int *x, int *w)
{
    *w = text_w(top_label(i), -1, 1, 0) + 10;
    if (i == 0) *x = 4;
    else if (i == 2) *x = 236 - *w;
    else { int ew = text_w(top_label(2), -1, 1, 0) + 10; *x = 236 - ew - 4 - *w; }
}

static void draw_title(void)
{
    int i, xs[3], ws[3];
    r_vgrad(0, 224, 0x1d2b3a, 0x26515a);
    r_vgrad(224, 320, 0x26515a, 0x3a7a6d);
    /* h2 "Word<br>Wilds": 32px, #ffcf4a, text-shadow 3px 3px #14202c */
    for (i = 0; i < 2; i++) {
        const wch *s = i ? L"Wilds" : L"Word";
        int tw = text_w(s, -1, 3, 1), x = (W - tw) / 2, y = 18 + i * 32;
        text(x + 3, y + 3, s, -1, C565(0x14202c), 3, 1);
        text(x, y, s, -1, C565(0xffcf4a), 3, 1);
    }
    tbox(0, 86, W, 14, L"Catch words. Learn English.", C565(0xd6e6e0), 1, 0, 1);
    for (i = 0; i < 4 && i < ncre; i++) r_sprite(cre[i].pix, cre[i].mask, 26 + i * 48, 108, 44, 0, 0);
    tbox(0, 162, W, 12, L"Level", C565(0xbcd0d4), 1, 0, 1);
    draw_seg(LV, SEG_Y_LV, S.level, 0);
    tbox(0, 213, W, 12, L"Mode", C565(0xbcd0d4), 1, 0, 1);
    draw_seg(MODES, SEG_Y_MODE, S.mode, 1);
    tbox(0, 263, W, 13, MODEHINT[S.mode], C565(0xd6e6e0), 1, 0, 1);
    /* .go Start: #e0642f, border-bottom 4px #8f3a15, 15px bold white */
    R(70, 282, 100, 32, C565(0xe0642f));
    R(70, 314, 100, 4, C565(0x8f3a15));
    tbox(70, 282, 100, 32, L"Start", C565(0xffffff), 2, 1, 1);
    if (kb_focus && title_row == 2) focus_ring(70, 282, 100, 36);
    for (i = 0; i < 3; i++) {
        int x, w;
        top_rect(i, &x, &w);
        R(x, 4, w, 21, C565(0x2b4258));
        R(x, 25, w, 3, C565(0x14202c));
        tbox(x, 4, w, 21, top_label(i), C565(0xf6efd5), 1, 0, 1);
        if (kb_focus && title_row == 3 && title_col == i) focus_ring(x, 4, w, 24);
    }
    (void)xs; (void)ws;
}

static void title_start(void)
{
    S.scene = SC_MAP;
    show_map_ui(1);
    update_hud();
    save_game();
    toast(L"Walk into the tall grass!");
    reset_armed = 0;
}

static void reset_progress(void)
{
    /* prototype's "Effacer la progression" */
    int i;
    for (i = 0; i < MAXCRE; i++) S.dex[i] = 0;
    S.level = 0; S.mode = 1;
    S.nmissed[0] = S.nmissed[1] = S.nmissed[2] = 0;
    S.ok_streak = S.ko_streak = 0;
    if (battle_active()) battle_end();
    S.scene = SC_TITLE;
    show_map_ui(0);
    update_hud();
    save_game();
}

static void top_action(int i)
{
    if (i == 0) { S.muted = !S.muted; save_game(); }
    else if (i == 1) {
        if (!reset_armed) { reset_armed = 1; return; }
        reset_progress();
    } else game_quit();
    if (i != 1) reset_armed = 0;
}

static void title_key(int k)
{
    kb_focus = 1;
    if (k == K_UP) { title_row = title_row == 0 ? 3 : title_row == 3 ? 3 : title_row - 1; }
    else if (k == K_DOWN) { title_row = title_row == 3 ? 0 : title_row < 2 ? title_row + 1 : 2; }
    else if (k == K_LEFT || k == K_RIGHT) {
        int d = k == K_LEFT ? -1 : 1;
        if (title_row == 0) S.level = (S.level + d + 3) % 3;
        else if (title_row == 1) S.mode = (S.mode + d + 3) % 3;
        else if (title_row == 3) title_col = (title_col + d + 3) % 3;
    } else if (k == K_A) {
        if (title_row == 3) top_action(title_col);
        else title_start();
    }
    if (!(title_row == 3 && title_col == 1)) reset_armed = 0;
}

static void title_pointer(int x, int y)
{
    int xs[3], ws[3], i;
    seg_layout(LV, xs, ws);
    for (i = 0; i < 3; i++) if (hit(x, y, xs[i], SEG_Y_LV, ws[i], 25)) { S.level = i; reset_armed = 0; return; }
    seg_layout(MODES, xs, ws);
    for (i = 0; i < 3; i++) if (hit(x, y, xs[i], SEG_Y_MODE, ws[i], 25)) { S.mode = i; reset_armed = 0; return; }
    if (hit(x, y, 70, 282, 100, 36)) { title_start(); return; }
    for (i = 0; i < 3; i++) {
        int bx, bw;
        top_rect(i, &bx, &bw);
        if (hit(x, y, bx, 4, bw, 24)) { top_action(i); return; }
    }
    reset_armed = 0;
}

/* ---------------- map: movement ---------------- */
static int held = -1;                 /* held direction key */
static u32 held_next;
static int touching, touch_x, touch_y;
static u32 flash_start, trans_end;

static int moving(void)
{
    int dx = S.px * 256 - S.vx, dy = S.py * 256 - S.vy;
    if (dx < 0) dx = -dx;
    if (dy < 0) dy = -dy;
    return dx + dy > 77;          /* > .3 tile */
}

static void encounter(void)
{
    S.scene = SC_TRANS;
    sfx(SFX_ENC);
    flash_start = now;
    trans_end = now + 650;
}

static void move(int dx, int dy)
{
    int nx, ny;
    char c;
    if (S.scene != SC_MAP || moving()) return;
    S.dir = dx < 0 ? DIR_LEFT : dx > 0 ? DIR_RIGHT : dy < 0 ? DIR_UP : DIR_DOWN;
    nx = S.px + dx; ny = S.py + dy;
    c = tile(nx, ny);
    if (c == 'N') { talk(); return; }
    if (solid(c)) return;
    S.px = nx; S.py = ny;
    if (S.cool > 0) S.cool--;
    else if (c == 'g' && rnd(1000) < 200) encounter();
}

static const int DX[4] = { 0, -1, 1, 0 }, DY[4] = { 1, 0, 0, -1 };   /* by DIR_* */

static int key_dir(int k)
{
    return k == K_DOWN ? DIR_DOWN : k == K_LEFT ? DIR_LEFT : k == K_RIGHT ? DIR_RIGHT : DIR_UP;
}

/* stylus held on the map: walk one tile at a time towards the stylus */
static void touch_walk(void)
{
    int tx, ty, dx, dy, ox = S.px, oy = S.py;
    if (!touching || S.scene != SC_MAP || moving()) return;
    tx = touch_x / T;
    ty = (touch_y - OY) / T;
    dx = tx - S.px; dy = ty - S.py;
    if (!dx && !dy) return;
    if ((dx < 0 ? -dx : dx) >= (dy < 0 ? -dy : dy)) {
        move(dx < 0 ? -1 : 1, 0);
        if (S.scene == SC_MAP && S.px == ox && S.py == oy && dy) move(0, dy < 0 ? -1 : 1);
    } else {
        move(0, dy < 0 ? -1 : 1);
        if (S.scene == SC_MAP && S.px == ox && S.py == oy && dx) move(dx < 0 ? -1 : 1, 0);
    }
}

static void interact(void)
{
    int k;
    static const int ND[4][2] = { { 0, -1 }, { 0, 1 }, { -1, 0 }, { 1, 0 } };
    switch (S.scene) {
    case SC_MAP:
        for (k = 0; k < 4; k++)
            if (tile(S.px + ND[k][0], S.py + ND[k][1]) == 'N') {
                int dx = ND[k][0], dy = ND[k][1];
                S.dir = dx < 0 ? DIR_LEFT : dx > 0 ? DIR_RIGHT : dy < 0 ? DIR_UP : DIR_DOWN;
                talk();
                return;
            }
        open_dex();         /* buttons only: A away from Prof. Lexi opens the Wordex */
        break;
    case SC_DIALOG: advance_dialog(); break;
    case SC_BATTLE: case SC_CAPTURE: case SC_FLEE: battle_interact(); break;
    case SC_DEX: close_dex(); break;
    }
}

/* ---------------- drawing ---------------- */
static void draw_map(void)
{
    int mv = moving(), x, y;
    R(0, 0, W, H, C565(0x1d2b3a));
    r_blit(mapbuf, COLS * T, ROWS * T, 0, OY);
    x = (S.vx * T + 128) >> 8;
    y = ((S.vy * T + 128) >> 8) + OY;
    draw_player(x, y, S.dir, mv && ((now / 90) & 1) ? -1 : 0);
    if (tile((S.vx + 128) >> 8, (S.vy + 128) >> 8) == 'g') {
        int i;
        for (i = 0; i < 5; i++) {
            int bx = x + 2 + i * 3;
            R(bx, y + 11, 1, 5, C565(0x2c7a45));
            R(bx + 1, y + 12, 1, 2, C565(0x8be08a));
        }
    }
}

static void draw_flash(void)
{
    /* @keyframes blink .6s steps(1): white, clear, white, clear, white, clear */
    int ph;
    if (S.scene != SC_TRANS) return;
    ph = (int)(now - flash_start) * 6 / 600;
    if (ph < 6 && !(ph & 1)) R(0, 0, W, H, C565(0xffffff));
}

static void draw_error(void)
{
    R(0, 0, W, H, C565(0x1d2b3a));
    tbox(0, 20, W, 30, L"WordWilds", C565(0xffcf4a), 2, 1, 1);
    tbox(0, 64, W, 14, L"Cannot start: data problem", C565(0xff9a8a), 1, 1, 1);
    para(12, 90, 216, data_error, C565(0xf6efd5), 1, 0, 12, 0, 10);
    para(12, 230, 216, L"Copy words.csv, sentences.csv, creatures.csv and dialog.txt (UTF-8) into the folder of wordwilds.exe.",
         C565(0xc9d4da), 1, 0, 12, 0, 5);
    tbox(0, 296, W, 14, L"Tap or press a key to quit.", C565(0xffcf4a), 1, 0, 1);
}

/* ---------------- frame ---------------- */
static u32 last_step;

static void step(void)
{
    /* S.vx+=(S.px-S.vx)*.3 per 60 Hz frame = 1-.7^3 = .657 per 50 ms step */
    int d = S.px * 256 - S.vx;
    S.vx += d * 168 / 256;
    d = S.py * 256 - S.vy;
    S.vy += d * 168 / 256;
    if ((S.px * 256 - S.vx) < 5 && (S.px * 256 - S.vx) > -5) S.vx = S.px * 256;
    if ((S.py * 256 - S.vy) < 5 && (S.py * 256 - S.vy) > -5) S.vy = S.py * 256;
}

void game_frame(u32 t)
{
    int n = 0;
    now = t;
    if (!last_step) last_step = t;
    while (t - last_step >= FRAME_MS && n < 4) { step(); last_step += FRAME_MS; n++; }
    if (t - last_step >= FRAME_MS) last_step = t;

    if (S.scene != SC_ERROR) {
        if (held >= 0 && S.scene == SC_MAP && (int)(now - held_next) >= 0) {
            move(DX[held], DY[held]);
            held_next = now + 110;
        }
        touch_walk();
        if (S.scene == SC_TRANS && (int)(now - trans_end) >= 0) battle_start();
        battle_update();
    }

    switch (S.scene) {
    case SC_ERROR: draw_error(); return;
    case SC_TITLE: draw_title(); break;
    case SC_BATTLE: case SC_CAPTURE: case SC_FLEE: battle_draw(); break;
    case SC_DEX: draw_dex(); break;
    default:
        draw_map();
        if (map_ui) draw_hud();
        if (S.scene == SC_DIALOG) draw_dialog();
        draw_flash();
        break;
    }
    draw_toast();
}

/* ---------------- input ---------------- */
void game_key(int k, int down)
{
    if (!down) {
        if (held >= 0 && k <= K_RIGHT && key_dir(k) == held) held = -1;
        return;
    }
    if (S.scene == SC_ERROR) { plat_quit(); return; }
    if (k == K_ESC) { game_quit(); return; }
    if (S.scene != SC_TITLE) kb_focus = 1;     /* like :focus-visible after a key press */
    switch (S.scene) {
    case SC_TITLE: title_key(k); return;
    case SC_MAP:
        if (k <= K_RIGHT) {
            held = key_dir(k);
            move(DX[held], DY[held]);
            held_next = now + 110;
            return;
        }
        if (k == K_A) interact();
        else if (k == K_DEX) open_dex();
        return;
    case SC_DIALOG:
        if (k == K_A) advance_dialog();
        else if ((k == K_LEFT || k == K_RIGHT) && fr_visible()) dl_fr = !dl_fr;
        return;
    case SC_DEX:
        if (k == K_A || k == K_DEX) { close_dex(); return; }
        if (k <= K_RIGHT) {
            kb_focus = 1;
            if (dex_sel < 0) dex_sel = 0;
            else if (k == K_LEFT && (dex_sel & 1)) dex_sel--;
            else if (k == K_RIGHT && !(dex_sel & 1) && dex_sel + 1 < ncre) dex_sel++;
            else if (k == K_UP && dex_sel >= 2) dex_sel -= 2;
            else if (k == K_DOWN && dex_sel + 2 < ncre) dex_sel += 2;
        }
        return;
    case SC_BATTLE: case SC_CAPTURE: case SC_FLEE:
        battle_key(k);
        return;
    }
}

void game_pointer(int x, int y, int ev)
{
    if (ev == 2) { touching = 0; return; }
    if (ev == 1) { if (touching) { touch_x = x; touch_y = y; } return; }
    if (S.scene == SC_ERROR) { plat_quit(); return; }
    kb_focus = 0;
    switch (S.scene) {
    case SC_TITLE: title_pointer(x, y); return;
    case SC_MAP:
        if (map_ui && hit(x, y, hud_dex_x(), 0, mini_w(hud_dex), 26)) { open_dex(); return; }
        touching = 1; touch_x = x; touch_y = y;
        return;
    case SC_DIALOG:
        if (fr_visible() && hit(x, y, 16, DLG_Y + 73, mini_w(L"FR"), 24)) { dl_fr = !dl_fr; return; }
        if (x >= 4 && x < 236 && y >= DLG_Y - 2 && y < 300) advance_dialog();
        return;
    case SC_DEX: {
        int i, cx, cy;
        if (hit(x, y, 234 - mini_w(L"Close"), 6, mini_w(L"Close"), 24)) { close_dex(); return; }
        for (i = 0; i < ncre; i++) {
            dex_card_rect(i, &cx, &cy);
            if (x >= cx && x < cx + 112 && y >= cy && y < cy + DEX_CH) dex_sel = i;
        }
        return;
    }
    case SC_BATTLE: case SC_CAPTURE: case SC_FLEE:
        battle_pointer(x, y);
        return;
    }
}

void game_pause(void)
{
    held = -1;
    touching = 0;
    if (S.scene != SC_ERROR) save_game();
}

void game_quit(void)
{
    if (S.scene != SC_ERROR) save_game();
    plat_quit();
}

void game_init(void)
{
    int i;
    font_init();
    sound_build();
    S.scene = SC_TITLE;
    S.level = 0; S.mode = 1;
    S.px = 10; S.py = 16; S.vx = 10 * 256; S.vy = 16 * 256;
    S.dir = DIR_UP; S.cool = 3;
    for (i = 0; i < MAXCRE; i++) S.dex[i] = 0;
    if (!data_load()) { S.scene = SC_ERROR; return; }
    sprites_build();
    load_game();
    update_hud();
}
