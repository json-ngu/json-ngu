// Post-process a Platane/snk contribution SVG:
//   1. add month labels (top) and weekday labels (left), tucked close to the grid
//      and drawn underneath the snake so it slides over them;
//   2. make the progress bar grow smoothly instead of jumping at each bite.
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
