// 사무실 지도: 방 배치, 유리벽, 가구, 일할 자리, 길찾기, 그리기
import { iso, ctx, poly, box, shade, faceL, faceR, quad, rnd, ellipse, planeText } from './iso.js';

export const W = 34, H = 28, WALLH = 86;

// ---------- 방 ----------
export const ROOMS = {
  archive: { name: '자료실', en: 'LIBRARY', icon: '📚', x: 0, y: 0, w: 9, h: 8, floor: ['#e6cfaa', '#ddc39b'] },
  dev:     { name: '개발실', en: 'DEV', icon: '💻', x: 10, y: 0, w: 14, h: 10, floor: ['#f1f3f6', '#e9ecf1'] },
  server:  { name: '서버실', en: 'SERVER', icon: '🗄️', x: 25, y: 0, w: 9, h: 10, floor: ['#d6dbe3', '#ccd2dc'] },
  meeting: { name: '회의실', en: 'MEETING', icon: '📋', x: 0, y: 8, w: 9, h: 9, floor: ['#e7eef9', '#dfe8f5'] },
  lounge:  { name: '라운지', en: 'LOUNGE', icon: '🛋️', x: 0, y: 20, w: 9, h: 8, floor: ['#e9d6ba', '#e1cbab'] },
  desk:    { name: '내 자리', en: 'MY DESK', icon: '🙋', x: 12, y: 12, w: 8, h: 7, floor: ['#cfdcf6', '#c7d6f3'] },
  search:  { name: '정보검색실', en: 'SEARCH', icon: '🌐', x: 23, y: 13, w: 9, h: 8, floor: ['#cdeee8', '#c3e8e1'] },
  cafe:    { name: '카페', en: 'CAFE', icon: '☕', x: 12, y: 21, w: 9, h: 6, floor: ['#f5e6cf', '#eedac0'] },
};
const HALL = ['#f4f5f7', '#eef0f3'];
export function roomAt(x, y) {
  for (const [id, r] of Object.entries(ROOMS)) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return id;
  return 'hall';
}

// ---------- 셀 / 벽(셀 경계) ----------
const block = new Set();
const edges = new Set();
const ck = (x, y) => x + ',' + y;
export const walkable = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !block.has(ck(x, y));
function canStep(x, y, nx, ny) {
  if (!walkable(nx, ny)) return false;
  if (nx > x) return !edges.has(`v${nx},${y}`);
  if (nx < x) return !edges.has(`v${x},${y}`);
  if (ny > y) return !edges.has(`h${x},${ny}`);
  return !edges.has(`h${x},${y}`);
}

const ITEMS = []; // 깊이 정렬되는 고정 물체 { k, draw(t) }

const WALLS = [
  { d: 'v', at: 9, a: 0, b: 8, kind: 'solid', gaps: [5, 6] },     // 자료실 오른쪽
  { d: 'h', at: 8, a: 0, b: 9, kind: 'glass', gaps: [] },         // 자료실 | 회의실
  { d: 'v', at: 9, a: 8, b: 17, kind: 'glass', gaps: [12, 13] },  // 회의실 오른쪽
  { d: 'h', at: 17, a: 0, b: 9, kind: 'glass', gaps: [] },        // 회의실 아래
  { d: 'v', at: 25, a: 0, b: 10, kind: 'glass', gaps: [6, 7] },   // 서버실 왼쪽
  { d: 'h', at: 10, a: 25, b: 34, kind: 'glass', gaps: [] },      // 서버실 아래
];
for (const wl of WALLS) {
  for (let i = wl.a; i < wl.b; i++) {
    if (wl.gaps.includes(i)) continue;
    const isGap = (j) => wl.gaps.includes(j) || j < wl.a || j >= wl.b;
    const seg = { kind: wl.kind, capA: isGap(i - 1), capB: isGap(i + 1) };
    if (wl.d === 'v') { edges.add(`v${wl.at},${i}`); ITEMS.push({ k: wl.at + i + 0.5, draw: () => drawWallSeg(wl.at - 0.06, i, 0.12, 1, seg) }); }
    else { edges.add(`h${i},${wl.at}`); ITEMS.push({ k: i + 0.5 + wl.at, draw: () => drawWallSeg(i, wl.at - 0.06, 1, 0.12, seg) }); }
  }
}
function drawWallSeg(x, y, w, d, seg) {
  if (seg.kind === 'solid') { box(x, y, w, d, 58, '#f6f7f9'); return; }
  // 유리벽: 반투명 면 + 위아래 틀 + 기둥
  const h = 58;
  box(x, y, w, d, 4, '#c3ccd8');
  ctx.globalAlpha = 0.32;
  box(x, y, w, d, h - 8, '#bcdcf3', 4, null);
  ctx.globalAlpha = 1;
  box(x, y, w, d, 4, '#c3ccd8', h - 4);
  const vert = w < d; // 세로벽?
  for (const [cap, at] of [[seg.capA, 0], [seg.capB, 1]]) {
    if (!cap) continue;
    if (vert) box(x, y + at * d - (at ? 0.08 : 0), w, 0.08, h, '#b7c2d0');
    else box(x + at * w - (at ? 0.08 : 0), y, 0.08, d, h, '#b7c2d0');
  }
  // 반사광
  const f = vert ? faceR(x, y, w, d) : faceL(x, y, w, d);
  ctx.globalAlpha = 0.35; quad(f, 0.15, 0.3, 10, 48, '#ffffff'); ctx.globalAlpha = 1;
}

// ---------- 가구 ----------
export const FURN = [];
const put = (t, x, y, o = {}) => { const f = Object.assign({ t, x, y }, o); FURN.push(f); block.add(ck(x, y)); ITEMS.push({ k: x + y + 1, draw: (tt) => drawFurn(f, tt) }); return f; };
const decor = (t, x, y, o = {}) => { const f = Object.assign({ t, x, y }, o); ITEMS.push({ k: x + y + 1 - 0.06, draw: (tt) => drawFurn(f, tt) }); if (o.front) ITEMS.push({ k: x + y + 1.2, draw: () => drawChairBack(f) }); return f; };
const chair = (x, y, face, color = '#3d6fd6') => decor('chair', x, y, { face, color, front: face === 'N' || face === 'W' });

// 자료실
put('shelf', 0, 0, { face: 'L' });
for (let x = 1; x <= 8; x++) put('shelf', x, 0, { face: 'L' });
for (let y = 1; y <= 6; y++) put('shelf', 0, y, { face: 'R' });
put('wtable', 4, 4); put('wtable', 5, 4);
chair(4, 5, 'N', '#8a5a3c'); chair(5, 5, 'N', '#8a5a3c'); chair(3, 4, 'E', '#8a5a3c'); chair(6, 4, 'W', '#8a5a3c');
put('plant', 8, 7, { kind: 'bush' });
// 개발실
for (const y of [3, 7]) for (const x of [11, 12, 14, 15, 17, 18, 20, 21]) { put('desk', x, y); chair(x, y - 1, 'S', '#2b3445'); }
put('plant', 10, 0, { kind: 'palm' }); put('plant', 23, 9, { kind: 'palm' }); put('cooler', 23, 0); put('plant', 24, 0, { kind: 'bush' });
// 서버실
for (let x = 26; x <= 33; x++) put('rack', x, 0);
for (const y of [4, 7]) for (const x of [27, 28, 29, 31, 32, 33]) put('rack', x, y);
// 회의실
for (let y = 10; y <= 14; y++) { put('mtable', 4, y); put('mtable', 5, y); chair(3, y, 'E'); chair(6, y, 'W'); }
put('plant', 8, 8, { kind: 'bush' }); put('plant', 8, 16, { kind: 'palm' });
// 라운지
for (const y of [22, 23, 24]) put('sofa', 1, y, { face: 'E' });
for (const x of [3, 4]) put('sofa', x, 21, { face: 'S' });
put('ctable', 3, 23); put('ctable', 4, 23); put('armchair', 6, 23, { face: 'W' });
put('plant', 0, 27, { kind: 'palm' }); put('plant', 8, 20, { kind: 'bush' }); put('plant', 8, 27, { kind: 'palm' });
// 내 자리 (리셉션)
for (let x = 13; x <= 17; x++) put('counter', x, 15, { label: x === 15 });
chair(14, 14, 'S', '#2b3445'); chair(16, 14, 'S', '#2b3445');
put('plant', 12, 12, { kind: 'bush' }); put('plant', 19, 12, { kind: 'bush' });
// 정보검색실
for (const x of [24, 26, 28, 30]) put('kiosk', x, 13);
put('globe', 30, 18); put('desk', 24, 18); put('desk', 25, 18); chair(24, 17, 'S', '#2b3445'); chair(25, 17, 'S', '#2b3445');
put('plant', 23, 20, { kind: 'palm' }); put('plant', 31, 20, { kind: 'bush' });
// 카페
for (const [x, y] of [[13, 22], [16, 22], [19, 22], [13, 25], [16, 25], [19, 25]]) { put('ctable2', x, y); chair(x - 1, y, 'E', '#f08a3c'); chair(x + 1, y, 'W', '#f08a3c'); }
put('vending', 20, 21);
// 복도 화분
for (const [x, y, k] of [[10, 11, 'palm'], [21, 11, 'palm'], [10, 19, 'palm'], [22, 23, 'palm'], [33, 12, 'bush'], [33, 27, 'palm'], [11, 27, 'bush']]) put('plant', x, y, { kind: k });

// ---------- 일할 자리 ----------
const S = (x, y, fx, fy, seat = false) => ({ x, y, fx, fy, seat });
export const SPOTS = {
  archive: [S(2, 1, 2, 0), S(4, 1, 4, 0), S(6, 1, 6, 0), S(1, 3, 0, 3), S(4, 5, 4, 4, true), S(5, 5, 5, 4, true), S(3, 4, 4, 4, true), S(6, 4, 5, 4, true), S(8, 1, 8, 0), S(1, 5, 0, 5)],
  dev: [], server: [S(27, 1, 27, 0), S(29, 1, 29, 0), S(31, 1, 31, 0), S(28, 5, 28, 4), S(32, 5, 32, 4), S(28, 8, 28, 7), S(32, 8, 32, 7), S(33, 1, 33, 0), S(26, 1, 26, 0)],
  meeting: [], lounge: [S(2, 22, 1, 22), S(2, 24, 1, 24), S(5, 22, 4, 23), S(5, 24, 4, 23)],
  desk: [S(15, 16, 15, 15), S(13, 16, 13, 15), S(17, 16, 17, 15), S(14, 17, 14, 15), S(16, 17, 16, 15)],
  search: [S(24, 14, 24, 13), S(26, 14, 26, 13), S(28, 14, 28, 13), S(30, 14, 30, 13), S(24, 17, 24, 18, true), S(25, 17, 25, 18, true), S(29, 18, 30, 18)],
  cafe: [S(12, 22, 13, 22, true), S(14, 22, 13, 22, true), S(15, 25, 16, 25, true), S(17, 25, 16, 25, true)],
};
for (const y of [2, 6]) for (const x of [11, 12, 14, 15, 17, 18, 20, 21]) SPOTS.dev.push(S(x, y, x, y + 1, true));
for (let y = 10; y <= 14; y++) { SPOTS.meeting.push(S(3, y, 4, y, true)); SPOTS.meeting.push(S(6, y, 5, y, true)); }
SPOTS.dev.sort((a, b) => rnd(a.x * 7 + a.y) - rnd(b.x * 7 + b.y));
export const HOME = { claude: S(16, 14, 16, 15, true), me: S(14, 14, 14, 15, true), ask: S(15, 14, 14, 14) };
export const ELEVATOR = [[0, 18], [0, 19]];
for (const k of ['claude', 'me']) block.delete(ck(HOME[k].x, HOME[k].y));

// ---------- 길찾기 (BFS, 4방향) ----------
export function findPath(sx, sy, tx, ty) {
  if (!walkable(tx, ty)) return null;
  const prev = new Int32Array(W * H).fill(-1);
  const start = sy * W + sx, goal = ty * W + tx;
  const q = [start]; prev[start] = start;
  for (let i = 0; i < q.length; i++) {
    const c = q[i]; if (c === goal) break;
    const cx = c % W, cy = (c / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!canStep(cx, cy, nx, ny)) continue;
      const k = ny * W + nx;
      if (prev[k] !== -1) continue;
      prev[k] = c; q.push(k);
    }
  }
  if (prev[goal] === -1) return null;
  const path = [];
  for (let c = goal; c !== prev[c]; c = prev[c]) path.push([c % W, (c / W) | 0]);
  return path.reverse();
}

// ---------- 엘리베이터 ----------
export const elevator = { open: 0, until: 0 };
export function openElevator(ms) { elevator.until = Math.max(elevator.until, performance.now() + ms); }

// ---------- 가구 그리기 ----------
const BOOKS = ['#d9534f', '#3e7cc9', '#5aa469', '#f2b134', '#8a63c9', '#3fb0c4', '#e9773a', '#6b4f3a', '#e3e3e3'];
function drawFurn(o, t) {
  const { x, y } = o;
  switch (o.t) {
    case 'shelf': {
      const L = o.face === 'L';
      const bx = L ? [x, y, 1, 0.45] : [x, y, 0.45, 1];
      box(...bx, 54, '#c49468');
      const f = L ? faceL(...bx) : faceR(...bx);
      quad(f, 0.05, 0.95, 3, 51, '#7c573a');
      for (const [v0, v1] of [[5, 17], [21, 33], [37, 49]]) {
        let u = 0.08, i = 0;
        while (u < 0.9) {
          const bw = 0.06 + rnd(x * 31 + y * 7 + v0 + i) * 0.07;
          const hh = v1 - rnd(x + y * 3 + i * 5 + v0) * 4;
          quad(f, u, Math.min(0.93, u + bw), v0, hh, BOOKS[(x * 3 + y * 5 + i + v0) % BOOKS.length]);
          u += bw + 0.01; i++;
        }
      }
      break;
    }
    case 'desk': {
      box(x + 0.05, y + 0.12, 0.9, 0.76, 2, '#fbfcfd', 15);
      box(x + 0.08, y + 0.16, 0.06, 0.06, 15, '#9aa3b2'); box(x + 0.86, y + 0.16, 0.06, 0.06, 15, '#9aa3b2');
      box(x + 0.08, y + 0.78, 0.06, 0.06, 15, '#9aa3b2'); box(x + 0.86, y + 0.78, 0.06, 0.06, 15, '#9aa3b2');
      box(x + 0.05, y + 0.12, 0.9, 0.76, 2, '#fbfcfd', 15);
      // 모니터 (화면은 앉은 사람 쪽 = -y, 우리는 뒷면을 봄)
      box(x + 0.46, y + 0.62, 0.08, 0.08, 6, '#5d6676', 17);
      box(x + 0.2, y + 0.6, 0.6, 0.07, 17, '#2c3340', 22);
      if (o.busy) { ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 6); const [px, py] = iso(x + 0.5, y + 0.6, 40); ellipse(px, py, 9, 2.5, '#7cc4ff'); ctx.globalAlpha = 1; }
      box(x + 0.25, y + 0.24, 0.5, 0.14, 1, '#dfe3ea', 17);
      break;
    }
    case 'counter': {
      box(x, y + 0.1, 1, 0.8, 22, '#ffffff');
      const f = faceL(x, y + 0.1, 1, 0.8);
      quad(f, 0, 1, 3, 17, '#2f6fe0');
      if (o.label) planeText('Claude', x + 0.5, y + 0.9, 10, 'N', 'bold 9px "Segoe UI", sans-serif', '#ffffff');
      box(x + 0.25, y + 0.62, 0.5, 0.07, 15, '#2c3340', 22);
      box(x + 0.25, y + 0.25, 0.5, 0.14, 1, '#dfe3ea', 22);
      break;
    }
    case 'rack': {
      box(x + 0.06, y + 0.08, 0.88, 0.8, 62, '#2f3644');
      const f = faceL(x + 0.06, y + 0.08, 0.88, 0.8);
      for (let r = 0; r < 8; r++) {
        quad(f, 0.07, 0.93, 5 + r * 7, 10.5 + r * 7, '#232936');
        for (let k = 0; k < 3; k++) {
          const on = rnd(x * 7 + y * 13 + r * 3 + k + Math.floor(t * (o.busy ? 8 : 1.5) + k)) > 0.35;
          quad(f, 0.62 + k * 0.1, 0.68 + k * 0.1, 7 + r * 7, 9 + r * 7, on ? (k === 2 ? '#4fa8ff' : '#56f08c') : '#22382f');
        }
      }
      break;
    }
    case 'kiosk': {
      box(x + 0.25, y + 0.3, 0.5, 0.4, 4, '#5a3fb0');
      box(x + 0.32, y + 0.4, 0.36, 0.22, 50, '#7b5cd6', 4);
      const f = faceL(x + 0.32, y + 0.4, 0.36, 0.22);
      quad(f, 0.1, 0.9, 24, 50, o.busy ? (Math.sin(t * 5) > 0 ? '#e7defe' : '#c9b8ff') : '#d9d0fb');
      quad(f, 0.3, 0.7, 12, 16, '#c9b8ff');
      break;
    }
    case 'globe': {
      box(x + 0.35, y + 0.35, 0.3, 0.3, 16, '#8a6a4a');
      const [px, py] = iso(x + 0.5, y + 0.5, 32);
      ellipse(px, py, 12, 12, '#4f9fd8');
      ctx.save(); ctx.beginPath(); ctx.arc(px, py, 12, 0, 7); ctx.clip();
      ctx.fillStyle = '#8bd07a';
      const sh = (t * 6) % 30 - 15;
      for (const [ox, oy, rx, ry] of [[-4, -4, 6, 3.5], [5, 4, 3.5, 4.5], [-2, 6, 3, 2]]) { ctx.beginPath(); ctx.ellipse(px + ox + sh, py + oy, rx, ry, 0.4, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(px + ox + sh - 30, py + oy, rx, ry, 0.4, 0, 7); ctx.fill(); }
      ctx.restore();
      ctx.strokeStyle = '#b8914f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(px, py, 14, 5, -0.4, 0, 7); ctx.stroke();
      break;
    }
    case 'wtable': box(x - 0.01, y + 0.12, 1.02, 0.76, 15, '#c99b6b'); break;
    case 'mtable': box(x - 0.01, y - 0.01, 1.02, 1.02, 15, '#fafbfc'); break;
    case 'ctable': box(x + 0.02, y + 0.15, 0.96, 0.7, 8, '#8c5a3c'); break;
    case 'ctable2': box(x + 0.47, y + 0.47, 0.06, 0.06, 13, '#6c7380'); box(x + 0.18, y + 0.18, 0.64, 0.64, 2, '#ffffff', 13); break;
    case 'chair': drawChair(o); break;
    case 'sofa': case 'armchair': {
      const c = o.t === 'sofa' ? '#7a4a34' : '#8d5a40';
      box(x + 0.05, y + 0.05, 0.9, 0.9, 10, c);
      const back = { E: [x + 0.05, y + 0.05, 0.22, 0.9], W: [x + 0.73, y + 0.05, 0.22, 0.9], S: [x + 0.05, y + 0.05, 0.9, 0.22], N: [x + 0.05, y + 0.73, 0.9, 0.22] }[o.face];
      box(...back, 12, shade(c, -0.1), 10);
      break;
    }
    case 'plant': {
      box(x + 0.32, y + 0.32, 0.36, 0.36, 12, '#e9ecf0');
      if (o.kind === 'palm') {
        const [bx, by] = iso(x + 0.5, y + 0.5, 12);
        ctx.strokeStyle = '#8a6a43'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + 2, by - 18, bx, by - 34); ctx.stroke();
        const sway = Math.sin(t * 1.3 + x) * 0.06;
        for (let i = 0; i < 7; i++) {
          const a = i / 7 * Math.PI * 2 + sway;
          ctx.save(); ctx.translate(bx, by - 34); ctx.rotate(a); ctx.scale(1, 0.55);
          ctx.fillStyle = i % 2 ? '#3f9b55' : '#55b465';
          ctx.beginPath(); ctx.ellipse(12, 0, 13, 4, 0.35, 0, 7); ctx.fill(); ctx.restore();
        }
      } else {
        const [px, py] = iso(x + 0.5, y + 0.5, 22);
        ellipse(px, py, 11, 10, '#4c9a5a'); ellipse(px - 4, py - 4, 7, 6, '#68b770'); ellipse(px + 5, py - 1, 5, 5, '#68b770');
      }
      break;
    }
    case 'cooler': box(x + 0.3, y + 0.3, 0.4, 0.4, 28, '#eef2f6'); box(x + 0.36, y + 0.36, 0.28, 0.28, 13, '#9ccbea', 28); break;
    case 'vending': {
      box(x + 0.08, y + 0.15, 0.84, 0.7, 60, '#e2483d');
      const f = faceL(x + 0.08, y + 0.15, 0.84, 0.7);
      quad(f, 0.1, 0.65, 22, 54, '#cfe9ff');
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) quad(f, 0.14 + c * 0.17, 0.25 + c * 0.17, 26 + r * 7, 30 + r * 7, BOOKS[(r * 3 + c) % BOOKS.length]);
      quad(f, 0.72, 0.9, 30, 50, '#3a3f4b');
      break;
    }
  }
}
function chairGeo(o) { return [o.x + 0.32, o.y + 0.32]; }
function drawChair(o) {
  const [cx, cy] = chairGeo(o);
  box(cx + 0.15, cy + 0.15, 0.06, 0.06, 8, '#5a606c');
  box(cx, cy, 0.36, 0.36, 3, o.color, 8);
  if (!o.front) drawChairBack(o);
}
function drawChairBack(o) {
  const [cx, cy] = chairGeo(o);
  const b = { S: [cx, cy - 0.02, 0.36, 0.07], E: [cx - 0.02, cy, 0.07, 0.36], N: [cx, cy + 0.31, 0.36, 0.07], W: [cx + 0.31, cy, 0.07, 0.36] }[o.face];
  box(...b, 13, shade(o.color, -0.08), 11);
}

// ---------- 바닥 · 뒷벽 ----------
const fN = (u, v) => iso(u, 0, v);
const fW = (u, v) => iso(0, u, v);
export function drawFloor(t, active) {
  // 받침(디오라마 단면)
  poly([iso(0, H, 0), iso(W, H, 0), iso(W, H, -18), iso(0, H, -18)], '#d5dae2');
  poly([iso(W, 0, 0), iso(W, H, 0), iso(W, H, -18), iso(W, 0, -18)], '#c3c9d3');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = roomAt(x, y);
    let pal = r === 'hall' ? HALL : ROOMS[r].floor;
    let c = pal[(x + y) & 1];
    if (r === 'archive' || r === 'lounge') c = pal[(x + (y >> 1)) & 1];
    if (r === 'desk') { const R = ROOMS.desk; if (x === R.x || y === R.y || x === R.x + R.w - 1 || y === R.y + R.h - 1) c = '#9fbbec'; }
    if (r === 'lounge' && x >= 2 && x <= 6 && y >= 21 && y <= 25) c = (x + y) & 1 ? '#efe7da' : '#e8dfd0';
    poly([iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)], c);
  }
  // 바닥 격자선 (은은하게)
  ctx.strokeStyle = 'rgba(120,130,150,.07)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0; x <= W; x++) { const [a, b] = iso(x, 0), [c2, d] = iso(x, H); ctx.moveTo(a, b); ctx.lineTo(c2, d); }
  for (let y = 0; y <= H; y++) { const [a, b] = iso(0, y), [c2, d] = iso(W, y); ctx.moveTo(a, b); ctx.lineTo(c2, d); }
  ctx.stroke();
  // 지금 일하는 방은 바닥이 은은하게 빛남
  for (const id of active) {
    const r = ROOMS[id]; if (!r) continue;
    ctx.globalAlpha = 0.18 + 0.1 * Math.sin(t * 3);
    poly([iso(r.x, r.y), iso(r.x + r.w, r.y), iso(r.x + r.w, r.y + r.h), iso(r.x, r.y + r.h)], '#fff1b8');
    ctx.globalAlpha = 1;
  }
  // 바닥 글씨 (가운데 방들)
  const ft = (id, x, y) => planeText(`${ROOMS[id].name}`, x, y, 0, 'F', 'bold 15px "Malgun Gothic", sans-serif', active.has(id) ? 'rgba(200,110,30,.8)' : 'rgba(60,80,120,.38)');
  ft('desk', 13.6, 17.6); ft('search', 23.6, 20.4); ft('cafe', 12.6, 26.6);
}

export function drawBackWalls(t, active) {
  // 북쪽 벽
  poly([iso(0, 0, 0), iso(W, 0, 0), iso(W, 0, WALLH), iso(0, 0, WALLH)], '#fafbfc', 'rgba(0,0,0,.06)');
  poly([iso(0, 0, 0), iso(0, H, 0), iso(0, H, WALLH), iso(0, 0, WALLH)], '#eef0f4', 'rgba(0,0,0,.06)');
  poly([iso(0, 0, 0), iso(W, 0, 0), iso(W, 0, 7), iso(0, 0, 7)], '#d6dbe3');
  poly([iso(0, 0, 0), iso(0, H, 0), iso(0, H, 7), iso(0, 0, 7)], '#cbd1db');
  poly([iso(-0.35, -0.35, WALLH), iso(W, -0.35, WALLH), iso(W, 0, WALLH), iso(0, 0, WALLH)], '#dfe3ea');
  poly([iso(-0.35, -0.35, WALLH), iso(0, 0, WALLH), iso(0, H, WALLH), iso(-0.35, H, WALLH)], '#d3d8e1');
  poly([iso(W, -0.35, WALLH), iso(W, 0, WALLH), iso(W, 0, 0), iso(W, -0.35, 0)], '#c7cdd7');
  poly([iso(-0.35, H, WALLH), iso(0, H, WALLH), iso(0, H, 0), iso(-0.35, H, 0)], '#d9dee6');
  // 창문 (개발실 위)
  for (let wx = 11; wx < 23; wx += 2.4) {
    poly([fN(wx, 26), fN(wx + 2, 26), fN(wx + 2, 72), fN(wx, 72)], '#e3e8ef');
    const g = [fN(wx + 0.12, 29), fN(wx + 1.88, 29), fN(wx + 1.88, 69), fN(wx + 0.12, 69)];
    poly(g, '#b9dcf5');
    ctx.globalAlpha = 0.55; poly([fN(wx + 0.12, 50), fN(wx + 1.88, 50), fN(wx + 1.88, 69), fN(wx + 0.12, 69)], '#d8eefc'); ctx.globalAlpha = 1;
    poly([fN(wx + 0.96, 29), fN(wx + 1.04, 29), fN(wx + 1.04, 69), fN(wx + 0.96, 69)], '#e3e8ef');
  }
  // 시계
  const [cx, cy] = fN(23.3, 66);
  ctx.save(); ctx.translate(cx, cy); ctx.transform(1, 0.5, 0, 1, 0, 0);
  ellipse(0, 0, 9, 9, '#ffffff', '#3a4250'); ctx.lineWidth = 1.6; ctx.strokeStyle = '#3a4250';
  const d = new Date(); const hA = ((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2, mA = d.getMinutes() / 60 * Math.PI * 2;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(hA) * 4.5, -Math.cos(hA) * 4.5); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(mA) * 7, -Math.cos(mA) * 7); ctx.stroke();
  ctx.restore();
  // 회의실 화이트보드
  poly([fW(10, 22), fW(15, 22), fW(15, 62), fW(10, 62)], '#cfd6e0');
  poly([fW(10.15, 25), fW(14.85, 25), fW(14.85, 59), fW(10.15, 59)], '#ffffff');
  for (let i = 0; i < 4; i++) { const yy = 10.6 + i * 0.25; poly([fW(yy + 0.2, 52 - i * 7), fW(yy + 1.6 + rnd(i) * 2, 52 - i * 7), fW(yy + 1.6 + rnd(i) * 2, 50 - i * 7), fW(yy + 0.2, 50 - i * 7)], ['#3b6fd1', '#e35d5b', '#2e9e5b', '#f2a33a'][i]); }
  poly([fW(13.2, 34), fW(14.4, 34), fW(14.4, 46), fW(13.2, 46)], 'rgba(242,163,58,.35)');
  // 라운지 액자
  for (const [yy, c] of [[22.5, '#f2b134'], [24.2, '#5aa469'], [25.9, '#3e7cc9']]) {
    poly([fW(yy, 34), fW(yy + 1.2, 34), fW(yy + 1.2, 56), fW(yy, 56)], '#ffffff', '#c9ced8');
    poly([fW(yy + 0.12, 37), fW(yy + 1.08, 37), fW(yy + 1.08, 53), fW(yy + 0.12, 53)], c);
  }
  // 엘리베이터
  const y0 = 17.45, y1 = 19.55, mid = (y0 + y1) / 2, op = elevator.open;
  poly([fW(y0 - 0.2, 0), fW(y1 + 0.2, 0), fW(y1 + 0.2, 64), fW(y0 - 0.2, 64)], '#aab3c0');
  poly([fW(y0, 0), fW(y1, 0), fW(y1, 58), fW(y0, 58)], '#262b33');
  if (op > 0.02) { ctx.globalAlpha = op; poly([fW(y0 + 0.1, 0), fW(y1 - 0.1, 0), fW(y1 - 0.1, 56), fW(y0 + 0.1, 56)], '#fff1c1'); ctx.globalAlpha = 1; }
  const gap = op * (mid - y0 - 0.04);
  poly([fW(y0, 0), fW(mid - gap, 0), fW(mid - gap, 58), fW(y0, 58)], '#d3d8df', 'rgba(0,0,0,.22)');
  poly([fW(mid + gap, 0), fW(y1, 0), fW(y1, 58), fW(mid + gap, 58)], '#d3d8df', 'rgba(0,0,0,.22)');
  planeText(op > 0.02 ? '▲' : '▲▼', 0, mid, 61, 'W', 'bold 7px sans-serif', op > 0.02 ? '#ff9f1a' : '#6b7280');
  // 벽 간판
  sign('N', 4.5, '자료실', 'LIBRARY', active.has('archive'));
  sign('N', 17, '개발실', 'DEV', active.has('dev'), 80);
  sign('N', 29.5, '서버실', 'SERVER', active.has('server'), 76);
  sign('W', 12.5, '회의실', 'MEETING', active.has('meeting'), 72);
  sign('W', 18.5, '엘리베이터', 'ELEVATOR', false, 76);
  sign('W', 24.2, '라운지', 'LOUNGE', active.has('lounge'), 70);
}
function sign(wall, at, ko, en, on, z = 68) {
  const f = wall === 'N' ? fN : fW;
  ctx.font = 'bold 8.5px "Malgun Gothic", sans-serif';
  const w = ctx.measureText(`${ko} · ${en}`).width / 22 + 0.5;
  const a = wall === 'N' ? at - w / 2 : at + w / 2, b = wall === 'N' ? at + w / 2 : at - w / 2;
  poly([f(a, z - 7), f(b, z - 7), f(b, z + 7), f(a, z + 7)], on ? '#ffe9c2' : '#ffffff', on ? '#f0a33a' : '#c9d0da');
  const x = wall === 'N' ? at : 0, y = wall === 'N' ? 0 : at;
  planeText(`${ko} · ${en}`, x, y, z, wall, 'bold 8.5px "Malgun Gothic", sans-serif', on ? '#b0600f' : '#465063');
}

export function staticItems() { return ITEMS; }
