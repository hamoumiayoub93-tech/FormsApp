/*
 * plat.h - what the game core needs from the platform.
 * Implemented by main.c (Win32 / Windows CE) and sim.c (Linux test harness).
 */
#ifndef PLAT_H
#define PLAT_H

#include "ww.h"

/* Read a file that sits next to the executable. Returns the number of bytes
   read, or -1 if the file cannot be opened. Never reads more than max. */
int plat_read(const wch *name, char *buf, int max);
/* Write (replace) a file next to the executable. Returns 0 on success. */
int plat_write(const wch *name, const char *buf, int len);
/* Does a file exist next to the executable (relative path)? */
int plat_exists(const wch *name);
/* Start a short sound, never blocks. pcm is mono 16-bit SND_RATE Hz. */
void plat_sound(const short *pcm, int n);
/* Play a WAV file next to the executable (voice clips), never blocks. */
void plat_wav(const wch *name);
/* Ask the platform to close the program (after the game saved). */
void plat_quit(void);

#endif
