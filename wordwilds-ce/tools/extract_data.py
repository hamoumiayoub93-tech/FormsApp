#!/usr/bin/env python3
"""extract_data.py - generate the WordWilds data files from the HTML prototype.

    python3 tools/extract_data.py ref/wordwilds.html data/

Reads the JavaScript constants WORDS, CL, CREATURES, NPC_COMMON and NPC_LV
from the prototype and writes UTF-8 text files (no BOM, CRLF line endings
so they also read nicely in Pocket Word / Notepad on the device):

    words.csv       en,fr                         (A1 words, used both ways)
    sentences.csv   level,sentence,answer,wrong1,wrong2,wrong3,french
    creatures.csv   id,name,kind,body,dark,light,accent,word,sentence,french
    dialog.txt      key|english|french            (key = common, A1, A2, B1)

CSV fields are quoted when they contain a comma or a quote (RFC 4180).
"""
import csv
import io
import json
import re
import sys


def js_value(src, name):
    """Return the JS literal assigned to `const name=` as a Python object."""
    m = re.search(r"const %s=" % name, src)
    if not m:
        sys.exit("missing const " + name)
    i = m.end()
    depth, j, in_str, quote = 0, i, False, ""
    while True:
        c = src[j]
        if in_str:
            if c == "\\":
                j += 1
            elif c == quote:
                in_str = False
        elif c in "\"'":
            in_str, quote = True, c
        elif c in "[{":
            depth += 1
        elif c in "]}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    lit = src[i:j + 1]
    lit = re.sub(r"([{,])\s*([A-Za-z_]\w*)\s*:", r'\1"\2":', lit)   # quote object keys
    return json.loads(lit)


def write_csv(path, header, rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(header)
    w.writerows(rows)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(buf.getvalue())


def main():
    src = open(sys.argv[1], encoding="utf-8").read()
    out = sys.argv[2].rstrip("/")
    words = js_value(src, "WORDS")
    cl = js_value(src, "CL")
    creatures = js_value(src, "CREATURES")
    npc_common = js_value(src, "NPC_COMMON")
    npc_lv = js_value(src, "NPC_LV")

    write_csv(out + "/words.csv", ["en", "fr"], words)
    rows = []
    for lvl, name in ((1, "A2"), (2, "B1")):
        for sent, ans, wrong, fr in cl[lvl]:
            rows.append([name, sent, ans] + wrong + [fr])
    write_csv(out + "/sentences.csv",
              ["level", "sentence", "answer", "wrong1", "wrong2", "wrong3", "french"], rows)
    write_csv(out + "/creatures.csv",
              ["id", "name", "kind", "body", "dark", "light", "accent", "word", "sentence", "french"],
              [[c["id"], c["name"], c["kind"], c["body"], c["dark"], c["light"], c["accent"],
                c["word"], c["s"], c["fr"]] for c in creatures])
    lines = ["# WordWilds - Prof. Lexi dialog. key|english|french",
             "# 'common' lines are said first, then the line of the current level."]
    for en, fr in npc_common:
        lines.append("common|%s|%s" % (en, fr))
    for name, (en, fr) in zip(("A1", "A2", "B1"), npc_lv):
        lines.append("%s|%s|%s" % (name, en, fr))
    with open(out + "/dialog.txt", "w", encoding="utf-8", newline="") as f:
        f.write("\r\n".join(lines) + "\r\n")
    print("words %d, sentences %d, creatures %d, dialog %d"
          % (len(words), len(rows), len(creatures), len(npc_common) + len(npc_lv)))


if __name__ == "__main__":
    main()
