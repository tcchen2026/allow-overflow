// Minimal QR encoder: byte mode, error correction M, versions 1–6 (up to 106 bytes), no deps.
// Used by the share card (challenge link) and tools/qr.mjs (the desktop panel's qr.svg).
// Layout follows ISO/IEC 18004; structure after Nayuki's qrcodegen.

// Per version, ECC level M: [data codewords per block, block count, EC codewords per block].
const BLOCKS = [null, [16, 1, 10], [28, 1, 16], [44, 1, 26], [32, 2, 18], [43, 2, 24], [27, 4, 16]];

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
  (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

/** Dark/light modules as rows of booleans, quiet zone not included. */
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  // Byte mode spends 12 header bits, so a version holds two bytes less than its data codewords.
  const version = BLOCKS.findIndex(b => b && b[0] * b[1] - 2 >= bytes.length);
  if (version < 0) throw new RangeError(`QR: ${bytes.length} bytes exceeds version 6`);
  const [dataLen, blocks, ecLen] = BLOCKS[version];
  const codewords = interleave(encodeData(bytes, dataLen * blocks), dataLen, blocks, ecLen);

  const size = version * 4 + 17;
  const dark = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));   // function patterns
  const set = (x, y, on) => { dark[y][x] = on; fixed[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }   // timing
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {                  // finders + separators
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, ring = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, ring !== 2 && ring !== 4);
      }
    }
  }
  if (version > 1) {                                       // versions 2–6 have one alignment pattern
    const c = size - 7;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  drawFormat(set, size, 0);                                // reserve the format areas for now

  // Codeword bits zigzag up and down two-column strips from the right, skipping the timing column.
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (const x of [right, right - 1]) {
        if (fixed[y][x] || bit >= codewords.length * 8) continue;
        dark[y][x] = ((codewords[bit >> 3] >> (7 - (bit & 7))) & 1) === 1;
        bit++;
      }
    }
  }

  // Try all eight masks; keep the one scanners find easiest (lowest penalty).
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const modules = dark.map((row, y) => row.map((on, x) => on !== (!fixed[y][x] && MASKS[mask](x, y))));
    drawFormat((x, y, on) => { modules[y][x] = on; }, size, mask);
    const score = penalty(modules);
    if (!best || score < best.score) best = { score, modules };
  }
  return best.modules;
}

/** Self-contained SVG: white tile, dark modules, `quiet` modules of margin. */
export function qrSvg(text, { quiet = 4 } = {}) {
  const modules = qrMatrix(text);
  const n = modules.length + quiet * 2;
  let path = '';
  modules.forEach((row, y) => row.forEach((on, x) => { if (on) path += `M${x + quiet} ${y + quiet}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">`
    + `<rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#0b0a12"/></svg>`;
}

// ── encoding ────────────────────────────────────────────────────────────────

/** Mode + length + bytes, terminated and padded to exactly `total` codewords. */
function encodeData(bytes, total) {
  const bits = [];
  const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);                                         // byte mode
  push(bytes.length, 8);                                   // 8-bit count for versions 1–9
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, total * 8 - bits.length));           // terminator
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  for (let pad = 0xec; out.length < total; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Split into blocks, append Reed-Solomon EC per block, interleave column-wise. */
function interleave(data, dataLen, blocks, ecLen) {
  const divisor = rsDivisor(ecLen);
  const groups = Array.from({ length: blocks }, (_, i) => data.slice(i * dataLen, (i + 1) * dataLen));
  const ecc = groups.map(group => rsRemainder(group, divisor));
  const out = [];
  for (let i = 0; i < dataLen; i++) for (const group of groups) out.push(group[i]);
  for (let i = 0; i < ecLen; i++) for (const ec of ecc) out.push(ec[i]);
  return out;
}

/** 15 format bits (ECC level M + mask, BCH-protected), in both copies, plus the dark module. */
function drawFormat(set, size, mask) {
  const data = (0b00 << 3) | mask;                         // level M encodes as 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const on = i => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, on(i));
  set(8, 7, on(6));
  set(8, 8, on(7));
  set(7, 8, on(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, on(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, on(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, on(i));
  set(8, size - 8, true);
}

/** ISO penalty rules: long runs, 2×2 blocks, finder look-alikes, dark/light imbalance. */
function penalty(m) {
  const n = m.length;
  const FINDER = ['10111010000', '00001011101'];
  let score = 0;
  for (const line of [...m, ...m.map((_, x) => m.map(row => row[x]))]) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++;
      else { if (run >= 5) score += run - 2; run = 1; }
    }
    const s = line.map(Number).join('');
    for (const f of FINDER) for (let i = s.indexOf(f); i >= 0; i = s.indexOf(f, i + 1)) score += 40;
  }
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
  }
  const darkCount = m.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  return score + (Math.ceil(Math.abs(darkCount * 20 - n * n * 10) / (n * n)) - 1) * 10;
}

// ── Reed-Solomon over GF(2^8), polynomial 0x11D ─────────────────────────────

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}
