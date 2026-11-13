// Post-process a Platane/snk contribution SVG:
//   1. keep the snake inside the grid: it ends at the top-left cell, flickers, and resets;
//   2. add month labels (top) and weekday labels (left), tucked close to the grid
//      and drawn underneath the snake so it slides over them;
//   3. make the progress bar grow smoothly instead of jumping at each bite.
// Usage: node tweak-snake.mjs <file.svg> <label-color> <card-color> [YYYY-MM-DD run date, default today UTC]
//
// snk draws one column per week (Sunday..Saturday rows), 16px apart, ending with the
// week that contains the run date. We rely on that layout and on the cells' x/y attributes.
import fs from "node:fs";

const [file, color, cardColor, dateArg] = process.argv.slice(2);
if (!cardColor) throw new Error("usage: tweak-snake.mjs <file.svg> <label-color> <card-color> [date]");
let svg = fs.readFileSync(file, "utf8");

const STEP = 16, CELL = 12;
const GROW = 1.5; // % of the loop each bar step takes to fill (~0.2s of a ~15s loop)

// ---------- keep the snake inside the grid ----------
// snk starts the snake in a lane above the grid and ends by climbing back into it, which
// runs over the month labels. It also stores only some corners of the body's path, so the
// tail cuts diagonally. Rebuild the loop step by step from the head's path:
//   - every body segment follows exactly k steps behind the head (no gliding);
//   - each contribution cell disappears at the step the head lands on it, and the
//     progress bar grows at those same moments;
//   - the snake starts inside the grid, and after its last bite slides to the
//     top-left cell, flickers 3 times, then resets.
// If the SVG doesn't look the way we expect, leave the animation untouched.
try {
  svg = rerouteSnake(svg);
} catch (err) {
  console.warn(`snake reroute skipped: ${err.message}`);
}

function rerouteSnake(svg) {
  const STEP_MS = 100, PAUSE_MS = 150, BLINK_MS = 120, BLINKS = 3;
  // after each reset: grid empty -> contribution cells fade in left to right -> snake starts
  const APPEAR_DELAY_MS = 250, APPEAR_SPAN_MS = 900, FADE_MS = 150, AFTER_APPEAR_MS = 350;
  const D = Number(svg.match(/(\d+)ms/)[1]); // loop length, e.g. "15100ms"
  const N = Math.round(D / STEP_MS), stepPct = 100 / N;
  const cellRects = [...svg.matchAll(/<rect class="c( c[0-9a-z]+)?" x="(-?[\d.]+)" y="(-?[\d.]+)"/g)]; // snk names cells c0..c9, ca, cb, ...
  const maxX = Math.max(...cellRects.map((m) => Number(m[2]))) - 2, maxY = 6 * STEP;
  const key = ([x, y]) => `${x},${y}`;
  const inGrid = ([x, y]) => x >= 0 && y >= 0 && x <= maxX && y <= maxY;

  // head keyframes as sorted [pct, x, y]
  const hk = svg.match(/@keyframes s0\{(.*?)\}\}/);
  if (!hk) throw new Error("snake head keyframes not found");
  const pts = [];
  for (const e of (hk[1] + "}").matchAll(/((?:[\d.]+%,?)+)\{transform:translate\((-?[\d.]+)px,(-?[\d.]+)px\)\}/g))
    for (const p of e[1].split(",").filter(Boolean)) pts.push([parseFloat(p), +e[2], +e[3]]);
  pts.sort((a, b) => a[0] - b[0]);
  // with no 100% keyframe the loop's end falls back to the 0% position
  if (pts[0][0] !== 0) throw new Error("head has no 0% keyframe");
  if (pts[pts.length - 1][0] < 100) pts.push([100, pts[0][1], pts[0][2]]);
  const segCount = [...svg.matchAll(/<rect class="s s\d+"/g)].length;
  if (segCount < 2) throw new Error("snake segments not found");

  // head cell at every step; a diagonal keyframe pair is really a horizontal + vertical run
  const H = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ta, xa, ya] = pts[i], [tb, xb, yb] = pts[i + 1];
    const n = Math.round((tb - ta) / stepPct);
    const hx = Math.abs(xb - xa) / STEP, vy = Math.abs(yb - ya) / STEP;
    if (n === 0) continue;
    if (hx + vy !== 0 && hx + vy !== n) throw new Error(`unexpected head speed at ${ta}%`);
    const run = (horizontalFirst) => {
      const out = [];
      for (let k = 0; k < n; k++) {
        if (hx + vy === 0) { out.push([xa, ya]); continue; }
        const firstLen = horizontalFirst ? hx : vy;
        const f = Math.min(k, firstLen), g = Math.max(0, k - firstLen);
        out.push(horizontalFirst
          ? [xa + Math.sign(xb - xa) * STEP * f, ya + Math.sign(yb - ya) * STEP * g]
          : [xa + Math.sign(xb - xa) * STEP * g, ya + Math.sign(yb - ya) * STEP * f]);
      }
      return out;
    };
    // pick the order that doesn't run the head into its own body
    const recent = H.slice(-segCount).map(key);
    const a = run(true), b = run(false);
    H.push(...(a.some((c, j) => j > 0 && recent.includes(key(c))) ? b : a));
  }
  H.push(pts[pts.length - 1].slice(1));
  if (H.length !== N + 1) throw new Error(`head path has ${H.length - 1} steps, expected ${N}`);

  // animated cells: position + color level
  const cells = [];
  for (const m of cellRects) if (m[1]) {
    const name = m[1].trim(), level = svg.match(new RegExp(`\\.c\\.${name}\\{fill:var\\(--(c\\d)\\)`));
    if (!level) throw new Error(`no color for ${name}`);
    cells.push({ name, pos: [Number(m[2]) - 2, Number(m[3]) - 2], level: level[1] });
  }
  const firstVisit = (pos) => H.findIndex((c) => key(c) === key(pos));
  const visits = cells.map((c) => firstVisit(c.pos));
  if (visits.some((v) => v < 0)) throw new Error("head never reaches a contribution cell");
  const lastEat = Math.max(...visits);

  // in-grid window [iIn, iOut]
  const distinct = (arr) => new Set(arr.map(key)).size === arr.length;
  let iIn = -1;
  for (let i = segCount - 1; i <= N && iIn < 0; i++) {
    const body = H.slice(i - segCount + 1, i + 1);
    if (body.every(inGrid) && distinct(body)) iIn = i;
  }
  const iExit = H.findIndex((c, i) => i > lastEat && !inGrid(c));
  if (iIn < 0 || iExit < 0 || iExit - 1 <= iIn) throw new Error("could not find in-grid window");
  const iOut = iExit - 1;

  // route from the last in-grid head cell to the top-left, avoiding the body
  const walk = ([x, y], horizontalFirst) => {
    const r = [];
    const mx = () => { while (x > 0) { x -= STEP; r.push([x, y]); } };
    const my = () => { while (y > 0) { y -= STEP; r.push([x, y]); } };
    horizontalFirst ? (mx(), my()) : (my(), mx());
    return r;
  };
  const bodyAtEnd = H.slice(iOut - segCount + 1, iOut).map(key);
  const route = [walk(H[iOut], true), walk(H[iOut], false)].find((r) => !r.some((c) => bodyAtEnd.includes(key(c))));
  if (!route) throw new Error("no clear route to the top-left");

  // G: the cells the snake walks; segment k at new step j sits on G[base + j - k]
  const G = [...H.slice(iIn - segCount + 1, iOut + 1), ...route];
  const base = segCount - 1, M = G.length - 1 - base;
  // stagger the cells' fade-in by column (then row); cells under the starting snake stay hidden
  const showing = cells.filter((c) => !G.slice(0, base).some((g) => key(g) === key(c.pos)) || key(G[base]) === key(c.pos))
    .sort((a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1]);
  const stagger = showing.length > 1 ? Math.min(60, (APPEAR_SPAN_MS - FADE_MS) / (showing.length - 1)) : 0;
  showing.forEach((c, i) => { c.appear = APPEAR_DELAY_MS + i * stagger; });
  const START_HOLD_MS = Math.round(APPEAR_DELAY_MS + (showing.length - 1) * stagger + FADE_MS + AFTER_APPEAR_MS);
  const stepMs = (j) => START_HOLD_MS + j * STEP_MS;
  const moveEnd = stepMs(M);
  const D2 = moveEnd + PAUSE_MS + 2 * BLINKS * BLINK_MS;
  const pct = (ms) => +(ms / D2 * 100).toFixed(3);
  const nudge = (ms) => +(pct(ms) + 0.02).toFixed(3);

  let out = svg;
  for (let k = 0; k < segCount; k++) {
    const [hx0, hy0] = G[base - k];
    let kf = `0%{transform:translate(${hx0}px,${hy0}px)}`;
    for (let j = 0; j <= M; j++) { const [x, y] = G[base + j - k]; kf += `${pct(stepMs(j))}%{transform:translate(${x}px,${y}px)}`; }
    const [ex, ey] = G[base + M - k];
    kf += `100%{transform:translate(${ex}px,${ey}px)}`;
    out = out.replace(new RegExp(`@keyframes s${k}\\{.*?\\}\\}`), `@keyframes s${k}{${kf}}`);
    const [sx, sy] = G[base - k];
    out = out.replace(new RegExp(`\\.s\\.s${k}\\{transform:translate\\([^)]*\\);animation-name:s${k}`),
      `.s.s${k}{transform:translate(${sx}px,${sy}px);animation-name:s${k},sflick`);
  }

  // flicker: on until the pause ends, then off/on BLINKS times
  let flick = `0%,${pct(moveEnd + PAUSE_MS)}%{opacity:1}`;
  for (let b = 0; b < BLINKS; b++) {
    const off = moveEnd + PAUSE_MS + 2 * b * BLINK_MS, on = off + BLINK_MS;
    flick += `${nudge(off)}%,${pct(on)}%{opacity:0}${nudge(on)}%,${b === BLINKS - 1 ? 100 : pct(on + BLINK_MS)}%{opacity:1}`;
  }
  out = out.replace("</style>", `@keyframes sflick{${flick}}</style>`);

  // eat time of each cell = the step the head lands on it in the new loop (start-pose cells: 0)
  const eatMs = (pos) => {
    for (let j = 0; j <= M; j++) if (key(G[base + j]) === key(pos)) return j === 0 ? 0 : stepMs(j);
    if (G.slice(0, base).some((c) => key(c) === key(pos))) return 0;
    throw new Error("cell not on the snake's route");
  };
  for (const c of cells) {
    c.eat = eatMs(c.pos);
    const kf = c.appear === undefined || c.eat === 0
      ? `0%,100%{fill:var(--ce)}` // under the snake at the start: already eaten
      : `0%,${pct(c.appear)}%{fill:var(--ce)}${pct(c.appear + FADE_MS)}%,${pct(c.eat)}%{fill:var(--${c.level})}${nudge(c.eat)}%,100%{fill:var(--ce)}`;
    out = out.replace(new RegExp(`@keyframes ${c.name}\\{.*?\\}\\}`), `@keyframes ${c.name}{${kf}}`);
    // start each loop empty: the cell's resting color is the empty color
    out = out.replace(new RegExp(`(\\.c\\.${c.name}\\{fill:)var\\(--c\\d\\)`), "$1var(--ce)");
  }

  // progress bar: one segment per color level, stepping up at each of that level's bites
  for (const m of svg.matchAll(/\.u\.(u\d+)\{fill:var\(--(c\d)\)/g)) {
    const [, name, level] = m;
    const eats = cells.filter((c) => c.level === level).map((c) => c.eat).sort((a, b) => a - b);
    if (!eats.length) continue;
    let kf = `${pct(eats[0])}%{transform:scale(0.000,1)}`;
    eats.forEach((e, i) => {
      kf += `${nudge(e)}%,${i < eats.length - 1 ? pct(eats[i + 1]) : 100}%{transform:scale(${((i + 1) / eats.length).toFixed(3)},1)}`;
    });
    out = out.replace(new RegExp(`@keyframes ${name}\\{.*?\\}\\}`), `@keyframes ${name}{${kf}}`);
  }

  out = out.split(`${D}ms`).join(`${D2}ms`);
  console.log(`snake reroute: steps ${iIn}..${iOut} of ${N}, ${route.length} steps to top-left, loop ${D}ms -> ${D2}ms`);
  return out;
}

// ---------- labels ----------
const cells = [...svg.matchAll(/<rect class="c[^"]*" x="(-?[\d.]+)" y="(-?[\d.]+)"/g)];
if (!cells.length) throw new Error("no contribution cells found; snk output format changed?");
const minX = Math.min(...cells.map((m) => Number(m[1])));
const minY = Math.min(...cells.map((m) => Number(m[2])));
const cols = new Set(cells.map((m) => m[1])).size;

const today = dateArg ? new Date(`${dateArg}T00:00:00Z`) : new Date();
const lastSunday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - today.getUTCDay());
const weekStart = (col) => new Date(lastSunday - (cols - 1 - col) * 7 * 86400000);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FONT = `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" fill="${color}"`;
const labels = [];

// Month label on the first column whose week starts in a new month,
// skipped if it would crowd the previous label (like GitHub's own graph).
let prevMonth = weekStart(0).getUTCMonth(), lastLabelCol = -10;
for (let c = 0; c < cols; c++) {
  const m = weekStart(c).getUTCMonth();
  if (c === 0 || m !== prevMonth) {
    const fitsBefore = c - lastLabelCol >= 3;
    const isPartialFirst = c === 0 && weekStart(1).getUTCMonth() !== m;
    if (fitsBefore && !isPartialFirst) {
      labels.push(`<text x="${minX + c * STEP}" y="${minY - 8}" ${FONT}>${MONTHS[m]}</text>`);
      lastLabelCol = c;
    }
  }
  prevMonth = m;
}
for (const [row, name] of [[1, "Mon"], [3, "Wed"], [5, "Fri"]]) {
  labels.push(`<text x="${minX - 9}" y="${minY + row * STEP + CELL - 2}" text-anchor="end" ${FONT}>${name}</text>`);
}

// Insert before the first cell so the grid, bar and snake all draw on top.
const firstCell = svg.indexOf('<rect class="c');
svg = svg.slice(0, firstCell) + `<g>${labels.join("")}</g>` + svg.slice(firstCell);

// Widen the canvas on the left just enough for "Wed".
const vb = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/);
if (!vb) throw new Error("no viewBox");
const [x, y, w, h] = vb.slice(1).map(Number);
const EXTRA_LEFT = 21;
svg = svg
  .replace(vb[0], `viewBox="${x - EXTRA_LEFT} ${y} ${w + EXTRA_LEFT} ${h}"`)
  .replace(/(<svg[^>]*?) width="[\d.]+"/, `$1 width="${w + EXTRA_LEFT}"`);

// ---------- progress bar outline ----------
// A thin border around the whole bar track so its full length is visible before it fills.
const bars = [...svg.matchAll(/<rect class="u[^"]*" height="([\d.]+)" width="([\d.]+)" x="(-?[\d.]+)" y="(-?[\d.]+)"/g)]
  .map((m) => ({ h: Number(m[1]), w: Number(m[2]), x: Number(m[3]), y: Number(m[4]) }));
if (!bars.length) throw new Error("no progress-bar segments found; snk output format changed?");
const bx = Math.min(...bars.map((b) => b.x)), bEnd = Math.max(...bars.map((b) => b.x + b.w));
const by = bars[0].y, bh = bars[0].h, PAD = 2;
const outline = `<rect x="${bx - PAD}" y="${by - PAD}" width="${+(bEnd - bx + 2 * PAD).toFixed(1)}" height="${bh + 2 * PAD}" rx="3" fill="none" stroke="${color}" stroke-opacity="0.6" stroke-width="1"/>`;
svg = svg.replace(/<\/svg>\s*$/, `${outline}</svg>`);

// ---------- background card ----------
// Paint a panel in the page color for this theme, with a little padding around the graph.
const BG = cardColor, CARD_PAD = 14;
const vb2 = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/);
const [cx, cy, cw, ch] = vb2.slice(1).map(Number);
const [px, py, pw, ph] = [cx - CARD_PAD, cy - CARD_PAD, cw + 2 * CARD_PAD, ch + 2 * CARD_PAD];
svg = svg
  .replace(vb2[0], `viewBox="${px} ${py} ${pw} ${ph}"`)
  .replace(/(<svg[^>]*?) width="[\d.]+"/, `$1 width="${pw}"`)
  .replace(/(<svg[^>]*?) height="[\d.]+"/, `$1 height="${ph}"`);
const firstLabel = svg.indexOf("<g><text");
svg = svg.slice(0, firstLabel) + `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="12" fill="${BG}"/>` + svg.slice(firstLabel);

// ---------- smooth progress bar ----------
// snk writes each bar segment as steps like "33.78%,35.75%{transform:scale(0.364,1)}":
// it jumps to the new width 0.02% after a bite, then holds. Start each hold GROW% later
// so CSS (linear timing) interpolates from the previous width: a short left-to-right fill.
let steps = 0;
svg = svg.replace(/@keyframes u\d+\{.*?\}\}/g, (block) =>
  block.replace(/([\d.]+)%,([\d.]+)%\{transform:scale\(([\d.]+),1\)\}/g, (_, a, b, s) => {
    steps++;
    const start = Math.min(Number(a) + GROW, Number(b));
    return `${+start.toFixed(2)}%,${b}%{transform:scale(${s},1)}`;
  }));
if (!steps) throw new Error("no progress-bar keyframes found; snk output format changed?");

fs.writeFileSync(file, svg);
console.log(`${file}: ${cols} weeks, ${labels.length - 3} month labels, ${steps} smoothed bar steps`);
