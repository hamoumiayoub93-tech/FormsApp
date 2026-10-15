/*
 * main.c - Win32 / Windows CE platform layer for WordWilds.
 *
 * Windows CE (Pocket PC 2003, Dell Axim X5): full-screen 240x320 window,
 * the shell task bar is hidden while the game is in front. Only coredll.dll
 * is used (window, GDI, files, waveOut, PlaySound).
 * Desktop Windows (test build, -DWW_PC): same code in a normal window; the
 * command line "-2" or "-3" scales the window for comfort.
 *
 * Rendering: the game draws into a 240x320 16-bit (RGB565) DIB section;
 * each frame is copied to the window with a single BitBlt. WM_ERASEBKGND
 * returns 1 so nothing else ever paints the window (no flicker).
 * A 50 ms timer drives the game (20 frames per second).
 */
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#include <windows.h>
#include <mmsystem.h>
#include "ww.h"
#include "plat.h"

#define CLASS_NAME L"WordWildsWnd"

static HWND g_hwnd;
static HDC g_memdc;
static HBITMAP g_dib, g_olddib;
static u16 *g_bits;
static int g_scale = 1;
static DWORD g_t0;
static int g_quit;
static wch g_dir[MAX_PATH];          /* folder of the exe, with trailing '\' */

/* ---------------- files next to the exe ---------------- */
static void init_dir(void)
{
    int i, last = -1;
    GetModuleFileNameW(NULL, g_dir, MAX_PATH);
    for (i = 0; g_dir[i]; i++) if (g_dir[i] == '\\' || g_dir[i] == '/') last = i;
    g_dir[last + 1] = 0;
}

static void full_path(const wch *name, wch *out)
{
    wcopy(out, g_dir, MAX_PATH);
    wcat(out, name, MAX_PATH);
}

int plat_read(const wch *name, char *buf, int max)
{
    wch p[MAX_PATH];
    HANDLE f;
    DWORD got = 0;
    full_path(name, p);
    f = CreateFileW(p, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (f == INVALID_HANDLE_VALUE) return -1;
    if (!ReadFile(f, buf, (DWORD)max, &got, NULL)) got = 0;
    CloseHandle(f);
    return (int)got;
}

int plat_write(const wch *name, const char *buf, int len)
{
    wch p[MAX_PATH], tmp[MAX_PATH];
    HANDLE f;
    DWORD put = 0;
    BOOL ok;
    full_path(name, p);
    wcopy(tmp, p, MAX_PATH);
    wcat(tmp, L".tmp", MAX_PATH);
    f = CreateFileW(tmp, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (f == INVALID_HANDLE_VALUE) return -1;
    ok = WriteFile(f, buf, (DWORD)len, &put, NULL) && put == (DWORD)len;
    CloseHandle(f);
    if (!ok) { DeleteFileW(tmp); return -1; }
    DeleteFileW(p);                 /* write-then-rename: an interrupted save keeps the old file */
    return MoveFileW(tmp, p) ? 0 : -1;
}

int plat_exists(const wch *name)
{
    wch p[MAX_PATH];
    full_path(name, p);
    return GetFileAttributesW(p) != 0xFFFFFFFF;
}

/* ---------------- sound (waveOut, never blocking) ----------------
   One output stream. A new effect is mixed with what is left of the one
   still playing, written into the other of two static buffers. */
#define MIXMAX (SND_RATE * 12 / 10)
static HWAVEOUT g_wo;
static short g_mix[2][MIXMAX];
static WAVEHDR g_hdr[2];
static int g_cur = -1, g_curlen;
static DWORD g_play_t;

static void sound_open(void)
{
    WAVEFORMATEX f;
    ZeroMemory(&f, sizeof f);
    f.wFormatTag = WAVE_FORMAT_PCM;
    f.nChannels = 1;
    f.nSamplesPerSec = SND_RATE;
    f.wBitsPerSample = 16;
    f.nBlockAlign = 2;
    f.nAvgBytesPerSec = SND_RATE * 2;
    if (waveOutOpen(&g_wo, WAVE_MAPPER, &f, 0, 0, CALLBACK_NULL) != MMSYSERR_NOERROR) g_wo = 0;
}

static void sound_stop(void)
{
    int i;
    if (!g_wo) return;
    waveOutReset(g_wo);
    for (i = 0; i < 2; i++)
        if (g_hdr[i].dwFlags & WHDR_PREPARED) waveOutUnprepareHeader(g_wo, &g_hdr[i], sizeof(WAVEHDR));
    g_cur = -1;
}

void plat_sound(const short *pcm, int n)
{
    int b, i, off = 0, rest = 0, len;
    if (!g_wo) return;
    if (g_cur >= 0) {
        off = (int)((GetTickCount() - g_play_t) * SND_RATE / 1000);
        rest = g_curlen - off;
        if (rest < 0) rest = 0;
    }
    b = g_cur == 0 ? 1 : 0;
    len = n > rest ? n : rest;
    if (len > MIXMAX) len = MIXMAX;
    for (i = 0; i < len; i++) {
        int s = (i < n ? pcm[i] : 0) + (i < rest ? g_mix[g_cur][off + i] : 0);
        g_mix[b][i] = (short)(s > 32767 ? 32767 : s < -32768 ? -32768 : s);
    }
    sound_stop();
    ZeroMemory(&g_hdr[b], sizeof(WAVEHDR));
    g_hdr[b].lpData = (LPSTR)g_mix[b];
    g_hdr[b].dwBufferLength = (DWORD)len * 2;
    if (waveOutPrepareHeader(g_wo, &g_hdr[b], sizeof(WAVEHDR)) != MMSYSERR_NOERROR) return;
    if (waveOutWrite(g_wo, &g_hdr[b], sizeof(WAVEHDR)) != MMSYSERR_NOERROR) return;
    g_cur = b;
    g_curlen = len;
    g_play_t = GetTickCount();
}

void plat_wav(const wch *name)
{
    wch p[MAX_PATH];
    full_path(name, p);
    if (GetFileAttributesW(p) == 0xFFFFFFFF) return;
    sound_stop();
    PlaySoundW(p, NULL, SND_FILENAME | SND_ASYNC | SND_NODEFAULT);
}

void plat_quit(void)
{
    g_quit = 1;
    if (g_hwnd) DestroyWindow(g_hwnd);
}

/* ---------------- Pocket PC shell ---------------- */
static void taskbar(int show)
{
#ifdef _WIN32_WCE
    HWND tb = FindWindowW(L"HHTaskBar", NULL);
    if (tb) {
        ShowWindow(tb, show ? SW_SHOWNORMAL : SW_HIDE);
        EnableWindow(tb, show);
    }
    if (!show && g_hwnd) SetWindowPos(g_hwnd, HWND_TOP, 0, 0, W, H, SWP_SHOWWINDOW);
#else
    (void)show;
#endif
}

/* ---------------- frame ---------------- */
static void present(HDC dc)
{
    if (g_scale == 1) BitBlt(dc, 0, 0, W, H, g_memdc, 0, 0, SRCCOPY);
    else StretchBlt(dc, 0, 0, W * g_scale, H * g_scale, g_memdc, 0, 0, W, H, SRCCOPY);
}

static void frame(void)
{
    HDC dc;
    game_frame(GetTickCount() - g_t0 + 1);
    if (g_quit || !g_hwnd) return;
    dc = GetDC(g_hwnd);
    present(dc);
    ReleaseDC(g_hwnd, dc);
}

static int map_key(WPARAM vk)
{
    switch (vk) {
    case VK_UP: case 'W': return K_UP;
    case VK_DOWN: case 'S': return K_DOWN;
    case VK_LEFT: case 'A': return K_LEFT;
    case VK_RIGHT: case 'D': return K_RIGHT;
    case VK_RETURN: case VK_SPACE: case 'Z': return K_A;
    case '1': case VK_NUMPAD1: return K_1;
    case '2': case VK_NUMPAD2: return K_2;
    case '3': case VK_NUMPAD3: return K_3;
    case '4': case VK_NUMPAD4: return K_4;
    case 'X': case VK_TAB: return K_DEX;
    case 'H': return K_HINT;
    case VK_ESCAPE: return K_ESC;
    }
    return K_OTHER;
}

static LRESULT CALLBACK wndproc(HWND h, UINT m, WPARAM wp, LPARAM lp)
{
    int x = (short)LOWORD(lp) / g_scale, y = (short)HIWORD(lp) / g_scale;
    switch (m) {
    case WM_ERASEBKGND:
        return 1;
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC dc = BeginPaint(h, &ps);
        present(dc);
        EndPaint(h, &ps);
        return 0;
    }
    case WM_TIMER:
        frame();
        return 0;
    case WM_LBUTTONDOWN:
        SetCapture(h);
        game_pointer(x, y, 0);
        return 0;
    case WM_MOUSEMOVE:
        if (wp & MK_LBUTTON) game_pointer(x, y, 1);
        return 0;
    case WM_LBUTTONUP:
        ReleaseCapture();
        game_pointer(x, y, 2);
        return 0;
    case WM_KEYDOWN: {
        int k = map_key(wp);
        if (k == K_OTHER) break;
        if (lp & 0x40000000) return 0;      /* auto-repeat: the game repeats moves itself */
        game_key(k, 1);
        return 0;
    }
    case WM_KEYUP: {
        int k = map_key(wp);
        if (k != K_OTHER) game_key(k, 0);
        return 0;
    }
    case WM_ACTIVATE:
        if (LOWORD(wp) == WA_INACTIVE) {
            KillTimer(h, 1);
            game_pause();
            sound_stop();
            taskbar(1);
        } else {
            taskbar(0);
            SetTimer(h, 1, FRAME_MS, NULL);
        }
        return 0;
    case WM_CLOSE:
        game_quit();
        return 0;
    case WM_DESTROY:
        KillTimer(h, 1);
        taskbar(1);
        g_hwnd = 0;
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(h, m, wp, lp);
}

static int create_dib(void)
{
    struct { BITMAPINFOHEADER h; DWORD masks[3]; } bi;
    void *bits = 0;
    ZeroMemory(&bi, sizeof bi);
    bi.h.biSize = sizeof(BITMAPINFOHEADER);
    bi.h.biWidth = W;
    bi.h.biHeight = -H;                       /* top-down rows */
    bi.h.biPlanes = 1;
    bi.h.biBitCount = 16;
    bi.h.biCompression = BI_BITFIELDS;        /* RGB565 */
    bi.masks[0] = 0xF800; bi.masks[1] = 0x07E0; bi.masks[2] = 0x001F;
    g_dib = CreateDIBSection(NULL, (BITMAPINFO *)&bi, DIB_RGB_COLORS, &bits, NULL, 0);
    if (!g_dib || !bits) return 0;
    g_bits = (u16 *)bits;
    g_memdc = CreateCompatibleDC(NULL);
    g_olddib = (HBITMAP)SelectObject(g_memdc, g_dib);
    return 1;
}

static int run(HINSTANCE inst, const wch *cmd)
{
    WNDCLASSW wc;
    MSG msg;
    DWORD style;
    int ww = W, wh = H;

#ifdef _WIN32_WCE
    {   /* one instance only, like every Pocket PC program */
        HWND old = FindWindowW(CLASS_NAME, NULL);
        if (old) { SetForegroundWindow((HWND)((DWORD)old | 1)); return 0; }
    }
    style = WS_VISIBLE;
    (void)cmd;
#else
    {
        RECT r;
        if (cmd && cmd[0] == '-' && cmd[1] >= '1' && cmd[1] <= '4') g_scale = cmd[1] - '0';
        style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_VISIBLE;
        r.left = 0; r.top = 0; r.right = W * g_scale; r.bottom = H * g_scale;
        AdjustWindowRect(&r, style, FALSE);
        ww = r.right - r.left; wh = r.bottom - r.top;
    }
#endif
    init_dir();
    if (!create_dib()) {
        MessageBoxW(NULL, L"Not enough memory for the screen buffer.", L"WordWilds", MB_OK);
        return 1;
    }
    /* the game draws straight into the DIB section */
    fb = g_bits;
    r_reset_target();
    rng_seed(GetTickCount());
    game_init();
    sound_open();

    ZeroMemory(&wc, sizeof wc);
    wc.lpfnWndProc = wndproc;
    wc.hInstance = inst;
    wc.lpszClassName = CLASS_NAME;
    wc.hbrBackground = NULL;
    RegisterClassW(&wc);
    g_hwnd = CreateWindowW(CLASS_NAME, L"WordWilds", style,
#ifdef _WIN32_WCE
                           0, 0,
#else
                           CW_USEDEFAULT, CW_USEDEFAULT,
#endif
                           ww, wh, NULL, NULL, inst, NULL);
    if (!g_hwnd) return 1;
    g_t0 = GetTickCount();
    taskbar(0);
    ShowWindow(g_hwnd, SW_SHOW);
    UpdateWindow(g_hwnd);
    SetForegroundWindow(g_hwnd);
    SetTimer(g_hwnd, 1, FRAME_MS, NULL);

    while (GetMessageW(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    sound_stop();
    if (g_wo) waveOutClose(g_wo);
    taskbar(1);
    SelectObject(g_memdc, g_olddib);
    DeleteDC(g_memdc);
    DeleteObject(g_dib);
    return 0;
}

#ifdef _WIN32_WCE
int WINAPI WinMain(HINSTANCE inst, HINSTANCE prev, LPWSTR cmd, int show)
{
    (void)prev; (void)show;
    return run(inst, cmd);
}
#else
int WINAPI WinMain(HINSTANCE inst, HINSTANCE prev, LPSTR cmd, int show)
{
    wch w[8];
    int i;
    (void)prev; (void)show;
    for (i = 0; i < 7 && cmd && cmd[i]; i++) w[i] = (wch)(unsigned char)cmd[i];
    w[i] = 0;
    return run(inst, w);
}
#endif
