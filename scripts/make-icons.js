// 앱·트레이 아이콘을 PNG로 그린다 (의존성 없음): 주황 타일 위 하얀 아이소메트릭 건물
//   node scripts/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const inPoly = (pts) => (x, y) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const inCircle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const inRound = (x0, y0, x1, y1, r) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

function building(dot) {
  const L = [0.22, 0.36], T = [0.5, 0.22], R = [0.78, 0.36], B = [0.5, 0.5], H = 0.32;
  const down = (p) => [p[0], p[1] + H];
  const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  const facePt = (a, b, u, v) => { const p = lerp(a, b, u); return [p[0], p[1] + v * H]; };
  const win = (a, b, i, j) => inPoly([facePt(a, b, 0.14 + i * 0.42, 0.16 + j * 0.28), facePt(a, b, 0.44 + i * 0.42, 0.16 + j * 0.28), facePt(a, b, 0.44 + i * 0.42, 0.34 + j * 0.28), facePt(a, b, 0.14 + i * 0.42, 0.34 + j * 0.28)]);
  const shapes = [
    [inRound(0.04, 0.04, 0.96, 0.96, 0.22), '#e2763a'],
    [inPoly([[0.04, 0.55], [0.96, 0.55], [0.96, 0.96], [0.04, 0.96]]), null], // 아래쪽 살짝 진하게 (아래 처리)
    [inPoly([L, B, down(B), down(L)]), '#fde8da'],
    [inPoly([B, R, down(R), down(B)]), '#f4bf9f'],
    [inPoly([L, T, R, B]), '#ffffff'],
  ];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) { shapes.push([win(L, B, i, j), '#e2763a']); shapes.push([win(B, R, i, j), '#c75e26']); }
  if (dot) { shapes.push([inCircle(0.79, 0.79, 0.21), '#ffffff']); shapes.push([inCircle(0.79, 0.79, 0.15), dot]); }
  return shapes;
}

function render(size, shapes) {
  const px = Buffer.alloc(size * size * 4);
  const S = 4; // 4x4 슈퍼샘플링으로 가장자리 부드럽게
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = (x + (sx + 0.5) / S) / size, v = (y + (sy + 0.5) / S) / size;
      let col = null;
      for (const [test, c] of shapes) {
        if (!test(u, v)) continue;
        if (c) col = hex(c);
        else if (col) col = col.map((k) => Math.round(k * 0.9)); // 그림자 띠
      }
      if (col) { r += col[0]; g += col[1]; b += col[2]; a++; }
    }
    const i = (y * size + x) * 4, n = S * S;
    if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; px[i + 3] = Math.round(255 * a / n); }
  }
  return png(size, px);
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// PNG를 그대로 담는 ICO (Windows Vista 이상)
function ico(pngs) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = 6 + 16 * pngs.length; const dir = [];
  for (const [size, data] of pngs) {
    const e = Buffer.alloc(16); e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(off, 12); off += data.length; dir.push(e);
  }
  return Buffer.concat([head, ...dir, ...pngs.map((p) => p[1])]);
}

const root = path.join(__dirname, '..');
const out = (rel, buf) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); console.log('✔', rel, buf.length, 'bytes'); };
const icon = building(null);
out('build/icon.png', render(512, icon));
out('electron/assets/icon.png', render(256, icon));
out('build/icon.ico', ico([16, 24, 32, 48, 64, 128, 256].map((s) => [s, render(s, icon)])));
out('public/favicon.png', render(64, icon));
for (const [name, dot] of [['tray', null], ['tray-busy', '#22c55e'], ['tray-ask', '#facc15']]) {
  out(`electron/assets/${name}.png`, render(32, building(dot)));
  out(`electron/assets/${name}@2x.png`, render(64, building(dot)));
}
