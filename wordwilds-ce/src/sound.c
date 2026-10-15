/*
 * sound.c - the prototype's synthesized beeps, generated once at start-up
 * into static 16-bit mono PCM buffers (22050 Hz), integer maths only.
 *
 *   beep(f,d,type,v,when): oscillator 'square' (or 'sawtooth'), gain v at
 *   start then exponentialRampToValueAtTime(.0001, d), stopped at d+.02.
 *
 *   sfxOk  = beep(660,.1) + beep(880,.16,"square",.04,.09)
 *   sfxNo  = beep(170,.3,"sawtooth",.04)
 *   sfxCap = 523,659,784,1047 Hz, .18 s each, every .12 s
 *   encounter = beep(300,.08)
 *
 * The gain .04 is relative to Web Audio full scale on a desktop; the Axim
 * speaker is much weaker, so the peak level used here is 6000/32767.
 */
#include "ww.h"
#include "plat.h"

#define AMP 6000
#define MAXS (SND_RATE * 6 / 10)      /* longest effect: 0.6 s */

static short pcm[SFX_N][MAXS];
static int len[SFX_N];

/* 2^(-i/16) in Q16 */
static const u16 exp2tab[16] = { 65535, 62757, 60097, 57549, 55109, 52773, 50535, 48393,
                                 46341, 44376, 42495, 40693, 38968, 37316, 35734, 34219 };

/* add a beep; times in milliseconds */
static void beep(int id, int freq, int dur_ms, int saw, int when_ms)
{
    short *b = pcm[id];
    int start = when_ms * SND_RATE / 1000;
    int n = dur_ms * SND_RATE / 1000;           /* ramp length */
    int total = (dur_ms + 20) * SND_RATE / 1000; /* osc.stop(t0+d+.02) */
    u32 phase = 0, inc = (u32)freq * 194783u;   /* 2^32 / 22050 */
    int i;
    for (i = 0; i < total && start + i < MAXS; i++) {
        /* gain = .04 * (.0001/.04)^(t/d) = 2^(-8.644 t/d): exponent in 1/16 octaves */
        int e16 = i < n ? (int)((long)138 * i / n) : 138;
        int env = (exp2tab[e16 & 15] >> (e16 >> 4));       /* Q16 */
        int osc, v, s;
        if (saw) osc = (int)(phase >> 16) - 32768;           /* -32768..32767 */
        else osc = phase < 0x80000000u ? 32767 : -32767;
        v = (int)(((long)osc * AMP) >> 15);
        v = (int)(((long)v * env) >> 16);
        s = b[start + i] + v;
        if (s > 32767) s = 32767;
        if (s < -32768) s = -32768;
        b[start + i] = (short)s;
        phase += inc;
    }
    if (start + i > len[id]) len[id] = start + i;
}

void sound_build(void)
{
    int i;
    beep(SFX_OK, 660, 100, 0, 0);
    beep(SFX_OK, 880, 160, 0, 90);
    beep(SFX_NO, 170, 300, 1, 0);
    for (i = 0; i < 4; i++) {
        static const int f[4] = { 523, 659, 784, 1047 };
        beep(SFX_CAP, f[i], 180, 0, i * 120);
    }
    beep(SFX_ENC, 300, 80, 0, 0);
}

const short *sound_pcm(int id, int *n)
{
    *n = len[id];
    return pcm[id];
}

void sfx(int id)
{
    if (S.muted) return;
    plat_sound(pcm[id], len[id]);
}
