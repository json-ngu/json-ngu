// Add month labels (top) and weekday labels (left) to a Platane/snk contribution SVG.
// Usage: node label-snake.mjs <file.svg> <label-color> [YYYY-MM-DD run date, default today UTC]
//
// snk draws one column per week (Sunday..Saturday rows), 16px apart, ending with the
// week that contains the run date. We rely on that layout and on the cells' x/y attributes.
import fs from "node:fs";

const [file, color, dateArg] = process.argv.slice(2);
let svg = fs.readFileSync(file, "utf8");

const STEP = 16, CELL = 12;
const xs = [...svg.matchAll(/<rect class="c[^"]*" x="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
if (!xs.length) throw new Error("no contribution cells found; snk output format changed?");
const minX = Math.min(...xs);
const cols = new Set(xs).size;

// Sunday of the run date's week (UTC), then walk back to the first column.
const today = dateArg ? new Date(`${dateArg}T00:00:00Z`) : new Date();
const lastSunday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - today.getUTCDay());
const weekStart = (col) => new Date(lastSunday - (cols - 1 - col) * 7 * 86400000);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FONT = `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="10" fill="${color}"`;
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
      labels.push(`<text x="${minX + c * STEP}" y="-30" ${FONT}>${MONTHS[m]}</text>`);
      lastLabelCol = c;
    }
  }
  prevMonth = m;
}

// Weekday labels for Mon, Wed, Fri rows.
const minY = Math.min(...[...svg.matchAll(/<rect class="c[^"]*" x="[^"]*" y="(-?[\d.]+)"/g)].map((m) => Number(m[1])));
for (const [row, name] of [[1, "Mon"], [3, "Wed"], [5, "Fri"]]) {
  labels.push(`<text x="-22" y="${minY + row * STEP + CELL - 2}" text-anchor="end" ${FONT}>${name}</text>`);
}

// Grow the canvas: 44px more on the left for weekdays, 24px more on top for months.
const vb = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/);
if (!vb) throw new Error("no viewBox");
const [x, y, w, h] = vb.slice(1).map(Number);
const nx = x - 44, ny = y - 24, nw = w + 44, nh = h + 24;
svg = svg
  .replace(vb[0], `viewBox="${nx} ${ny} ${nw} ${nh}"`)
  .replace(/(<svg[^>]*?) width="[\d.]+"/, `$1 width="${nw}"`)
  .replace(/(<svg[^>]*?) height="[\d.]+"/, `$1 height="${nh}"`)
  .replace(/<\/svg>\s*$/, `<g>${labels.join("")}</g></svg>`);

fs.writeFileSync(file, svg);
console.log(`${file}: ${cols} weeks, ${labels.length - 3} month labels`);
