/*
 * battle.c - encounter, questions, feedback, adaptive level, capture & flee
 * cards. Port of startBattle/nextQ/answer/adapt/capture/flee/endBattle and
 * of drawBattle (appear zoom, bobbing, shake, shrink + sparkles).
 */
#include "ww.h"
#include "plat.h"

static const wch *LV[3] = { L"A1", L"A2", L"B1" };

enum { NEXT_NONE, NEXT_Q, NEXT_CAPTURE, NEXT_FLEE };
enum { CH_NORMAL, CH_OK, CH_BAD };

typedef struct {
    int active;
    int c;                    /* creature index */
    int hp, hearts;
    int locked, hinted;
    int shake;                /* Q8 */
    u32 t0, cap_start;
    int has_spec;
    Spec spec;
    char last_key[16];
    int next;                 /* pending later() callback */
    u32 next_at;
    u32 tm_at;                /* hard mode deadline, 0 = none */
    u32 q_start;
    int intro;                /* "A wild X appeared!" */
    int show_fb, timed_out, ok;
    int card;                 /* 0 none, 1 capture, 2 flee */
    u32 card_at;
    int is_new, done;
    int voice_q, voice_card;  /* a Listen WAV exists */
    int focus;                /* keyboard focus 0..3 choices, 4 mini; card: 0 Continue, 1 Listen */
    int focus_shown;
    /* question */
    const wch *choice[4];
    int answer;               /* index of the right choice */
    int chs[4];               /* CH_* */
    int off[4];
    wch qtext[160];
    const wch *hint;          /* French help (sentences, Easy) */
    wch line[200];
    const wch *fr;
    wch voice[48];
} Battle;

static Battle B;

int battle_active(void) { return B.active; }

/* ---------- questions ---------- */
static void spec_key(const Spec *s, char *k)
{
    int n = 0, v, d = 0;
    char t[8];
    k[n++] = s->t;
    if (s->t == 'c') { k[n++] = (char)('0' + s->lvl); k[n++] = '_'; }
    v = s->i;
    do { t[d++] = (char)('0' + v % 10); v /= 10; } while (v);
    while (d) k[n++] = t[--d];
    if (s->t == 'w') k[n++] = s->dir ? 'f' : 'e';
    k[n] = 0;
}
static int spec_eq(const Spec *a, const Spec *b)
{
    return a->t == b->t && a->i == b->i && (a->t == 'w' ? a->dir == b->dir : a->lvl == b->lvl);
}
static int key_eq(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return *a == *b; }

static void pick_spec(Spec *s)
{
    int n, have = 0, lv = S.level;
    char k[16];
    if (S.nmissed[lv] && rnd(1000) < 400) { *s = S.missed[lv][rnd(S.nmissed[lv])]; have = 1; }
    for (n = 0; n < 6; n++) {
        if (have) { spec_key(s, k); if (!key_eq(k, B.last_key)) break; }
        if (lv == 0) { s->t = 'w'; s->i = (u16)rnd(nwords); s->dir = (u8)(rnd(1000) < 500); s->lvl = 0; }
        else { s->t = 'c'; s->lvl = (u8)lv; s->i = (u16)rnd(nsents[lv]); s->dir = 0; }
        have = 1;
    }
}

static void build_q(const Spec *s)
{
    int idx[4], i;
    B.hint = 0;
    B.fr = 0;
    if (s->t == 'w') {
        const Word *w = &words[s->i];
        int others[MAXWORDS], n = 0;
        const wch *ans = s->dir ? w->fr : w->en;
        for (i = 0; i < nwords; i++) if (i != s->i) others[n++] = i;
        shuffle_idx(others, n);
        B.choice[0] = ans;
        for (i = 0; i < 3; i++) B.choice[i + 1] = s->dir ? words[others[i]].fr : words[others[i]].en;
        if (s->dir) { wcopy(B.qtext, L"What does \x201c", 160); wcat(B.qtext, w->en, 160); wcat(B.qtext, L"\x201d mean?", 160); }
        else { wcopy(B.qtext, L"How do you say \x201c", 160); wcat(B.qtext, w->fr, 160); wcat(B.qtext, L"\x201d in English?", 160); }
        wcopy(B.line, w->en, 200); wcat(B.line, L" = ", 200); wcat(B.line, w->fr, 200);
        wcopy(B.voice, L"voice\\w_", 48); wcat(B.voice, w->en, 48); wcat(B.voice, L".wav", 48);
    } else {
        const Sentence *c = &sents[s->lvl][s->i];
        const wch *p;
        int n = 0;
        B.choice[0] = c->ans;
        for (i = 0; i < 3; i++) B.choice[i + 1] = c->wr[i];
        wcopy(B.qtext, c->sent, 160);
        B.hint = c->fr;
        B.fr = c->fr;
        /* line = sentence with the answer in the gap */
        for (p = c->sent; *p && n < 190; p++) {
            if (p[0] == '_' && p[1] == '_' && p[2] == '_') {
                const wch *a = c->ans;
                while (*a && n < 190) B.line[n++] = *a++;
                p += 2;
            } else B.line[n++] = *p;
        }
        B.line[n] = 0;
        wcopy(B.voice, s->lvl == 1 ? L"voice\\a2_" : L"voice\\b1_", 48);
        wcat_int(B.voice, s->i + 1, 48);
        wcat(B.voice, L".wav", 48);
    }
    /* choices = shuffle([ans, ...others]) */
    for (i = 0; i < 4; i++) idx[i] = i;
    shuffle_idx(idx, 4);
    {
        const wch *tmp[4];
        for (i = 0; i < 4; i++) tmp[i] = B.choice[idx[i]];
        for (i = 0; i < 4; i++) { B.choice[i] = tmp[i]; if (idx[i] == 0) B.answer = i; }
    }
}

/* ---------- timers (setTimeout / later) ---------- */
static void later(int what, int ms) { B.next = what; B.next_at = now + (u32)ms; }

static void next_q(void)
{
    int i;
    pick_spec(&B.spec);
    B.has_spec = 1;
    spec_key(&B.spec, B.last_key);
    build_q(&B.spec);
    B.locked = 0; B.hinted = 0; B.intro = 0; B.show_fb = 0; B.timed_out = 0;
    for (i = 0; i < 4; i++) { B.chs[i] = CH_NORMAL; B.off[i] = 0; }
    B.q_start = now;
    B.tm_at = S.mode == 2 ? now + 12000 : 0;
    B.focus = 0; B.focus_shown = 0;
    B.next = NEXT_NONE;
}

static void adapt(void)
{
    wch t[40];
    if (S.ok_streak >= 4 && S.level < 2) {
        S.level++; S.ok_streak = 0;
        wcopy(t, L"Level up! ", 40); wcat(t, LV[S.level], 40);
        toast(t);
        sfx(SFX_CAP);
    } else if (S.ko_streak >= 3 && S.level > 0) {
        S.level--; S.ko_streak = 0;
        wcopy(t, L"Let's practise ", 40); wcat(t, LV[S.level], 40);
        toast(t);
    }
    update_hud();
    save_game();
}

static void answer(int i)
{
    int ok, lv = S.level, k, found = -1;
    if (!B.active || B.locked || S.scene != SC_BATTLE) return;
    B.locked = 1;
    B.tm_at = 0;
    ok = i >= 0 && i == B.answer;
    for (k = 0; k < 4; k++) {
        B.off[k] = 1;
        if (k == B.answer) { B.off[k] = 0; B.chs[k] = CH_OK; }
        else if (k == i) { B.off[k] = 0; B.chs[k] = CH_BAD; }
    }
    B.show_fb = 1;
    B.ok = ok;
    B.timed_out = i < 0;
    B.voice_q = plat_exists(B.voice);
    for (k = 0; k < S.nmissed[lv]; k++) if (spec_eq(&S.missed[lv][k], &B.spec)) { found = k; break; }
    if (ok) {
        sfx(SFX_OK);
        B.hp--; B.shake = 256; S.ok_streak++; S.ko_streak = 0;
        if (found >= 0) {        /* m.splice(k,1) */
            for (k = found; k < S.nmissed[lv] - 1; k++) S.missed[lv][k] = S.missed[lv][k + 1];
            S.nmissed[lv]--;
        }
        adapt();
        if (B.hp <= 0) later(NEXT_CAPTURE, 1000); else later(NEXT_Q, 1400);
    } else {
        sfx(SFX_NO);
        B.hearts--; S.ko_streak++; S.ok_streak = 0;
        if (found < 0 && S.nmissed[lv] < MAXMISSED) S.missed[lv][S.nmissed[lv]++] = B.spec;
        adapt();
        if (B.hearts <= 0) later(NEXT_FLEE, 2000); else later(NEXT_Q, 2300);
    }
}

static void hint(void)
{
    int wrong[4], n = 0, k;
    if (!B.active || B.locked || B.hinted || B.intro || S.mode != 0) return;
    B.hinted = 1;
    for (k = 0; k < 4; k++) if (k != B.answer && !B.off[k]) wrong[n++] = k;
    if (n) B.off[wrong[rnd(n)]] = 1;
    if (B.off[B.focus]) B.focus = B.answer;
}

static void capture(void)
{
    int i, cnt = 0;
    S.scene = SC_CAPTURE;
    B.cap_start = now;
    B.next = NEXT_NONE;
    sfx(SFX_CAP);
    B.is_new = !S.dex[B.c];
    S.dex[B.c] = 1;
    save_game();
    update_hud();
    for (i = 0; i < ncre; i++) cnt += S.dex[i];
    B.done = cnt == ncre;
    B.card = 1;
    B.card_at = now + 800;
}

static void card_shown(void)
{
    wch v[48];
    const Creature *c = &cre[B.c];
    wcopy(v, L"voice\\c_", 48); wcat(v, c->id, 48); wcat(v, L".wav", 48);
    B.voice_card = plat_exists(v);
    B.focus = 0;
    if (B.card == 1) {           /* say(c.word) */
        wch w[48];
        wcopy(w, L"voice\\w_", 48); wcat(w, c->word, 48); wcat(w, L".wav", 48);
        if (!S.muted && plat_exists(w)) plat_wav(w);
    }
}

static void flee(void)
{
    S.scene = SC_FLEE;
    B.next = NEXT_NONE;
    B.card = 2;
    B.card_at = now;
    card_shown();
}

void battle_end(void)
{
    B.active = 0;
    B.card = 0;
    S.scene = SC_MAP;
    S.cool = 4;
    show_map_ui(1);
    update_hud();
}

void battle_start(void)
{
    B.c = rnd(ncre);
    B.active = 1;
    B.hp = 3; B.hearts = 3;
    B.locked = 1; B.shake = 0;
    B.t0 = now; B.cap_start = 0;
    B.last_key[0] = 0;
    B.has_spec = 0;
    B.intro = 1; B.show_fb = 0; B.card = 0;
    B.tm_at = 0; B.hinted = 0;
    S.scene = SC_BATTLE;
    show_map_ui(0);
    later(NEXT_Q, 1000);
}

static int card_visible(void) { return B.card && (int)(now - B.card_at) >= 0; }

void battle_update(void)
{
    if (!B.active) return;
    if (B.next != NEXT_NONE && (int)(now - B.next_at) >= 0) {
        int w = B.next;
        B.next = NEXT_NONE;
        if (w == NEXT_Q) next_q();
        else if (w == NEXT_CAPTURE) capture();
        else if (w == NEXT_FLEE) flee();
    }
    if (B.tm_at && (int)(now - B.tm_at) >= 0) { B.tm_at = 0; answer(-1); }
    if (B.card == 1 && B.card_at && (int)(now - B.card_at) >= 0) { B.card_at = 0; card_shown(); }
    /* b.shake*=.9 per 60 Hz frame = .729 per 50 ms */
    B.shake = B.shake * 187 >> 8;
    if (B.shake < 13) B.shake = 0;
}

/* the A button: skip the wait (b.skip) or press the card's button */
void battle_interact(void)
{
    if (S.scene == SC_BATTLE) {
        if (B.next != NEXT_NONE) B.next_at = now;
    } else if (card_visible()) battle_end();
}

/* ---------- drawing ---------- */
static const wch *mini_label(void)
{
    if (B.show_fb) return B.voice_q ? L"Listen" : 0;
    if (!B.intro && S.mode == 0) return L"Hint";
    return 0;
}

static void choice_rect(int i, int *x, int *y) { *x = (i & 1) ? 122 : 6; *y = (i & 2) ? 274 : 240; }

static void card_buttons(int *n, int *xs, int *ws, const wch **lab)
{
    int total, i;
    *n = 0;
    if (B.card == 1 && B.voice_card) lab[(*n)++] = L"Listen";
    lab[(*n)++] = L"Continue";
    total = 0;
    for (i = 0; i < *n; i++) { ws[i] = text_w(lab[i], -1, 1, 0) + 16; total += ws[i]; }
    total += (*n - 1) * 6;
    xs[0] = (W - total) / 2;
    if (*n > 1) xs[1] = xs[0] + ws[0] + 6;
}

static void draw_card(void)
{
    const Creature *c = &cre[B.c];
    int y, n, i, xs[2], ws[2];
    const wch *lab[2];
    /* .card: left/right 10, top 36, h 246, border 2 + ring 2, padding 10 */
    R(8, 34, 224, 250, C565(0xf6efd5));
    R(10, 36, 220, 246, C565(0x1d2b3a));
    R(12, 38, 216, 242, C565(0xf6efd5));
    para(22, 48 + 1, 196, B.card == 1 ? (B.is_new ? L"Caught!" : L"Caught again!") : L"Oh no!", C565(0xb04a1f), 2, 1, 20, 1, 1);
    r_sprite(c->pix, c->mask, 84, 72, 72, 0, 0);
    if (B.card == 1) {
        para(22, 148 + 4, 196, c->word, C565(0x1d2b3a), 2, 1, 27, 1, 1);
        y = 179;
        n = para(22, y + 2, 196, c->s, C565(0x1d2b3a), 1, 0, 13, 1, 3);
        y += n * 13 + 6;
        n = para(22, y, 196, c->fr, C565(0x6a6040), 1, 0, 11, 1, 3);
        y += n * 11 + 4;
        if (B.done && B.is_new) para(22, y + 2, 196, L"Wordex complete! Try a higher level.", C565(0xb04a1f), 1, 0, 13, 1, 3);
    } else {
        wch t[64];
        wcopy(t, c->name, 64);
        wcat(t, L" ran away", 64);
        para(22, 148 + 2, 196, t, C565(0x1d2b3a), 2, 1, 20, 1, 1);
        para(22, 174, 196, L"Missed questions will come back so you can practise them.", C565(0x1d2b3a), 1, 0, 13, 1, 4);
    }
    card_buttons(&n, xs, ws, lab);
    for (i = 0; i < n; i++) {
        int f = (n == 2) ? (i == 1 ? B.focus == 0 : B.focus == 1) : 1;
        mini_btn(xs[i], 246, ws[i], 24, lab[i], 256, f);
    }
}

static void draw_creature(void)
{
    const Creature *c = &cre[B.c];
    int e, capu = 0, sc, size, bob, sx, x, y;
    /* e=min(1,(t-t0)/350); capU=min(1,(t-capStart)/700); sc=e*(1-capU) (Q8) */
    e = (int)(now - B.t0) * 256 / 350;
    if (e > 256) e = 256;
    if (B.cap_start) { capu = (int)(now - B.cap_start) * 256 / 700; if (capu > 256) capu = 256; }
    sc = e * (256 - capu) >> 8;
    if (sc <= 5 && B.cap_start) {          /* sparkles after the capture */
        int i, r = 20 + (((int)(now - B.cap_start) - 700) / 20) % 16;
        for (i = 0; i < 6; i++) {
            int a = i * 1024 / 6 + (int)(now % 2513) * 1024 / 2513;   /* i/6*2pi + t/400 */
            R(120 + (icos(a) * r >> 14), 112 + (isin(a) * r >> 14), 3, 3, C565(0xffcf4a));
        }
        return;
    }
    size = (96 * sc + 128) >> 8;
    if (size < 2) size = 2;
    bob = B.cap_start ? 0 : isin((int)(now % 1885) * 1024 / 1885) * 3 * 256 >> 14;   /* sin(t/300)*3, Q8 */
    sx = isin((int)(now % 157) * 1024 / 157) * 5 * B.shake >> 14 >> 8;              /* sin(t/25)*5*shake */
    x = 120 - size / 2 + sx;
    y = (137 * 256 - size * 236 + bob + 128) >> 8;                                   /* 137-size*.92+bob */
    r_sprite(c->pix, c->mask, x, y, size, 0, 0);
    if (B.shake > 128) {
        R(120 + sx - 4, 60, 3, 3, C565(0xffffff));
        R(120 + sx + 14, 72, 3, 3, C565(0xffcf4a));
    }
}

static void draw_choice(int i)
{
    int x, y, a = B.off[i] ? 77 : 256;          /* .off: opacity .3 */
    u16 bg = C565(0xf6efd5), ed = C565(0xb9ad82);
    choice_rect(i, &x, &y);
    if (B.chs[i] == CH_OK) { bg = C565(0x7fd47f); ed = C565(0x3f9a3f); }
    if (B.chs[i] == CH_BAD) { bg = C565(0xf08a7a); ed = C565(0xb4473a); }
    if (a < 256) r_group_begin(x, y, 112, 30);
    R(x, y, 112, 27, bg);
    R(x, y + 27, 112, 3, ed);
    {
        int n = para_lines(B.choice[i], 106, 1, 0, 2);
        para(x + 3, y + (27 - n * 11) / 2 + 1, 106, B.choice[i], C565(0x1d2b3a), 1, 0, 11, 1, 2);
    }
    if (a < 256) r_group_end(a);
    if (!B.locked && B.focus_shown && kb_focus && B.focus == i) focus_ring(x, y, 112, 30);
}

static void draw_panel(void)
{
    int i;
    R(0, 172, W, 3, C565(0xffcf4a));
    R(0, 175, W, H - 175, C565(0x1d2b3a));
    /* .tbar (Hard): 228x4 at y 180; the fill empties linearly over 12 s */
    if (S.mode == 2 && !B.intro) {
        int wfill = 0;
        R(6, 180, 228, 4, C565(0x33475b));
        if (!B.locked && B.tm_at) {
            int left = (int)(B.tm_at - now);
            if (left < 0) left = 0;
            wfill = 228 * left / 12000;
        }
        R(6, 180, wfill, 4, C565(0xff8a5c));
    }
    if (B.intro) {
        wch t[64];
        wcopy(t, L"A wild ", 64); wcat(t, cre[B.c].name, 64); wcat(t, L" appeared!", 64);
        para(6, 188 + (50 - 11) / 2, 228, t, C565(0xf6efd5), 1, 0, 12, 0, 4);
        return;
    }
    if (!B.show_fb) {
        /* #qtext: 50 px, content centred vertically; <small> French hint in Easy */
        int n, m = 0, h, y, small = S.mode == 0 && B.hint;
        font_gap = B.spec.t == 'c';
        n = para_lines(B.qtext, 228, 1, 0, 4);
        if (small) m = para_lines(B.hint, 228, 1, 0, 2);
        if (n * 12 + (small ? 2 + m * 10 : 0) > 50) m = 0, small = 0;
        h = n * 12 + (small ? 2 + m * 10 : 0);
        y = 188 + (50 - h) / 2;
        para(6, y + 1, 228, B.qtext, C565(0xf6efd5), 1, 0, 12, 0, 4);
        font_gap = 0;
        if (small) para(6, y + n * 12 + 2, 228, B.hint, C565(0x9fb4c4), 1, 0, 10, 0, 2);
    } else {
        /* #fb: <b> result, <br>, the line, <em> French */
        wch b[96];
        int y = 188, n;
        if (B.ok) wcopy(b, L"\x2713 Correct!", 96);
        else {
            wcopy(b, L"\x2717 ", 96);
            if (B.timed_out) wcat(b, L"Time's up! ", 96);
            wcat(b, L"Answer: ", 96);
            wcat(b, B.choice[B.answer], 96);
        }
        n = para(6, y + 1, 228, b, B.ok ? C565(0x8be08a) : C565(0xff9a8a), 1, 1, 12, 0, 2);
        y += n * 12;
        n = para(6, y + 1, 228, B.line, C565(0xf6efd5), 1, 0, 12, 0, (238 - y) / 12);
        y += n * 12 + 1;
        if (B.fr && y + 10 <= 238) para(6, y, 228, B.fr, C565(0x9fb4c4), 1, 0, 10, 0, (238 - y) / 10);
    }
    for (i = 0; i < 4; i++) draw_choice(i);
}

static void draw_top(void)
{
    wch t[48];
    int w, i, x;
    const wch *ml;
    /* .chip name: #1d2b3a at .87 alpha, padding 3px 6px */
    wcopy(t, L"Wild ", 48); wcat(t, cre[B.c].name, 48);
    w = text_w(t, -1, 1, 0) + 12;
    RA(6, 5, w, 20, C565(0x1d2b3a), 222);
    text(12, 5 + (20 - 9) / 2, t, -1, C565(0xf6efd5), 1, 0);
    /* "Catch" chip + 3 pips */
    w = text_w(L"Catch", -1, 1, 0) + 8;
    RA(6, 28, w, 13, C565(0x1d2b3a), 222);
    text(10, 28 + 2, L"Catch", -1, C565(0xf6efd5), 1, 0);
    x = 6 + w + 3;
    for (i = 0; i < 3; i++) {
        if (i < 3 - B.hp) R(x + i * 15, 30, 12, 8, C565(0xffcf4a));
        else r_frame(x + i * 15, 30, 12, 8, 1, C565(0xffcf4a));
    }
    /* hearts chip, right aligned: "♥" alive, "·" lost, letter-spacing 1px */
    for (i = 0; i < 3; i++) t[i] = (wch)(i < B.hearts ? 0x2665 : 0x00B7);
    t[3] = 0;
    w = 12;
    for (i = 0; i < 3; i++) w += text_w(t + i, 1, 1, 0) + 1 + (t[i] == 0x00B7 ? 2 : 0);
    x = 234 - w;
    RA(x, 5, w, 21, C565(0x1d2b3a), 222);
    x += 6;
    for (i = 0; i < 3; i++) {
        int gw = text_w(t + i, 1, 1, 0);
        text(x + (t[i] == 0x00B7 ? 1 : 0), 5 + 5, t + i, 1, C565(0xff6b6b), 1, 0);
        x += gw + 1 + (t[i] == 0x00B7 ? 2 : 0);
    }
    /* Hint (Easy) / Listen (after an answer, only when the WAV exists) */
    ml = mini_label();
    if (ml) {
        int mw = mini_w(ml);
        int dis = ml[0] == 'H' && (B.hinted || B.locked);
        mini_btn(234 - mw, 29, mw, 24, ml, dis ? 90 : 256, B.focus == 4 && B.focus_shown && !B.locked);
    }
}

void battle_draw(void)
{
    r_blit(battlebg, W, 172, 0, 0);
    R(0, 172, W, H - 172, C565(0x1d2b3a));
    if (!B.active) return;
    draw_creature();
    draw_top();
    draw_panel();
    if (card_visible()) draw_card();
}

/* ---------- input ---------- */
static void mini_press(void)
{
    const wch *ml = mini_label();
    if (!ml) return;
    if (ml[0] == 'H') hint();
    else if (!S.muted) plat_wav(B.voice);
}

static void card_press(int i)
{
    int n, xs[2], ws[2];
    const wch *lab[2];
    card_buttons(&n, xs, ws, lab);
    if (lab[i][0] == 'C') battle_end();
    else if (!S.muted) {
        wch v[48];
        wcopy(v, L"voice\\c_", 48); wcat(v, cre[B.c].id, 48); wcat(v, L".wav", 48);
        plat_wav(v);
    }
}

void battle_pointer(int x, int y)
{
    int i, cx, cy;
    if (card_visible()) {
        int n, xs[2], ws[2];
        const wch *lab[2];
        card_buttons(&n, xs, ws, lab);
        for (i = 0; i < n; i++) if (hit(x, y, xs[i], 246, ws[i], 24)) { card_press(i); return; }
        return;
    }
    if (S.scene != SC_BATTLE) return;
    {
        const wch *ml = mini_label();
        if (ml && hit(x, y, 234 - mini_w(ml), 29, mini_w(ml), 24)) { mini_press(); return; }
    }
    if (B.intro || B.locked) return;
    for (i = 0; i < 4; i++) {
        choice_rect(i, &cx, &cy);
        if (x >= cx && x < cx + 112 && y >= cy && y < cy + 30 && !B.off[i]) { answer(i); return; }
    }
}

void battle_key(int k)
{
    if (k == K_ESC) return;
    if (card_visible()) {
        int n, xs[2], ws[2];
        const wch *lab[2];
        card_buttons(&n, xs, ws, lab);
        if ((k == K_LEFT || k == K_RIGHT) && n == 2) { kb_focus = 1; B.focus = !B.focus; }
        else if (k == K_A) card_press(n == 2 ? (B.focus ? 0 : 1) : 0);
        return;
    }
    if (S.scene != SC_BATTLE) return;
    if (k >= K_1 && k <= K_4) {
        if (!B.locked && !B.intro && !B.off[k - K_1]) answer(k - K_1);
        return;
    }
    if (k == K_HINT) { hint(); return; }
    if (k == K_A) {
        if (B.locked || B.intro) { battle_interact(); return; }
        if (!B.focus_shown) { B.focus_shown = 1; kb_focus = 1; return; }
        if (B.focus == 4) mini_press();
        else if (!B.off[B.focus]) answer(B.focus);
        return;
    }
    if (k <= K_RIGHT && !B.locked && !B.intro) {
        int f = B.focus, tries;
        kb_focus = 1;
        if (!B.focus_shown) { B.focus_shown = 1; return; }
        for (tries = 0; tries < 4; tries++) {
            if (f == 4) { if (k == K_DOWN) f = 1; else if (k == K_LEFT) f = 0; else break; }
            else if (k == K_LEFT) f = f & 2;
            else if (k == K_RIGHT) f = (f & 2) | 1;
            else if (k == K_UP) { if (f >= 2) f -= 2; else if (mini_label() && !B.hinted) f = 4; }
            else if (k == K_DOWN && f < 2) f += 2;
            if (f == 4 || !B.off[f]) break;
        }
        if (f == 4 || !B.off[f]) B.focus = f;
    }
}

/* test harness accessor: 0 answer index, 1 hp, 2 hearts, 3 off mask, 4 locked, 5 intro, 6 creature */
int battle_debug(int what)
{
    switch (what) {
    case 0: return B.answer;
    case 1: return B.hp;
    case 2: return B.hearts;
    case 3: return B.off[0] | B.off[1] << 1 | B.off[2] << 2 | B.off[3] << 3;
    case 4: return B.locked;
    case 5: return B.intro;
    case 6: return B.c;
    }
    return 0;
}

/* test harness: run pick_spec() n times at the current level and count how
   many picks come from the missed list (expected 40 % + chance) */
int battle_pick_stat(int n)
{
    int i, k, hits = 0;
    for (i = 0; i < n; i++) {
        Spec s;
        B.last_key[0] = 0;
        pick_spec(&s);
        for (k = 0; k < S.nmissed[S.level]; k++) if (spec_eq(&S.missed[S.level][k], &s)) { hits++; break; }
    }
    return hits;
}
