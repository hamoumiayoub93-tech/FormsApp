/*
 * ww.h - WordWilds for Windows CE: shared declarations.
 *
 * The game core (render, font, sprites, data, save, sound, game, battle) is
 * plain C with no floating point and no dynamic allocation. It only talks
 * to the outside world through the plat_* functions (plat.h), implemented by
 * main.c (Win32 / Windows CE) and by sim.c (headless PC test harness).
 *
 * Text is stored as UTF-16 (wchar_t, 16 bits on Windows CE; the Linux test
 * build uses -fshort-wchar so that L"..." literals have the same layout).
 */
#ifndef WW_H
#define WW_H

#include <stddef.h>

typedef unsigned short u16;
typedef unsigned int u32;
typedef unsigned char u8;
typedef wchar_t wch;

/* ---- screen and map (same constants as the prototype) ---- */
#define W 240
#define H 320
#define T 16            /* tile size */
#define COLS 15
#define ROWS 18
#define OY 16           /* map is drawn 16 px down, below the top bar */

#define FRAME_MS 50     /* 20 frames per second */

/* RGB565 from a 0xRRGGBB literal */
#define C565(c) ((u16)((((c) >> 8) & 0xF800) | (((c) >> 5) & 0x07E0) | (((c) >> 3) & 0x001F)))

/* ===================== render.c ===================== */
extern u16 *fb;                         /* 240x320 RGB565 back buffer */
void r_set_target(u16 *pix, int w, int h);  /* draw into another buffer */
void r_reset_target(void);
void R(int x, int y, int w, int h, u16 c);             /* filled rect */
void RA(int x, int y, int w, int h, u16 c, int a256);  /* blended rect, a in 0..256 */
void E(int cx, int cy, int rx, int ry, u16 c);         /* filled ellipse (prototype E) */
void r_frame(int x, int y, int w, int h, int t, u16 c);/* rectangle outline, thickness t */
u16 blend(u16 dst, u16 src, int a256);
void r_vgrad(int y0, int y1, u32 c0, u32 c1);          /* vertical gradient, full width */
void r_blit(const u16 *src, int sw, int sh, int dx, int dy); /* opaque copy */
/* scaled sprite (nearest neighbour) with 1-bit mask.
   mode 0 normal, 1 = black silhouette at alpha a256 */
void r_sprite(const u16 *pix, const u8 *mask, int dx, int dy, int size, int mode, int a256);
void r_group_begin(int x, int y, int w, int h);   /* CSS opacity on a whole element */
void r_group_end(int a256);
int isin(int a);        /* a: 0..1023 = 0..2pi, result Q14 (-16384..16384) */
int icos(int a);
u32 hh(int x, int y, int k);   /* the prototype's hash, bit exact */

/* ===================== font.c ===================== */
#define FONT_LH 11              /* line height of the 1x font */
void font_init(void);
/* scale 1..4, bold 0/1 */
int text_w(const wch *s, int n, int scale, int bold);
int text(int x, int y, const wch *s, int n, u16 c, int scale, int bold);
/* word wrap: returns number of lines; starts[]/lens[] receive line slices */
int wrap(const wch *s, int maxw, int scale, int bold, const wch **starts, int *lens, int maxlines);
/* draw a wrapped paragraph, align 0 left 1 centre; returns lines drawn */
int para(int x, int y, int w, const wch *s, u16 c, int scale, int bold, int lh, int align, int maxlines);
/* same, the first nbold characters are bold and drawn in colour cb */
int para_rich(int x, int y, int w, const wch *s, int nbold, u16 c, u16 cb, int scale, int lh, int align, int maxlines);
int para_lines(const wch *s, int w, int scale, int bold, int maxlines);
extern int font_gap;      /* 1: "___" is drawn as the yellow answer gap */
int wlen(const wch *s);
void wcopy(wch *d, const wch *s, int max);
void wcat(wch *d, const wch *s, int max);
void wcat_int(wch *d, int v, int max);

/* ===================== sprites.c ===================== */
#define MAXCRE 6
typedef struct {
    const wch *id, *name, *kind, *word, *s, *fr;
    u32 body, dark, light, accent;
    int kindn;
    u16 pix[32 * 32];
    u8 mask[32 * 32];
} Creature;
extern u16 mapbuf[COLS * T * ROWS * T];
extern u16 battlebg[W * 172];
void sprites_build(void);      /* creature sprites, map, battle background */
void draw_player(int x, int y, int dir, int bob);
char tile(int x, int y);
int solid(char c);

/* ===================== data.c ===================== */
#define MAXWORDS 200
#define MAXSENT 200
#define MAXDLG 32
typedef struct { const wch *en, *fr; } Word;
typedef struct { const wch *sent, *ans, *wr[3], *fr; } Sentence;
typedef struct { const wch *en, *fr; } DLine;
extern Word words[MAXWORDS];
extern int nwords;
extern Sentence sents[3][MAXSENT];   /* [1] = A2, [2] = B1 */
extern int nsents[3];
extern Creature cre[MAXCRE];
extern int ncre;
extern DLine dlg_common[MAXDLG];
extern int ndlg_common;
extern DLine dlg_lv[3];
extern wch data_error[512];          /* empty when everything loaded */
int data_load(void);

/* ===================== save.c ===================== */
void save_game(void);
void load_game(void);

/* ===================== sound.c ===================== */
enum { SFX_OK, SFX_NO, SFX_CAP, SFX_ENC, SFX_N };
void sound_build(void);
const short *sound_pcm(int id, int *nsamples);
void sfx(int id);
#define SND_RATE 22050

/* ===================== game.c ===================== */
enum { SC_TITLE, SC_MAP, SC_TRANS, SC_DIALOG, SC_BATTLE, SC_CAPTURE, SC_FLEE, SC_DEX, SC_ERROR };
enum { DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP };   /* prototype dir values 0..3 */

/* a question spec, like the prototype's {t,i,dir,lvl} */
typedef struct { u8 t; u8 dir; u8 lvl; u16 i; } Spec;   /* t: 'w' or 'c' */
#define MAXMISSED 512

typedef struct {
    int scene;
    int level, mode;
    int px, py;            /* tile position */
    int vx, vy;            /* smoothed position, tile units Q8 */
    int dir, cool;
    u8 dex[MAXCRE];
    Spec missed[3][MAXMISSED];
    int nmissed[3];
    int ok_streak, ko_streak;
    int muted;
} State;
extern State S;
extern u32 now;            /* ms clock */

void rng_seed(u32 s);
void rng_push(u32 v);     /* test harness: force the next value */
u32 rng(void);
int rnd(int n);            /* 0..n-1 */
void shuffle_idx(int *a, int n);
void toast(const wch *t);
void update_hud(void);
void show_map_ui(int on);
void game_init(void);
void game_frame(u32 t);    /* update + draw one frame */
void game_key(int key, int down);   /* K_* below */
void game_pointer(int x, int y, int ev);   /* ev 0 down, 1 move, 2 up */
void game_quit(void);
void game_pause(void);

enum { K_UP, K_DOWN, K_LEFT, K_RIGHT, K_A, K_1, K_2, K_3, K_4, K_DEX, K_HINT, K_ESC, K_OTHER };

/* shared UI helpers (game.c) */
void mini_btn(int x, int y, int w, int h, const wch *s, int a256, int focus);
int mini_w(const wch *s);
void focus_ring(int x, int y, int w, int h);
int hit(int px, int py, int x, int y, int w, int h);
extern int kb_focus;      /* 1 once a key was used: draw focus rings */

/* ===================== battle.c ===================== */
void battle_start(void);
void battle_update(void);
void battle_draw(void);
void battle_key(int key);
void battle_pointer(int x, int y);
void battle_end(void);
int battle_active(void);
void battle_interact(void);   /* A button */
int battle_debug(int what);   /* test harness */

#endif
