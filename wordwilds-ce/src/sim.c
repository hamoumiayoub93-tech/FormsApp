/*
 * sim.c - headless PC test harness (Linux / any POSIX), the "compatibility
 * layer" that lets the exact same game code run on a PC without Windows:
 * plat_* functions are implemented with stdio, time is simulated, input
 * comes from a script, screenshots are written as PPM files.
 *
 *   wwsim <run-dir> <script> <out-dir>
 *
 * run-dir holds words.csv, sentences.csv, creatures.csv, dialog.txt and
 * receives save.dat. Script commands (one per line, '#' = comment):
 *   seed N            seed the random generator
 *   rng N             force the next raw random value (encounter: rng 0)
 *   wait MS           advance time by MS (one frame every 50 ms)
 *   key NAME          press+release: up down left right a 1 2 3 4 dex hint esc
 *   hold NAME MS      keep a key down for MS
 *   tap X Y           stylus tap
 *   press X Y MS      stylus held for MS
 *   right / wrong     answer the current question right or wrong (keys 1-4)
 *   tapright          tap the right choice with the stylus
 *   shot NAME         write <out-dir>/NAME.ppm
 *   expect WHAT V     check a value (scene level mode px py dex missed0..2
 *                     okstreak kostreak cool hp hearts quit sounds); exits 1 if wrong
 *   print             dump the state
 *   level N           set the level directly (tests)
 *   pickstat N        run the question picker N times, report missed share
 * Compiled with -fshort-wchar so that wchar_t is 16 bits like on Windows.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "ww.h"
#include "plat.h"

static char run_dir[512];
static int quit_flag, sound_count, wav_count;
static u32 t_now = 1;
static int fails;

static void path_of(const wch *name, char *out)
{
    int n = (int)strlen(run_dir), i;
    memcpy(out, run_dir, (size_t)n);
    out[n++] = '/';
    for (i = 0; name[i] && n < 1000; i++) out[n++] = name[i] == '\\' ? '/' : (char)name[i];
    out[n] = 0;
}

int plat_read(const wch *name, char *buf, int max)
{
    char p[1024];
    FILE *f;
    int n;
    path_of(name, p);
    f = fopen(p, "rb");
    if (!f) return -1;
    n = (int)fread(buf, 1, (size_t)max, f);
    fclose(f);
    return n;
}

int plat_write(const wch *name, const char *buf, int len)
{
    char p[1024];
    FILE *f;
    path_of(name, p);
    f = fopen(p, "wb");
    if (!f) return -1;
    fwrite(buf, 1, (size_t)len, f);
    fclose(f);
    return 0;
}

int plat_exists(const wch *name)
{
    char p[1024];
    FILE *f;
    path_of(name, p);
    f = fopen(p, "rb");
    if (f) fclose(f);
    return f != 0;
}

void plat_sound(const short *pcm, int n) { (void)pcm; (void)n; sound_count++; }
void plat_wav(const wch *name) { (void)name; wav_count++; }
void plat_quit(void) { quit_flag = 1; }

static void advance(int ms)
{
    u32 end = t_now + (u32)ms;
    while (t_now + FRAME_MS <= end) { t_now += FRAME_MS; game_frame(t_now); }
    if (t_now < end) { t_now = end; game_frame(t_now); }
}

static int keyname(const char *s)
{
    static const char *n[] = { "up", "down", "left", "right", "a", "1", "2", "3", "4", "dex", "hint", "esc" };
    int i;
    for (i = 0; i < 12; i++) if (!strcmp(s, n[i])) return i;
    fprintf(stderr, "unknown key %s\n", s);
    exit(2);
}

static void shot(const char *dir, const char *name)
{
    char p[1024];
    FILE *f;
    int i;
    snprintf(p, sizeof p, "%s/%s.ppm", dir, name);
    f = fopen(p, "wb");
    if (!f) { perror(p); exit(2); }
    fprintf(f, "P6\n%d %d\n255\n", W, H);
    for (i = 0; i < W * H; i++) {
        u16 c = fb[i];
        unsigned char rgb[3];
        rgb[0] = (unsigned char)(((c >> 11) & 31) * 255 / 31);
        rgb[1] = (unsigned char)(((c >> 5) & 63) * 255 / 63);
        rgb[2] = (unsigned char)((c & 31) * 255 / 31);
        fwrite(rgb, 1, 3, f);
    }
    fclose(f);
}

static int value(const char *w)
{
    int i, n = 0;
    if (!strcmp(w, "scene")) return S.scene;
    if (!strcmp(w, "level")) return S.level;
    if (!strcmp(w, "mode")) return S.mode;
    if (!strcmp(w, "px")) return S.px;
    if (!strcmp(w, "py")) return S.py;
    if (!strcmp(w, "dex")) { for (i = 0; i < ncre; i++) n += S.dex[i]; return n; }
    if (!strcmp(w, "missed0")) return S.nmissed[0];
    if (!strcmp(w, "missed1")) return S.nmissed[1];
    if (!strcmp(w, "missed2")) return S.nmissed[2];
    if (!strcmp(w, "okstreak")) return S.ok_streak;
    if (!strcmp(w, "kostreak")) return S.ko_streak;
    if (!strcmp(w, "cool")) return S.cool;
    if (!strcmp(w, "hp")) return battle_debug(1);
    if (!strcmp(w, "hearts")) return battle_debug(2);
    if (!strcmp(w, "quit")) return quit_flag;
    if (!strcmp(w, "sounds")) return sound_count;
    if (!strcmp(w, "muted")) return S.muted;
    fprintf(stderr, "unknown value %s\n", w);
    exit(2);
}

int main(int argc, char **argv)
{
    FILE *sc;
    char line[256];
    int lineno = 0;
    if (argc < 4) { fprintf(stderr, "usage: wwsim <run-dir> <script> <out-dir>\n"); return 2; }
    snprintf(run_dir, sizeof run_dir, "%s", argv[1]);
    sc = fopen(argv[2], "r");
    if (!sc) { perror(argv[2]); return 2; }
    rng_seed(12345);
    game_init();
    game_frame(t_now);
    while (fgets(line, sizeof line, sc)) {
        char cmd[32] = "", a[64] = "", b[64] = "", c[64] = "";
        lineno++;
        if (sscanf(line, "%31s %63s %63s %63s", cmd, a, b, c) < 1 || cmd[0] == '#') continue;
        if (!strcmp(cmd, "seed")) rng_seed((u32)strtoul(a, 0, 0));
        else if (!strcmp(cmd, "rng")) rng_push((u32)strtoul(a, 0, 0));
        else if (!strcmp(cmd, "wait")) advance(atoi(a));
        else if (!strcmp(cmd, "key")) { game_key(keyname(a), 1); advance(FRAME_MS); game_key(keyname(a), 0); }
        else if (!strcmp(cmd, "hold")) { game_key(keyname(a), 1); advance(atoi(b)); game_key(keyname(a), 0); }
        else if (!strcmp(cmd, "tap")) { game_pointer(atoi(a), atoi(b), 0); advance(FRAME_MS); game_pointer(atoi(a), atoi(b), 2); }
        else if (!strcmp(cmd, "press")) { game_pointer(atoi(a), atoi(b), 0); advance(atoi(c)); game_pointer(atoi(a), atoi(b), 2); }
        else if (!strcmp(cmd, "right") || !strcmp(cmd, "wrong")) {
            int ans = battle_debug(0), k = ans, off = battle_debug(3);
            if (cmd[0] == 'w') { k = (ans + 1) % 4; while (off & (1 << k) || k == ans) k = (k + 1) % 4; }
            game_key(K_1 + k, 1); advance(FRAME_MS); game_key(K_1 + k, 0);
        }
        else if (!strcmp(cmd, "tapright")) {          /* stylus tap on the right choice */
            int k = battle_debug(0), x = (k & 1) ? 178 : 62, y = (k & 2) ? 289 : 255;
            game_pointer(x, y, 0); advance(FRAME_MS); game_pointer(x, y, 2);
        }
        else if (!strcmp(cmd, "shot")) shot(argv[3], a);
        else if (!strcmp(cmd, "level")) S.level = atoi(a);
        else if (!strcmp(cmd, "pickstat")) {
            int n = atoi(a), h = battle_pick_stat(n);
            printf("pickstat level %d: %d/%d picks from the %d missed questions (%d.%d %%)\n",
                   S.level, h, n, S.nmissed[S.level], h * 100 / n, h * 1000 / n % 10);
        }
        else if (!strcmp(cmd, "expect")) {
            int v = value(a), want = atoi(b);
            if (v != want) { fprintf(stderr, "line %d: expect %s %d, got %d\n", lineno, a, want, v); fails++; }
        } else if (!strcmp(cmd, "print")) {
            printf("t=%u scene=%d level=%d mode=%d pos=%d,%d cool=%d dex=%d missed=%d/%d/%d ok=%d ko=%d hp=%d hearts=%d\n",
                   t_now, S.scene, S.level, S.mode, S.px, S.py, S.cool, value("dex"), S.nmissed[0], S.nmissed[1],
                   S.nmissed[2], S.ok_streak, S.ko_streak, battle_debug(1), battle_debug(2));
        } else { fprintf(stderr, "line %d: unknown command %s\n", lineno, cmd); return 2; }
        if (quit_flag) break;
    }
    fclose(sc);
    if (S.scene == SC_ERROR) {
        int i;
        printf("data error: ");
        for (i = 0; data_error[i]; i++) putchar(data_error[i] < 128 ? (char)data_error[i] : '?');
        printf("\n");
    }
    printf("%s: %d failed expectations, %d sounds, %d wav\n", argv[2], fails, sound_count, wav_count);
    return fails ? 1 : 0;
}
