// 아이소메트릭 투영과 그리기 도구
export const TW = 44, TH = 22;
export const iso = (x, y, z = 0) => [(x - y) * TW / 2, (x + y) * TH / 2 - z];

export let ctx = null;
export const setCtx = (c) => { ctx = c; };

function hex2rgb(h) {
  if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255];
}
const shadeCache = new Map();
// a < 0 이면 어둡게, a > 0 이면 밝게
export function shade(h, a) {
  const k = h + a; let v = shadeCache.get(k);
  if (v) return v;
  if (!h.startsWith('#')) return h;
  const [r, g, b] = hex2rgb(h);
  const f = (c) => Math.round(a < 0 ? c * (1 + a) : c + (255 - c) * a);
  v = `rgb(${f(r)},${f(g)},${f(b)})`; shadeCache.set(k, v); return v;
}

export function poly(pts, fill, stroke, lw = 1) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

const EDGE = 'rgba(40,50,70,.16)';
export function box(x, y, w, d, h, c, z0 = 0, edge = EDGE) {
  const z1 = z0 + h;
  poly([iso(x, y + d, z0), iso(x + w, y + d, z0), iso(x + w, y + d, z1), iso(x, y + d, z1)], shade(c, -0.08), edge);
  poly([iso(x + w, y, z0), iso(x + w, y + d, z0), iso(x + w, y + d, z1), iso(x + w, y, z1)], shade(c, -0.2), edge);
  poly([iso(x, y, z1), iso(x + w, y, z1), iso(x + w, y + d, z1), iso(x, y + d, z1)], c, edge);
}
// 상자의 보이는 앞면: L = +y 면(화면 왼쪽 아래), R = +x 면(화면 오른쪽 아래)
export const faceL = (x, y, w, d) => (u, v) => iso(x + u * w, y + d, v);
export const faceR = (x, y, w, d) => (u, v) => iso(x + w, y + u * d, v);
export const quad = (f, u0, u1, v0, v1, fill, stroke) => poly([f(u0, v0), f(u1, v0), f(u1, v1), f(u0, v1)], fill, stroke);
export const rnd = (s) => { const x = Math.sin(s * 9301 + 49297) * 233280; return x - Math.floor(x); };

export function ellipse(x, y, rx, ry, fill, stroke) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
export function rrect(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}
// 벽/바닥에 눕힌 글씨. dir: 'N' = 북쪽 벽(+x 방향으로 읽힘), 'W' = 서쪽 벽, 'F' = 바닥
export function planeText(text, x, y, z, dir, font, color, align = 'center') {
  const [px, py] = iso(x, y, z);
  ctx.save();
  ctx.translate(px, py);
  if (dir === 'N') ctx.transform(1, 0.5, 0, 1, 0, 0);
  else if (dir === 'W') ctx.transform(1, -0.5, 0, 1, 0, 0);
  else ctx.transform(1, -0.5, 1, 0.5, 0, 0);
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}
