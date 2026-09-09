#!/usr/bin/env node
/* Compare two directories of design-review captures.
 *
 *   node scripts/review-diff.mjs <baseline-dir> <current-dir> [--max <ratio>]
 *
 * Why not checksums: the review suite is not byte-deterministic. Two runs of
 * identical code differ by a few dozen pixels — a caret, a focus ring, a
 * glyph's antialiasing. A checksum calls that "changed" and a reviewer who
 * sees every file flagged learns nothing and stops looking. So this measures
 * how much moved, and where.
 *
 * The bounding box is the useful part: it tells you which corner of the
 * screenshot to open, instead of leaving you to spot the difference.
 */
import { readFileSync, readdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join } from "node:path";

/* Enough PNG to read what Playwright writes: 8-bit, non-interlaced. */
function decode(path) {
  const buf = readFileSync(path);
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`${path}: unsupported bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`${path}: unsupported colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

function compare(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { resized: true };
  const ch = a.channels;
  let differing = 0, maxDelta = 0;
  let minX = a.width, minY = a.height, maxX = -1, maxY = -1;
  for (let i = 0, p = 0; i < a.data.length; i += ch, p++) {
    let d = 0;
    for (let c = 0; c < Math.min(3, ch); c++) d = Math.max(d, Math.abs(a.data[i + c] - b.data[i + c]));
    if (d === 0) continue;
    differing++;
    if (d > maxDelta) maxDelta = d;
    const x = p % a.width, y = (p / a.width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    differing,
    total: a.width * a.height,
    maxDelta,
    box: maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
  };
}

const [baselineDir, currentDir] = process.argv.slice(2);
const maxFlag = process.argv.indexOf("--max");
/* The measured run-to-run floor is about 0.007%. This sits a few times above
   it: high enough that a caret does not cry wolf, low enough that a changed
   colour, border or size cannot hide. */
const MAX_RATIO = maxFlag > -1 ? Number(process.argv[maxFlag + 1]) : 0.0005;

if (!baselineDir || !currentDir) {
  console.error("usage: node scripts/review-diff.mjs <baseline-dir> <current-dir> [--max <ratio>]");
  process.exit(2);
}

const png = (dir) => new Set(readdirSync(dir).filter((f) => f.endsWith(".png")));
const before = png(baselineDir), after = png(currentDir);

const gone = [...before].filter((f) => !after.has(f));
const added = [...after].filter((f) => !before.has(f));
const shared = [...before].filter((f) => after.has(f)).sort();

const moved = [];
for (const file of shared) {
  const result = compare(decode(join(baselineDir, file)), decode(join(currentDir, file)));
  if (result.resized) {
    moved.push({ file, note: "different dimensions", ratio: 1 });
    continue;
  }
  const ratio = result.differing / result.total;
  if (ratio > MAX_RATIO) {
    moved.push({
      file,
      ratio,
      note: `${result.differing} px (${(ratio * 100).toFixed(3)}%), max delta ${result.maxDelta}, box ${result.box.w}x${result.box.h} at ${result.box.x},${result.box.y}`,
    });
  }
}

for (const f of gone) console.log(`− missing:  ${f}`);
for (const f of added) console.log(`+ new:      ${f}`);
moved.sort((a, b) => b.ratio - a.ratio);
for (const m of moved) console.log(`~ changed:  ${m.file} — ${m.note}`);

const verdict = moved.length === 0 && gone.length === 0;
console.log(
  `${verdict ? "✔" : "✗"} review-diff: ${shared.length} compared, ${moved.length} beyond the ${(MAX_RATIO * 100).toFixed(3)}% floor, ${gone.length} missing, ${added.length} new`,
);
process.exit(verdict ? 0 : 1);
