/*
 * hello.c - toolchain smoke test for the WordWilds Windows CE port.
 *
 * A 240x320 window with a square that can be dragged with the stylus or
 * moved with the D-pad. Rendering goes through a 16-bit DIB section that is
 * fully redrawn and copied with a single BitBlt, exactly like the game.
 * Escape / Enter quits.
 */
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#include <windows.h>

#define SCR_W 240
#define SCR_H 320

static HBITMAP g_dib;
static unsigned short *g_pix;
static HDC g_memdc;
static int g_x = 104, g_y = 144, g_drag = 0, g_ox, g_oy;

static void fill(int x, int y, int w, int h, unsigned short c)
{
    int i, j;
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > SCR_W) w = SCR_W - x;
    if (y + h > SCR_H) h = SCR_H - y;
    for (j = 0; j < h; j++)
        for (i = 0; i < w; i++)
            g_pix[(y + j) * SCR_W + x + i] = c;
}

static void render(HWND hwnd)
{
    HDC dc;
    fill(0, 0, SCR_W, SCR_H, 0x1967);          /* #1d2b3a */
    fill(g_x, g_y, 32, 32, 0xFE69);            /* #ffcf4a */
    dc = GetDC(hwnd);
    BitBlt(dc, 0, 0, SCR_W, SCR_H, g_memdc, 0, 0, SRCCOPY);
    ReleaseDC(hwnd, dc);
}

static LRESULT CALLBACK wndproc(HWND h, UINT m, WPARAM w, LPARAM l)
{
    int mx = (short)LOWORD(l), my = (short)HIWORD(l);
    switch (m) {
    case WM_ERASEBKGND: return 1;
    case WM_PAINT: { PAINTSTRUCT ps; BeginPaint(h, &ps); EndPaint(h, &ps); render(h); return 0; }
    case WM_LBUTTONDOWN:
        if (mx >= g_x && mx < g_x + 32 && my >= g_y && my < g_y + 32) {
            g_drag = 1; g_ox = mx - g_x; g_oy = my - g_y; SetCapture(h);
        }
        return 0;
    case WM_MOUSEMOVE:
        if (g_drag) { g_x = mx - g_ox; g_y = my - g_oy; render(h); }
        return 0;
    case WM_LBUTTONUP: g_drag = 0; ReleaseCapture(); return 0;
    case WM_KEYDOWN:
        if (w == VK_LEFT) g_x -= 8;
        else if (w == VK_RIGHT) g_x += 8;
        else if (w == VK_UP) g_y -= 8;
        else if (w == VK_DOWN) g_y += 8;
        else if (w == VK_ESCAPE || w == VK_RETURN) { DestroyWindow(h); return 0; }
        render(h);
        return 0;
    case WM_DESTROY: PostQuitMessage(0); return 0;
    }
    return DefWindowProc(h, m, w, l);
}

#ifdef _WIN32_WCE
int WINAPI WinMain(HINSTANCE inst, HINSTANCE prev, LPWSTR cmd, int show)
#else
int WINAPI WinMain(HINSTANCE inst, HINSTANCE prev, LPSTR cmd, int show)
#endif
{
    WNDCLASS wc;
    HWND hwnd;
    MSG msg;
    struct { BITMAPINFOHEADER h; DWORD masks[3]; } bi;
    void *bits;
    (void)prev; (void)cmd;

    ZeroMemory(&wc, sizeof wc);
    wc.lpfnWndProc = wndproc;
    wc.hInstance = inst;
    wc.lpszClassName = L"WWHello";
    RegisterClass(&wc);

    ZeroMemory(&bi, sizeof bi);
    bi.h.biSize = sizeof(BITMAPINFOHEADER);
    bi.h.biWidth = SCR_W;
    bi.h.biHeight = -SCR_H;                    /* top-down */
    bi.h.biPlanes = 1;
    bi.h.biBitCount = 16;
    bi.h.biCompression = BI_BITFIELDS;
    bi.masks[0] = 0xF800; bi.masks[1] = 0x07E0; bi.masks[2] = 0x001F;
    g_dib = CreateDIBSection(NULL, (BITMAPINFO *)&bi, DIB_RGB_COLORS, &bits, NULL, 0);
    if (!g_dib) return 1;
    g_pix = (unsigned short *)bits;
    g_memdc = CreateCompatibleDC(NULL);
    SelectObject(g_memdc, g_dib);

    hwnd = CreateWindow(L"WWHello", L"WW Hello", WS_POPUP | WS_VISIBLE,
                        0, 0, SCR_W, SCR_H, NULL, NULL, inst, NULL);
    ShowWindow(hwnd, show);
    UpdateWindow(hwnd);
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
    DeleteDC(g_memdc);
    DeleteObject(g_dib);
    return 0;
}
