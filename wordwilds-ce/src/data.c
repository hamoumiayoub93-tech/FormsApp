/*
 * data.c - loads the game content from UTF-8 text files next to the exe:
 *
 *   words.csv       en,fr
 *   sentences.csv   level,sentence,answer,wrong1,wrong2,wrong3,french
 *   creatures.csv   id,name,kind,body,dark,light,accent,word,sentence,french
 *   dialog.txt      key|english|french   (key: common, A1, A2, B1)
 *
 * CSV follows RFC 4180 (fields with commas are "quoted", "" is a quote).
 * Empty lines and lines starting with '#' are ignored, the header line is
 * optional. Text is converted to UTF-16 into a static string pool.
 * Any problem leaves a readable message in data_error (file, line, reason)
 * which the game shows on screen instead of crashing.
 */
#include "ww.h"
#include "plat.h"

Word words[MAXWORDS];
int nwords;
Sentence sents[3][MAXSENT];
int nsents[3];
Creature cre[MAXCRE];
int ncre;
DLine dlg_common[MAXDLG];
int ndlg_common;
DLine dlg_lv[3];
wch data_error[512];

#define POOL 49152
static wch pool[POOL];
static int pool_used;
static char filebuf[65536];

static const wch *cur_file;
static int cur_line;

static int fail(const wch *msg)
{
    wcopy(data_error, cur_file, 512);
    if (cur_line > 0) {
        wcat(data_error, L", line ", 512);
        wcat_int(data_error, cur_line, 512);
    }
    wcat(data_error, L": ", 512);
    wcat(data_error, msg, 512);
    return 0;
}

/* decode one UTF-8 sequence; returns code point or -1 */
static int utf8(const unsigned char **pp, const unsigned char *end)
{
    const unsigned char *p = *pp;
    int c = *p++, n, i;
    if (c < 0x80) { *pp = p; return c; }
    if ((c & 0xE0) == 0xC0) { n = 1; c &= 0x1F; }
    else if ((c & 0xF0) == 0xE0) { n = 2; c &= 0x0F; }
    else if ((c & 0xF8) == 0xF0) { n = 3; c &= 0x07; }
    else return -1;
    for (i = 0; i < n; i++) {
        if (p >= end || (*p & 0xC0) != 0x80) return -1;
        c = (c << 6) | (*p++ & 0x3F);
    }
    *pp = p;
    if (c > 0xFFFF) c = '?';          /* outside the BMP: not in the font anyway */
    return c;
}

/* ---- a tiny record reader shared by the CSV and the '|' format ---- */
typedef struct { const unsigned char *p, *end; } Rd;
#define MAXF 12

/* reads one record into pool strings. returns field count, 0 at end of file,
   -1 on error (message already set). skips blank and '#' lines. */
static int record(Rd *r, char sep, const wch **f)
{
    int nf;
    for (;;) {
        const unsigned char *q;
        if (r->p >= r->end) return 0;
        cur_line++;
        /* blank or comment line? */
        q = r->p;
        while (q < r->end && (*q == ' ' || *q == '\t')) q++;
        if (q >= r->end || *q == '\r' || *q == '\n' || *q == '#') {
            while (r->p < r->end && *r->p != '\n') r->p++;
            if (r->p < r->end) r->p++;
            continue;
        }
        break;
    }
    nf = 0;
    for (;;) {             /* fields */
        int quoted = 0, start = pool_used;
        if (nf >= MAXF) return fail(L"too many columns"), -1;
        if (sep == ',' && r->p < r->end && *r->p == '"') { quoted = 1; r->p++; }
        for (;;) {
            int c;
            if (r->p >= r->end) {
                if (quoted) return fail(L"missing closing quote"), -1;
                break;
            }
            if (quoted) {
                if (*r->p == '"') {
                    if (r->p + 1 < r->end && r->p[1] == '"') { r->p += 2; c = '"'; }
                    else { r->p++; quoted = 0; continue; }
                } else {
                    if (*r->p == '\n') cur_line++;
                    c = utf8(&r->p, r->end);
                }
            } else {
                if (*r->p == sep || *r->p == '\r' || *r->p == '\n') break;
                c = utf8(&r->p, r->end);
            }
            if (c < 0) return fail(L"invalid UTF-8 text (save the file as UTF-8)"), -1;
            if (c == '\r' || c == '\n') c = ' ';
            if (pool_used >= POOL - 1) return fail(L"too much text"), -1;
            pool[pool_used++] = (wch)c;
        }
        /* trim trailing spaces of unquoted fields */
        while (pool_used > start && pool[pool_used - 1] == ' ') pool_used--;
        pool[pool_used++] = 0;
        f[nf++] = pool + start;
        if (r->p < r->end && *r->p == sep) { r->p++; continue; }
        if (r->p < r->end && *r->p == '\r') r->p++;
        if (r->p < r->end && *r->p == '\n') r->p++;
        break;
    }
    return nf;
}

static int weq(const wch *a, const wch *b)
{
    while (*a && *a == *b) { a++; b++; }
    return *a == *b;
}

static int open_file(const wch *name, Rd *r)
{
    int n;
    cur_file = name;
    cur_line = 0;
    n = plat_read(name, filebuf, (int)sizeof filebuf);
    if (n < 0) return fail(L"file not found. Copy it next to wordwilds.exe.");
    if (n >= (int)sizeof filebuf) return fail(L"file too large (64 KB max)");
    r->p = (const unsigned char *)filebuf;
    r->end = r->p + n;
    if (n >= 3 && r->p[0] == 0xEF && r->p[1] == 0xBB && r->p[2] == 0xBF) r->p += 3;   /* BOM */
    return 1;
}

static int check_cols(int nf, int want, const wch *what)
{
    wch m[160];
    if (nf == want) return 1;
    wcopy(m, L"expected ", 160);
    wcat_int(m, want, 160);
    wcat(m, L" columns (", 160);
    wcat(m, what, 160);
    wcat(m, L"), found ", 160);
    wcat_int(m, nf, 160);
    return fail(m);
}

static int nonempty(const wch **f, int nf)
{
    int i;
    for (i = 0; i < nf; i++) if (!f[i][0]) return fail(L"empty field");
    return 1;
}

static int load_words(void)
{
    Rd r;
    const wch *f[MAXF];
    int nf;
    nwords = 0;
    if (!open_file(L"words.csv", &r)) return 0;
    while ((nf = record(&r, ',', f)) != 0) {
        if (nf < 0) return 0;
        if (nf >= 1 && weq(f[0], L"en") && nwords == 0) continue;   /* header */
        if (!check_cols(nf, 2, L"en,fr") || !nonempty(f, nf)) return 0;
        if (nwords >= MAXWORDS) return fail(L"too many words (200 max)");
        words[nwords].en = f[0];
        words[nwords].fr = f[1];
        nwords++;
    }
    cur_line = 0;
    if (nwords < 4) return fail(L"at least 4 words are needed (1 answer + 3 wrong choices)");
    return 1;
}

static int load_sentences(void)
{
    Rd r;
    const wch *f[MAXF];
    int nf, lv;
    nsents[0] = nsents[1] = nsents[2] = 0;
    if (!open_file(L"sentences.csv", &r)) return 0;
    while ((nf = record(&r, ',', f)) != 0) {
        Sentence *s;
        const wch *u;
        if (nf < 0) return 0;
        if (weq(f[0], L"level")) continue;
        if (!check_cols(nf, 7, L"level,sentence,answer,wrong1,wrong2,wrong3,french")) return 0;
        if (!nonempty(f, 6)) return 0;
        if (weq(f[0], L"A2")) lv = 1;
        else if (weq(f[0], L"B1")) lv = 2;
        else return fail(L"level must be A2 or B1");
        for (u = f[1]; *u; u++) if (u[0] == '_' && u[1] == '_' && u[2] == '_') break;
        if (!*u) return fail(L"the sentence needs a ___ gap");
        if (nsents[lv] >= MAXSENT) return fail(L"too many sentences (200 per level max)");
        s = &sents[lv][nsents[lv]++];
        s->sent = f[1]; s->ans = f[2]; s->wr[0] = f[3]; s->wr[1] = f[4]; s->wr[2] = f[5]; s->fr = f[6];
    }
    cur_line = 0;
    if (!nsents[1]) return fail(L"no A2 sentence");
    if (!nsents[2]) return fail(L"no B1 sentence");
    return 1;
}

static int hexcol(const wch *s, u32 *out)
{
    u32 v = 0;
    int i;
    if (s[0] != '#') return 0;
    for (i = 1; i <= 6; i++) {
        wch c = s[i];
        v <<= 4;
        if (c >= '0' && c <= '9') v |= (u32)(c - '0');
        else if (c >= 'a' && c <= 'f') v |= (u32)(c - 'a' + 10);
        else if (c >= 'A' && c <= 'F') v |= (u32)(c - 'A' + 10);
        else return 0;
    }
    if (s[7]) return 0;
    *out = v;
    return 1;
}

static int load_creatures(void)
{
    static const wch *KINDS[6] = { L"leaf", L"flame", L"cloud", L"fin", L"ears", L"horn" };
    Rd r;
    const wch *f[MAXF];
    int nf, k, i;
    ncre = 0;
    if (!open_file(L"creatures.csv", &r)) return 0;
    while ((nf = record(&r, ',', f)) != 0) {
        Creature *c;
        if (nf < 0) return 0;
        if (weq(f[0], L"id")) continue;
        if (!check_cols(nf, 10, L"id,name,kind,body,dark,light,accent,word,sentence,french")) return 0;
        if (!nonempty(f, nf)) return 0;
        if (ncre >= MAXCRE) return fail(L"6 creatures max (the Wordex has 6 cards)");
        c = &cre[ncre];
        c->id = f[0]; c->name = f[1]; c->kind = f[2]; c->word = f[7]; c->s = f[8]; c->fr = f[9];
        c->kindn = -1;
        for (k = 0; k < 6; k++) if (weq(f[2], KINDS[k])) c->kindn = k;
        if (c->kindn < 0) return fail(L"kind must be leaf, flame, cloud, fin, ears or horn");
        if (!hexcol(f[3], &c->body) || !hexcol(f[4], &c->dark) || !hexcol(f[5], &c->light) || !hexcol(f[6], &c->accent))
            return fail(L"colours must look like #e0483d");
        for (i = 0; i < ncre; i++) if (weq(cre[i].id, c->id)) return fail(L"duplicate id");
        ncre++;
    }
    cur_line = 0;
    if (ncre < 1) return fail(L"no creature");
    return 1;
}

static int load_dialog(void)
{
    Rd r;
    const wch *f[MAXF];
    int nf, i;
    ndlg_common = 0;
    for (i = 0; i < 3; i++) dlg_lv[i].en = 0;
    if (!open_file(L"dialog.txt", &r)) return 0;
    while ((nf = record(&r, '|', f)) != 0) {
        if (nf < 0) return 0;
        if (!check_cols(nf, 3, L"key|english|french") || !nonempty(f, nf)) return 0;
        if (weq(f[0], L"common")) {
            if (ndlg_common >= MAXDLG) return fail(L"too many lines");
            dlg_common[ndlg_common].en = f[1];
            dlg_common[ndlg_common].fr = f[2];
            ndlg_common++;
        } else if (weq(f[0], L"A1") || weq(f[0], L"A2") || weq(f[0], L"B1")) {
            i = weq(f[0], L"A1") ? 0 : weq(f[0], L"A2") ? 1 : 2;
            dlg_lv[i].en = f[1];
            dlg_lv[i].fr = f[2];
        } else return fail(L"key must be common, A1, A2 or B1");
    }
    cur_line = 0;
    for (i = 0; i < 3; i++) if (!dlg_lv[i].en) return fail(L"a line for each level (A1, A2, B1) is needed");
    return 1;
}

int data_load(void)
{
    data_error[0] = 0;
    pool_used = 0;
    return load_words() && load_sentences() && load_creatures() && load_dialog();
}
