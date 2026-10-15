// html_shots.js - drive the reference HTML prototype (ref/wordwilds.html) in
// headless Chromium, take 240x320 screenshots of each scene and dump the
// layout boxes of every visible element. Used to compare the native port
// with the prototype (see tools/compare.sh).
//
// usage: node tools/html_shots.js <outdir>
// Math.random is replaced by a seeded PRNG plus a queue (window.__q) so that
// encounters and questions are reproducible.
const path = require("path");
const fs = require("fs");
const { chromium } = require(process.env.PW || "/opt/node-tools/node_modules/playwright");

const out = process.argv[2] || "shots-html";
fs.mkdirSync(out, { recursive: true });
const html = "file://" + path.resolve(__dirname, "../ref/wordwilds.html");

const INIT = `
  (function(){
    let s=12345;
    const prng=()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
    window.__q=[];
    Math.random=()=>window.__q.length?window.__q.shift():prng();
    try{localStorage.clear()}catch(e){}
  })();`;

// WORDS and CL are read from the prototype itself.
const SRC = fs.readFileSync(path.resolve(__dirname, "../ref/wordwilds.html"), "utf8");
const DATA = {
  WORDS: eval(SRC.match(/const WORDS=(\[[\s\S]*?\]\]);/)[1]),
  CL: eval(SRC.match(/const CL=([\s\S]*?);\nconst NPC_COMMON/)[1]),
};

const MAP = [
"TTTTTTTTTTTTTTT","T.............T","T..HH.....gg..T","T..HH.....ggg.T","T..==.....gg..T",
"T..=N=........T","T..===........T","T.....==......T","T.gg....=.....T","Tggg....==..~~T",
"Tgg......=..~~T","T........=gg.~T","T..gggg..=ggg.T","T..gggg..=....T","T..ggg...==...T",
"T........=....T","T.........=...T","TTTTTTTTTTTTTTT"];

// BFS over walkable tiles avoiding tall grass, returns key presses.
function route(from, to) {
  const key = (x, y) => x + "," + y, prev = {}, q = [from];
  prev[key(...from)] = null;
  while (q.length) {
    const [x, y] = q.shift();
    if (x === to[0] && y === to[1]) break;
    for (const [dx, dy, k] of [[0,-1,"ArrowUp"],[0,1,"ArrowDown"],[-1,0,"ArrowLeft"],[1,0,"ArrowRight"]]) {
      const nx = x + dx, ny = y + dy, c = MAP[ny][nx];
      if (!".=".includes(c) || key(nx, ny) in prev) continue;
      prev[key(nx, ny)] = [x, y, k]; q.push([nx, ny]);
    }
  }
  const keys = []; let cur = to;
  while (prev[key(...cur)]) { const p = prev[key(...cur)]; keys.unshift(p[2]); cur = [p[0], p[1]]; }
  return keys;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 316, height: 700 }, deviceScaleFactor: 1 });
  await page.addInitScript(INIT);
  await page.goto(html);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const scr = await page.$("#scr");
  const boxes = {};
  async function shot(name) {
    await scr.screenshot({ path: path.join(out, name + ".png") });
    boxes[name] = await page.evaluate(() => {
      const root = document.getElementById("scr").getBoundingClientRect();
      const res = [];
      document.querySelectorAll("#scr *").forEach(el => {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (!r.width || !r.height || cs.visibility === "hidden" || el.closest(".hidden")) return;
        res.push({ tag: el.tagName, id: el.id, cls: el.className && el.className.baseVal === undefined ? el.className : "",
          x: +(r.left - root.left).toFixed(1), y: +(r.top - root.top).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
          fs: cs.fontSize, fw: cs.fontWeight, lh: cs.lineHeight, color: cs.color, bg: cs.backgroundColor, op: cs.opacity,
          text: el.children.length ? "" : (el.textContent || "").slice(0, 60) });
      });
      return res;
    });
  }
  const press = async (k, wait = 260) => { await page.keyboard.press(k); await page.waitForTimeout(wait); };

  await shot("01_title");
  await page.click('#segMode button[data-m="0"]');      // Easy, to see hint UI
  await shot("02_title_easy");
  await page.click("#start");
  await page.waitForTimeout(300);
  await shot("03_map_toast");
  await page.waitForTimeout(2200);
  await shot("04_map");

  // walk next to the NPC (tile 4,6 is below it) and talk
  for (const k of route([10, 16], [4, 6])) await press(k);
  await press("ArrowUp", 300);          // bump into N -> talk()
  await shot("05_dialog");
  await page.click("#dfr");
  await page.waitForTimeout(100);
  await shot("06_dialog_fr");
  for (let i = 0; i < 4; i++) { await page.click("#dialog"); await page.waitForTimeout(80); }
  await page.waitForTimeout(200);

  // walk to the grass patch at (3,12) and force an encounter
  for (const k of route([4, 6], [3, 11])) await press(k);
  await shot("07_map_walk");
  // creature index 0 (Applet), then the question picks: dir<.5 => french
  await page.evaluate(() => { window.__q = [0.1, 0.0]; });
  await press("ArrowDown", 120);        // enter grass at (3,12) -> encounter
  await shot("08_flash");
  await page.waitForTimeout(560 + 200);
  await shot("09_battle_appear");
  await page.waitForTimeout(1100);
  await shot("10_battle_question");
  await page.click("#bhint");
  await page.waitForTimeout(100);
  await shot("11_battle_hint");

  // click the right (or a wrong) choice: the answer is found from the data
  const choose = async (right) => {
    const idx = await page.evaluate(({ right, WORDS, CL }) => {
      const q = document.getElementById("qtext").textContent;
      const btns = [...document.querySelectorAll("#choices .ch")].map(b => b.textContent);
      let ans = null;
      for (const [en, fr] of WORDS) {
        if (q.includes("“" + en + "” mean")) ans = fr;
        if (q.includes("“" + fr + "” in English")) ans = en;
      }
      for (const lv of [CL[1], CL[2]]) for (const c of lv) if (q.startsWith(c[0].split("___")[0]) && q.includes(c[0].split("___")[1])) ans = c[1];
      const i = btns.indexOf(ans);
      return right ? i : (i + 1) % 4;
    }, { right, WORDS: DATA.WORDS, CL: DATA.CL });
    await page.click(`#choices .ch:nth-child(${idx + 1})`);
  };
  await choose(true);
  await page.waitForTimeout(150);
  await shot("12_feedback_ok");
  await page.keyboard.press("Enter");     // skip
  await page.waitForTimeout(200);
  await choose(false);
  await page.waitForTimeout(150);
  await shot("13_feedback_bad");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  await choose(true); await page.waitForTimeout(150); await page.keyboard.press("Enter"); await page.waitForTimeout(200);
  await choose(true); await page.waitForTimeout(150);
  await page.keyboard.press("Enter");      // -> capture()
  await page.waitForTimeout(350);
  await shot("14_capture_anim");
  await page.waitForTimeout(800);
  await shot("15_capture_card");
  await page.click("#ccont");
  await page.waitForTimeout(200);
  await shot("16_map_after");
  await page.click("#hudDex");
  await page.waitForTimeout(100);
  await shot("17_dex");
  await page.click("#dgrid .dcard:nth-child(1)");
  await page.waitForTimeout(100);
  await shot("18_dex_sel");
  await page.click("#dgrid .dcard:nth-child(2)");
  await page.waitForTimeout(100);
  await shot("19_dex_lock");
  await page.click("#dexClose");
  await page.waitForTimeout(100);

  // second encounter (Keyko), lose 3 times -> flee
  const encounter = async (creature) => {
    for (const k of ["ArrowUp", "ArrowDown", "ArrowUp", "ArrowDown", "ArrowUp"]) await press(k);
    await page.evaluate((c) => { window.__q = [0.1, c / 6 + 0.01]; }, creature);
    await press("ArrowDown", 120);
    await page.waitForTimeout(700 + 1100);
  };
  await encounter(5);
  for (let i = 0; i < 3; i++) {
    await choose(false); await page.waitForTimeout(150);
    await page.keyboard.press("Enter"); await page.waitForTimeout(250);
  }
  await shot("20_flee_card");
  await page.click("#ccont");
  await page.waitForTimeout(200);

  // A2 + Easy: sentence question with the French hint
  await page.click("#reset");
  await page.click('#segLv button[data-lv="1"]');
  await page.click('#segMode button[data-m="0"]');
  await page.click("#start");
  await page.waitForTimeout(2300);
  await encounter(2);
  await shot("21_a2_easy_question");
  await choose(true); await page.waitForTimeout(150);
  await shot("22_a2_feedback");
  await page.keyboard.press("Enter"); await page.waitForTimeout(200);
  for (let i = 0; i < 3; i++) { await choose(false); await page.waitForTimeout(150); await page.keyboard.press("Enter"); await page.waitForTimeout(250); }
  await page.click("#ccont"); await page.waitForTimeout(200);

  // B1 + Hard: timer bar, no FR in dialog
  await page.click("#reset");
  await page.click('#segLv button[data-lv="2"]');
  await page.click('#segMode button[data-m="2"]');
  await shot("23_title_b1_hard");
  await page.click("#start");
  await page.waitForTimeout(2300);
  await encounter(3);
  await page.waitForTimeout(3000);
  await shot("24_b1_hard_question");
  await page.waitForTimeout(9500);
  await shot("25_b1_timeout");
  await browser.close().catch(() => {});
  fs.writeFileSync(path.join(out, "boxes.json"), JSON.stringify(boxes, null, 1));
  console.log("ok", Object.keys(boxes).length);
})().catch(e => { console.error(e); process.exit(1); });
