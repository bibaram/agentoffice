// 건물: 2층 사무실 + 1층 작업실. 층마다 방 배치, 벽, 가구, 일할 자리, 길찾기, 그리기를 따로 가진다.
import { iso, ctx, poly, box, shade, faceL, faceR, quad, rnd, ellipse, planeText } from './iso.js';

export const WALLH = 86;
// 1층 벽의 작업 지시판에 띄울 내용 (main.js가 매 프레임 채운다)
export const boardState = { jobs: [] };

const BOOKS = ['#d9534f', '#3e7cc9', '#5aa469', '#f2b134', '#8a63c9', '#3fb0c4', '#e9773a', '#6b4f3a', '#e3e3e3'];
const S = (x, y, fx, fy, seat = false) => ({ x, y, fx, fy, seat });
const ck = (x, y) => x + ',' + y;

// ======================================================================
// 층 만들기 (공통)
// ======================================================================
function makeFloor(def) {
  const F = {
    id: def.id, name: def.name, W: def.W, H: def.H, ROOMS: def.rooms, HOME: {}, SPOTS: {},
    ELEVATOR: def.elevator.cells, alias: def.alias || {}, FURN: [], items: [],
    elev: { open: 0, until: 0 },
  };
  const block = new Set(), edges = new Set();
  F.roomAt = (x, y) => {
    for (const [id, r] of Object.entries(F.ROOMS)) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return id;
    return 'hall';
  };
  F.walkable = (x, y) => x >= 0 && y >= 0 && x < F.W && y < F.H && !block.has(ck(x, y));
  const canStep = (x, y, nx, ny) => {
    if (!F.walkable(nx, ny)) return false;
    if (nx > x) return !edges.has(`v${nx},${y}`);
    if (nx < x) return !edges.has(`v${x},${y}`);
    if (ny > y) return !edges.has(`h${x},${ny}`);
    return !edges.has(`h${x},${y}`);
  };
  F.findPath = (sx, sy, tx, ty) => {
    if (!F.walkable(tx, ty)) return null;
    const W = F.W, prev = new Int32Array(W * F.H).fill(-1);
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
  };
  // 도구의 방 이름 → 이 층의 방 (1층은 작업실 구역으로 바꿔 매핑)
  F.roomFor = (room) => F.alias[room] || room;
  F.spotsFor = (room) => F.SPOTS[F.roomFor(room)] || [];

  // 벽 (셀 경계)
  for (const wl of def.walls) {
    for (let i = wl.a; i < wl.b; i++) {
      if (wl.gaps.includes(i)) continue;
      const isGap = (j) => wl.gaps.includes(j) || j < wl.a || j >= wl.b;
      const seg = { kind: wl.kind, capA: isGap(i - 1), capB: isGap(i + 1) };
      if (wl.d === 'v') { edges.add(`v${wl.at},${i}`); F.items.push({ k: wl.at + i + 0.5, draw: () => drawWallSeg(wl.at - 0.06, i, 0.12, 1, seg) }); }
      else { edges.add(`h${i},${wl.at}`); F.items.push({ k: i + 0.5 + wl.at, draw: () => drawWallSeg(i, wl.at - 0.06, 1, 0.12, seg) }); }
    }
  }
  // 가구
  const put = (t, x, y, o = {}) => { const f = Object.assign({ t, x, y }, o); F.FURN.push(f); block.add(ck(x, y)); F.items.push({ k: x + y + 1, draw: (tt) => drawFurn(f, tt) }); return f; };
  const decor = (t, x, y, o = {}) => { const f = Object.assign({ t, x, y }, o); F.FURN.push(f); F.items.push({ k: x + y + 1 - 0.06, draw: (tt) => drawFurn(f, tt) }); if (o.front) F.items.push({ k: x + y + 1.2, draw: () => drawChairBack(f) }); return f; };
  const chair = (x, y, face, color = '#3d6fd6') => decor('chair', x, y, { face, color, front: face === 'N' || face === 'W' });
  def.build({ put, decor, chair, F });

  F.drawFloor = (t, active) => {
    const { W, H } = F;
    poly([iso(0, H, 0), iso(W, H, 0), iso(W, H, -18), iso(0, H, -18)], def.slab[0]);
    poly([iso(W, 0, 0), iso(W, H, 0), iso(W, H, -18), iso(W, 0, -18)], def.slab[1]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const r = F.roomAt(x, y);
      const c = def.floorColor(x, y, r, r === 'hall' ? def.hall : F.ROOMS[r].floor);
      poly([iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)], c);
    }
    ctx.strokeStyle = 'rgba(120,130,150,.07)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x <= W; x++) { const [a, b] = iso(x, 0), [c2, d] = iso(x, H); ctx.moveTo(a, b); ctx.lineTo(c2, d); }
    for (let y = 0; y <= H; y++) { const [a, b] = iso(0, y), [c2, d] = iso(W, y); ctx.moveTo(a, b); ctx.lineTo(c2, d); }
    ctx.stroke();
    if (def.floorExtras) def.floorExtras(t, F);
    for (const id of active) {
      const r = F.ROOMS[id]; if (!r) continue;
      ctx.globalAlpha = 0.18 + 0.1 * Math.sin(t * 3);
      poly([iso(r.x, r.y), iso(r.x + r.w, r.y), iso(r.x + r.w, r.y + r.h), iso(r.x, r.y + r.h)], '#fff1b8');
      ctx.globalAlpha = 1;
    }
    for (const [id, x, y] of def.floorLabels || []) {
      planeText(F.ROOMS[id].name, x, y, 0, 'F', 'bold 15px "Malgun Gothic", sans-serif', active.has(id) ? 'rgba(200,110,30,.8)' : 'rgba(60,80,120,.38)');
    }
  };
  F.drawBackWalls = (t, active) => {
    const { W, H } = F, [wN, wW, cap1, cap2, base1, base2] = def.wallColors;
    poly([iso(0, 0, 0), iso(W, 0, 0), iso(W, 0, WALLH), iso(0, 0, WALLH)], wN, 'rgba(0,0,0,.06)');
    poly([iso(0, 0, 0), iso(0, H, 0), iso(0, H, WALLH), iso(0, 0, WALLH)], wW, 'rgba(0,0,0,.06)');
    poly([iso(0, 0, 0), iso(W, 0, 0), iso(W, 0, 7), iso(0, 0, 7)], base1);
    poly([iso(0, 0, 0), iso(0, H, 0), iso(0, H, 7), iso(0, 0, 7)], base2);
    poly([iso(-0.35, -0.35, WALLH), iso(W, -0.35, WALLH), iso(W, 0, WALLH), iso(0, 0, WALLH)], cap1);
    poly([iso(-0.35, -0.35, WALLH), iso(0, 0, WALLH), iso(0, H, WALLH), iso(-0.35, H, WALLH)], cap2);
    poly([iso(W, -0.35, WALLH), iso(W, 0, WALLH), iso(W, 0, 0), iso(W, -0.35, 0)], shade(cap1, -0.08));
    poly([iso(-0.35, H, WALLH), iso(0, H, WALLH), iso(0, H, 0), iso(-0.35, H, 0)], shade(cap2, 0.05));
    def.wallDecor(t, active, F);
    drawElevator(F, def.elevator);
    for (const [wall, at, ko, en, room, z] of def.signs) sign(wall, at, ko, en, room ? active.has(room) : false, z);
  };
  return F;
}

// ======================================================================
// 2층: 사무실
// ======================================================================
const FLOOR2 = makeFloor({
  id: '2F', name: '사무실', W: 34, H: 28,
  rooms: {
    archive: { name: '자료실', x: 0, y: 0, w: 9, h: 8, floor: ['#e6cfaa', '#ddc39b'] },
    dev:     { name: '개발실', x: 10, y: 0, w: 14, h: 10, floor: ['#f1f3f6', '#e9ecf1'] },
    server:  { name: '서버실', x: 25, y: 0, w: 9, h: 10, floor: ['#d6dbe3', '#ccd2dc'] },
    meeting: { name: '회의실', x: 0, y: 8, w: 9, h: 9, floor: ['#e7eef9', '#dfe8f5'] },
    desk:    { name: '사장실', x: 0, y: 20, w: 9, h: 8, floor: ['#ead9bf', '#e2cfb2'] },
    team:    { name: 'Claude 자리', x: 12, y: 12, w: 8, h: 7, floor: ['#cfdcf6', '#c7d6f3'] },
    search:  { name: '정보검색실', x: 23, y: 13, w: 9, h: 8, floor: ['#cdeee8', '#c3e8e1'] },
    cafe:    { name: '카페', x: 12, y: 21, w: 9, h: 6, floor: ['#f5e6cf', '#eedac0'] },
  },
  hall: ['#f4f5f7', '#eef0f3'],
  slab: ['#d5dae2', '#c3c9d3'],
  wallColors: ['#fafbfc', '#eef0f4', '#dfe3ea', '#d3d8e1', '#d6dbe3', '#cbd1db'],
  elevator: { y0: 17.45, y1: 19.55, cells: [[0, 18], [0, 19]] },
  walls: [
    { d: 'v', at: 9, a: 0, b: 8, kind: 'solid', gaps: [5, 6] },
    { d: 'h', at: 8, a: 0, b: 9, kind: 'glass', gaps: [] },
    { d: 'v', at: 9, a: 8, b: 17, kind: 'glass', gaps: [12, 13] },
    { d: 'h', at: 17, a: 0, b: 9, kind: 'glass', gaps: [] },
    { d: 'v', at: 25, a: 0, b: 10, kind: 'glass', gaps: [6, 7] },
    { d: 'h', at: 10, a: 25, b: 34, kind: 'glass', gaps: [] },
    { d: 'h', at: 20, a: 0, b: 9, kind: 'glass', gaps: [6, 7] },   // 사장실 위 (문)
    { d: 'v', at: 9, a: 20, b: 28, kind: 'glass', gaps: [] },      // 사장실 오른쪽
  ],
  alias: {},
  floorColor(x, y, r, pal) {
    let c = pal[(x + y) & 1];
    if (r === 'archive') c = pal[(x + (y >> 1)) & 1];
    if (r === 'desk') { c = pal[(x + (y >> 1)) & 1]; if (x >= 2 && x <= 7 && y >= 21 && y <= 26) c = (x + y) & 1 ? '#b8423a' : '#ad3c35'; }
    if (r === 'team') { const R = this.rooms.team; if (x === R.x || y === R.y || x === R.x + R.w - 1 || y === R.y + R.h - 1) c = '#9fbbec'; }
    return c;
  },
  floorLabels: [['team', 12.6, 17.6], ['search', 23.6, 20.4], ['cafe', 12.6, 26.6]],
  build({ put, decor, chair, F }) {
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
    // 사장실
    for (const y of [21, 22, 23]) put('shelf', 0, y, { face: 'R' });
    for (const x of [3, 4, 5]) put('bdesk', x, 23, { plate: x === 4 });
    chair(4, 22, 'S', '#5a3424');
    put('sofa', 1, 25, { face: 'E' }); put('sofa', 1, 26, { face: 'E' }); put('ctable', 2, 26);
    put('plant', 8, 21, { kind: 'palm' }); put('plant', 8, 27, { kind: 'bush' }); put('plant', 0, 27, { kind: 'palm' });
    // Claude 자리 (팀장 데스크)
    for (let x = 13; x <= 17; x++) put('counter', x, 15, { label: x === 15 });
    chair(15, 14, 'S', '#d97757');
    put('plant', 12, 12, { kind: 'bush' }); put('plant', 19, 12, { kind: 'bush' });
    // 정보검색실
    for (const x of [24, 26, 28, 30]) put('kiosk', x, 13);
    put('globe', 30, 18); put('desk', 24, 18); put('desk', 25, 18); chair(24, 17, 'S', '#2b3445'); chair(25, 17, 'S', '#2b3445');
    put('plant', 23, 20, { kind: 'palm' }); put('plant', 31, 20, { kind: 'bush' });
    // 카페
    for (const [x, y] of [[13, 22], [16, 22], [19, 22], [13, 25], [16, 25], [19, 25]]) { put('ctable2', x, y); chair(x - 1, y, 'E', '#f08a3c'); chair(x + 1, y, 'W', '#f08a3c'); }
    put('vending', 20, 21);
    for (const [x, y, k] of [[10, 11, 'palm'], [21, 11, 'palm'], [10, 19, 'palm'], [22, 23, 'palm'], [33, 12, 'bush'], [33, 27, 'palm'], [11, 27, 'bush']]) put('plant', x, y, { kind: k });

    F.SPOTS = {
      archive: [S(2, 1, 2, 0), S(4, 1, 4, 0), S(6, 1, 6, 0), S(1, 3, 0, 3), S(4, 5, 4, 4, true), S(5, 5, 5, 4, true), S(3, 4, 4, 4, true), S(6, 4, 5, 4, true), S(8, 1, 8, 0), S(1, 5, 0, 5)],
      dev: [],
      server: [S(27, 1, 27, 0), S(29, 1, 29, 0), S(31, 1, 31, 0), S(28, 5, 28, 4), S(32, 5, 32, 4), S(28, 8, 28, 7), S(32, 8, 32, 7), S(33, 1, 33, 0), S(26, 1, 26, 0)],
      meeting: [],
      desk: [S(3, 24, 4, 22), S(5, 24, 4, 22), S(6, 24, 4, 22), S(2, 24, 4, 22)],          // 사장실: 사장 앞에 서는 자리
      team: [S(13, 16, 13, 15), S(14, 16, 14, 15), S(16, 16, 16, 15), S(17, 16, 17, 15)],
      search: [S(24, 14, 24, 13), S(26, 14, 26, 13), S(28, 14, 28, 13), S(30, 14, 30, 13), S(24, 17, 24, 18, true), S(25, 17, 25, 18, true), S(29, 18, 30, 18)],
      cafe: [S(12, 22, 13, 22, true), S(14, 22, 13, 22, true), S(15, 25, 16, 25, true), S(17, 25, 16, 25, true)],
    };
    for (const y of [2, 6]) for (const x of [11, 12, 14, 15, 17, 18, 20, 21]) F.SPOTS.dev.push(S(x, y, x, y + 1, true));
    for (let y = 10; y <= 14; y++) { F.SPOTS.meeting.push(S(3, y, 4, y, true)); F.SPOTS.meeting.push(S(6, y, 5, y, true)); }
    F.SPOTS.dev.sort((a, b) => rnd(a.x * 7 + a.y) - rnd(b.x * 7 + b.y));
    F.HOME = {
      claude: S(15, 14, 15, 15, true),   // Claude 자리
      me: S(4, 22, 4, 23, true),         // 사장실 책상
      boss: S(4, 24, 4, 22),             // 사장 앞 (업무 받기 · 질문 · 보고)
    };
  },
  wallDecor(t, active) {
    const fN = (u, v) => iso(u, 0, v), fW = (u, v) => iso(0, u, v);
    for (let wx = 11; wx < 23; wx += 2.4) windowN(wx, 2, 26, 72);
    clock(23.3, 66);
    // 회의실 화이트보드
    poly([fW(10, 22), fW(15, 22), fW(15, 62), fW(10, 62)], '#cfd6e0');
    poly([fW(10.15, 25), fW(14.85, 25), fW(14.85, 59), fW(10.15, 59)], '#ffffff');
    for (let i = 0; i < 4; i++) { const yy = 10.6 + i * 0.25; poly([fW(yy + 0.2, 52 - i * 7), fW(yy + 1.6 + rnd(i) * 2, 52 - i * 7), fW(yy + 1.6 + rnd(i) * 2, 50 - i * 7), fW(yy + 0.2, 50 - i * 7)], ['#3b6fd1', '#e35d5b', '#2e9e5b', '#f2a33a'][i]); }
    // 사장실: 액자 + 창밖 풍경
    for (const [yy, c] of [[24.2, '#f2b134'], [25.9, '#3e7cc9']]) {
      poly([fW(yy, 34), fW(yy + 1.2, 34), fW(yy + 1.2, 56), fW(yy, 56)], '#ffffff', '#c9ced8');
      poly([fW(yy + 0.12, 37), fW(yy + 1.08, 37), fW(yy + 1.08, 53), fW(yy + 0.12, 53)], c);
    }
    void fN; void active; void t;
  },
  signs: [
    ['N', 4.5, '자료실', 'LIBRARY', 'archive'], ['N', 17, '개발실', 'DEV', 'dev', 80], ['N', 29.5, '서버실', 'SERVER', 'server', 76],
    ['W', 12.5, '회의실', 'MEETING', 'meeting', 72], ['W', 18.5, '엘리베이터', 'ELEVATOR', null, 76], ['W', 23.4, '사장실', 'CEO', 'desk', 72],
  ],
});

// ======================================================================
// 1층: 작업실 (백그라운드 작업)
// ======================================================================
const FLOOR1 = makeFloor({
  id: '1F', name: '작업실', W: 34, H: 20,
  rooms: {
    dock:     { name: '충전소', x: 0, y: 0, w: 9, h: 7, floor: ['#e5e2d8', '#ddd9ce'] },
    machines: { name: '기계실', x: 10, y: 0, w: 24, h: 9, floor: ['#d4d8de', '#ccd1d8'] },
    board:    { name: '작업 지시실', x: 0, y: 8, w: 9, h: 12, floor: ['#e8e3d7', '#e0dbcd'] },
    bench:    { name: '작업대', x: 11, y: 11, w: 11, h: 9, floor: ['#e8dcc6', '#e0d2ba'] },
    comms:    { name: '통신실', x: 24, y: 11, w: 10, h: 9, floor: ['#d6ebe6', '#cce4de'] },
  },
  hall: ['#dfe1e4', '#d8dbdf'],
  slab: ['#b9bec6', '#a7adb6'],
  wallColors: ['#e9ebee', '#dfe2e6', '#c9ced6', '#bfc5ce', '#3b3f46', '#34383e'],
  elevator: { y0: 11.45, y1: 13.55, cells: [[0, 12], [0, 13]] },
  walls: [
    { d: 'v', at: 9, a: 0, b: 7, kind: 'rail', gaps: [3, 4] },
    { d: 'h', at: 7, a: 0, b: 9, kind: 'rail', gaps: [6, 7] },
    { d: 'h', at: 9, a: 10, b: 34, kind: 'rail', gaps: [15, 16, 25, 26] },
  ],
  // 도구가 가리키는 방 → 1층의 구역
  alias: { archive: 'bench', dev: 'bench', server: 'machines', search: 'comms', meeting: 'board', desk: 'board', team: 'board', cafe: 'board' },
  floorColor(x, y, r, pal) {
    let c = pal[(x + y) & 1];
    if (r === 'machines' && (y === 2 || y === 6) ) c = (x & 1) ? '#e2c23a' : '#2f3238'; // 기계 앞 안전선
    return c;
  },
  floorExtras(t, F) {
    // 충전 패드
    for (const o of F.FURN) if (o.t === 'pad') {
      const p = [iso(o.x + 0.15, o.y + 0.15), iso(o.x + 0.85, o.y + 0.15), iso(o.x + 0.85, o.y + 0.85), iso(o.x + 0.15, o.y + 0.85)];
      poly(p, '#f4d03f', '#7a6512');
      const [px, py] = iso(o.x + 0.5, o.y + 0.5);
      ctx.fillStyle = '#7a6512'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('⚡', px, py + 3);
    }
  },
  floorLabels: [['bench', 11.6, 19.6], ['comms', 24.6, 19.6], ['board', 0.6, 19.6]],
  build({ put, decor, F }) {
    // 충전소: 작업봇이 쉬는 곳
    for (const [x, y] of [[1, 1], [3, 1], [5, 1], [7, 1], [1, 4], [3, 4], [5, 4], [7, 4]]) decor('pad', x, y);
    put('charger', 0, 0); put('crate', 8, 0);
    // 기계실: 백그라운드 셸 작업이 돌아가는 기계
    for (const x of [11, 14, 17, 20, 23, 26, 29, 32]) put('machine', x, 1);
    for (const x of [12, 15, 18, 21, 24, 27, 30]) put('machine', x, 5);
    for (const x of [11, 12, 13, 14, 17, 18, 19, 20, 21, 22, 23, 24, 27, 28, 29, 30, 31, 32, 33]) put('conveyor', x, 8);
    // 작업 지시실
    put('wtable', 4, 16); put('wtable', 5, 16); put('crate', 8, 19); put('crate', 7, 19); put('barrel', 8, 9);
    // 작업대 (백그라운드 서브에이전트가 파일 읽기·고치기)
    for (const y of [13, 17]) for (const x of [12, 14, 16, 18, 20]) put('wbench', x, y);
    put('toolrack', 11, 11); put('toolrack', 21, 11);
    // 통신실
    for (const x of [25, 27, 29, 31]) put('terminal', x, 13);
    put('dish', 32, 18); put('dish', 26, 18); put('barrel', 33, 11);
    put('plant', 22, 19, { kind: 'bush' }); put('plant', 10, 10, { kind: 'bush' });

    F.SPOTS = {
      dock: [S(1, 1, 1, 0), S(3, 1, 3, 0), S(5, 1, 5, 0), S(7, 1, 7, 0), S(1, 4, 1, 3), S(3, 4, 3, 3), S(5, 4, 5, 3), S(7, 4, 7, 3)],
      machines: [],
      board: [S(2, 15, 0, 15), S(2, 17, 0, 17), S(3, 15, 4, 16), S(6, 15, 5, 16), S(3, 17, 4, 16), S(6, 17, 5, 16)],
      bench: [],
      comms: [S(25, 12, 25, 13), S(27, 12, 27, 13), S(29, 12, 29, 13), S(31, 12, 31, 13), S(27, 18, 26, 18), S(31, 18, 32, 18)],
    };
    for (const x of [11, 14, 17, 20, 23, 26, 29, 32]) F.SPOTS.machines.push(S(x, 2, x, 1));
    for (const x of [12, 15, 18, 21, 24, 27, 30]) F.SPOTS.machines.push(S(x, 6, x, 5));
    for (const y of [12, 16]) for (const x of [12, 14, 16, 18, 20]) F.SPOTS.bench.push(S(x, y, x, y + 1));
    F.HOME = { board: S(2, 16, 0, 16) };
  },
  wallDecor(t, active) {
    const fW = (u, v) => iso(0, u, v);
    for (let wx = 11; wx < 33; wx += 3.2) windowN(wx, 2.2, 52, 76, true);
    clock(5, 62);
    // 작업 지시판 (돌고 있는 백그라운드 작업 목록)
    poly([fW(14.3, 14), fW(19.7, 14), fW(19.7, 72), fW(14.3, 72)], '#2b3036');
    poly([fW(14.45, 17), fW(19.55, 17), fW(19.55, 69), fW(14.45, 69)], '#1d3b2f');
    planeText('작업 지시판', 0, 19.3, 64, 'W', 'bold 8px "Malgun Gothic", sans-serif', '#c9f7d9', 'left');
    const jobs = boardState.jobs.slice(0, 6);
    if (!jobs.length) planeText('대기 중인 작업 없음', 0, 19.3, 52, 'W', '7px "Malgun Gothic", sans-serif', '#7fbf9a', 'left');
    jobs.forEach((j, i) => planeText(`${j.icon} ${j.label.slice(0, 22)}  ${j.time}`, 0, 19.3, 54 - i * 7, 'W', '6.5px "Malgun Gothic", sans-serif', j.color, 'left'));
    // 안전 표지
    for (const yy of [2.2, 5.2]) { poly([fW(yy, 30), fW(yy + 1, 30), fW(yy + 1, 46), fW(yy, 46)], '#f4d03f', '#2f3238'); planeText('⚡', 0, yy + 0.5, 38, 'W', 'bold 10px sans-serif', '#2f3238'); }
    void active; void t;
  },
  signs: [
    ['N', 4.5, '충전소', 'DOCK', 'dock', 70], ['N', 21.5, '기계실', 'MACHINES', 'machines', 44],
    ['W', 12.5, '엘리베이터', 'ELEVATOR', null, 76], ['W', 7.4, '작업 지시실', 'DISPATCH', 'board', 72],
  ],
});

export const FLOORS = { '2F': FLOOR2, '1F': FLOOR1 };

// ======================================================================
// 공통 그리기
// ======================================================================
function windowN(wx, w, z0, z1, factory) {
  const fN = (u, v) => iso(u, 0, v);
  poly([fN(wx, z0), fN(wx + w, z0), fN(wx + w, z1), fN(wx, z1)], factory ? '#c9ced6' : '#e3e8ef');
  poly([fN(wx + 0.12, z0 + 3), fN(wx + w - 0.12, z0 + 3), fN(wx + w - 0.12, z1 - 3), fN(wx + 0.12, z1 - 3)], factory ? '#a9cbe0' : '#b9dcf5');
  ctx.globalAlpha = 0.55; poly([fN(wx + 0.12, (z0 + z1) / 2), fN(wx + w - 0.12, (z0 + z1) / 2), fN(wx + w - 0.12, z1 - 3), fN(wx + 0.12, z1 - 3)], '#d8eefc'); ctx.globalAlpha = 1;
  poly([fN(wx + w / 2 - 0.04, z0 + 3), fN(wx + w / 2 + 0.04, z0 + 3), fN(wx + w / 2 + 0.04, z1 - 3), fN(wx + w / 2 - 0.04, z1 - 3)], factory ? '#c9ced6' : '#e3e8ef');
}
function clock(x, z) {
  const [cx, cy] = iso(x, 0, z);
  ctx.save(); ctx.translate(cx, cy); ctx.transform(1, 0.5, 0, 1, 0, 0);
  ellipse(0, 0, 9, 9, '#ffffff', '#3a4250'); ctx.lineWidth = 1.6; ctx.strokeStyle = '#3a4250';
  const d = new Date(); const hA = ((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2, mA = d.getMinutes() / 60 * Math.PI * 2;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(hA) * 4.5, -Math.cos(hA) * 4.5); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(mA) * 7, -Math.cos(mA) * 7); ctx.stroke();
  ctx.restore();
}
function drawElevator(F, e) {
  const fW = (u, v) => iso(0, u, v);
  const { y0, y1 } = e, mid = (y0 + y1) / 2, op = F.elev.open;
  poly([fW(y0 - 0.2, 0), fW(y1 + 0.2, 0), fW(y1 + 0.2, 64), fW(y0 - 0.2, 64)], '#aab3c0');
  poly([fW(y0, 0), fW(y1, 0), fW(y1, 58), fW(y0, 58)], '#262b33');
  if (op > 0.02) { ctx.globalAlpha = op; poly([fW(y0 + 0.1, 0), fW(y1 - 0.1, 0), fW(y1 - 0.1, 56), fW(y0 + 0.1, 56)], '#fff1c1'); ctx.globalAlpha = 1; }
  const gap = op * (mid - y0 - 0.04);
  poly([fW(y0, 0), fW(mid - gap, 0), fW(mid - gap, 58), fW(y0, 58)], '#d3d8df', 'rgba(0,0,0,.22)');
  poly([fW(mid + gap, 0), fW(y1, 0), fW(y1, 58), fW(mid + gap, 58)], '#d3d8df', 'rgba(0,0,0,.22)');
  planeText(`${F.id} ${op > 0.02 ? '▲' : '▲▼'}`, 0, mid, 61, 'W', 'bold 7px sans-serif', op > 0.02 ? '#ff9f1a' : '#6b7280');
}
function sign(wall, at, ko, en, on, z = 68) {
  const f = wall === 'N' ? (u, v) => iso(u, 0, v) : (u, v) => iso(0, u, v);
  ctx.font = 'bold 8.5px "Malgun Gothic", sans-serif';
  const w = ctx.measureText(`${ko} · ${en}`).width / 22 + 0.5;
  const a = wall === 'N' ? at - w / 2 : at + w / 2, b = wall === 'N' ? at + w / 2 : at - w / 2;
  poly([f(a, z - 7), f(b, z - 7), f(b, z + 7), f(a, z + 7)], on ? '#ffe9c2' : '#ffffff', on ? '#f0a33a' : '#c9d0da');
  planeText(`${ko} · ${en}`, wall === 'N' ? at : 0, wall === 'N' ? 0 : at, z, wall, 'bold 8.5px "Malgun Gothic", sans-serif', on ? '#b0600f' : '#465063');
}

function drawWallSeg(x, y, w, d, seg) {
  if (seg.kind === 'solid') { box(x, y, w, d, 58, '#f6f7f9'); return; }
  const vert = w < d;
  if (seg.kind === 'rail') { // 노란 안전 난간
    for (const at of [0.1, 0.9]) box(vert ? x : x + at - 0.03, vert ? y + at - 0.03 : y, vert ? w : 0.06, vert ? 0.06 : d, 22, '#e2b82a');
    box(x, y, w, d, 2.5, '#f4d03f', 19); box(x, y, w, d, 2, '#2f3238', 9);
    return;
  }
  const h = 58;
  box(x, y, w, d, 4, '#c3ccd8');
  ctx.globalAlpha = 0.32; box(x, y, w, d, h - 8, '#bcdcf3', 4, null); ctx.globalAlpha = 1;
  box(x, y, w, d, 4, '#c3ccd8', h - 4);
  for (const [cap, at] of [[seg.capA, 0], [seg.capB, 1]]) {
    if (!cap) continue;
    if (vert) box(x, y + at * d - (at ? 0.08 : 0), w, 0.08, h, '#b7c2d0');
    else box(x + at * w - (at ? 0.08 : 0), y, 0.08, d, h, '#b7c2d0');
  }
  const f = vert ? faceR(x, y, w, d) : faceL(x, y, w, d);
  ctx.globalAlpha = 0.35; quad(f, 0.15, 0.3, 10, 48, '#ffffff'); ctx.globalAlpha = 1;
}

const STATE_LIGHT = { idle: '#7b8494', run: '#4fa8ff', ok: '#3fd47a', fail: '#ff5a4f', stop: '#f0b43a' };
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
      for (const [ox, oy] of [[0.08, 0.16], [0.86, 0.16], [0.08, 0.78], [0.86, 0.78]]) box(x + ox, y + oy, 0.06, 0.06, 15, '#9aa3b2');
      box(x + 0.05, y + 0.12, 0.9, 0.76, 2, '#fbfcfd', 15);
      box(x + 0.46, y + 0.62, 0.08, 0.08, 6, '#5d6676', 17);
      box(x + 0.2, y + 0.6, 0.6, 0.07, 17, '#2c3340', 22);
      if (o.busy) { ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 6); const [px, py] = iso(x + 0.5, y + 0.6, 40); ellipse(px, py, 9, 2.5, '#7cc4ff'); ctx.globalAlpha = 1; }
      box(x + 0.25, y + 0.24, 0.5, 0.14, 1, '#dfe3ea', 17);
      break;
    }
    case 'counter': {
      box(x, y + 0.1, 1, 0.8, 22, '#ffffff');
      quad(faceL(x, y + 0.1, 1, 0.8), 0, 1, 3, 17, '#d97757');
      if (o.label) planeText('Claude', x + 0.5, y + 0.9, 10, 'N', 'bold 9px "Segoe UI", sans-serif', '#ffffff');
      box(x + 0.25, y + 0.62, 0.5, 0.07, 15, '#2c3340', 22);
      box(x + 0.25, y + 0.25, 0.5, 0.14, 1, '#dfe3ea', 22);
      break;
    }
    case 'bdesk': { // 사장 책상 (원목, 금색 명패)
      box(x - 0.01, y + 0.1, 1.02, 0.8, 20, '#6e4026');
      quad(faceL(x - 0.01, y + 0.1, 1.02, 0.8), 0.04, 0.96, 3, 17, '#5a321c');
      if (o.plate) { quad(faceL(x - 0.01, y + 0.1, 1.02, 0.8), 0.2, 0.8, 7, 13, '#d9b44a'); planeText('CEO', x + 0.5, y + 0.9, 10, 'N', 'bold 6px sans-serif', '#5a321c'); }
      if (o.plate) { box(x + 0.2, y + 0.55, 0.6, 0.07, 15, '#2c3340', 20); }
      else if (x === 5) { box(x + 0.3, y + 0.3, 0.25, 0.25, 7, '#e9e2d0', 20); }
      else { box(x + 0.25, y + 0.3, 0.45, 0.3, 2, '#f7f1e3', 20); }
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
    case 'machine': { // 1층 기계: 상태등 + 계기판 + 돌아가는 톱니
      const st = o.state || 'idle';
      box(x + 0.06, y + 0.1, 0.88, 0.75, 34, '#5b6573');
      box(x + 0.12, y + 0.16, 0.76, 0.6, 8, '#454e5b', 34);
      const f = faceL(x + 0.06, y + 0.1, 0.88, 0.75);
      quad(f, 0.1, 0.62, 12, 28, '#14202b');
      if (st === 'run') for (let i = 0; i < 3; i++) quad(f, 0.14, 0.14 + (0.2 + rnd(i + Math.floor(t * 4) + x) * 0.25), 15 + i * 4, 17 + i * 4, ['#7ee787', '#79c0ff', '#ffa657'][i]);
      else quad(f, 0.14, 0.4, 19, 21, STATE_LIGHT[st]);
      quad(f, 0.7, 0.9, 6, 30, '#3a424e');
      const [gx, gy] = iso(x + 0.5, y + 0.45, 46);
      ctx.save(); ctx.translate(gx, gy); ctx.scale(1, 0.55); ctx.rotate(st === 'run' ? t * 4 : 0);
      ctx.fillStyle = '#9aa4b2'; for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.fillRect(-1.6, -8.5, 3.2, 4); }
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill(); ctx.fillStyle = '#5b6573'; ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, 7); ctx.fill();
      ctx.restore();
      const [lx, ly] = iso(x + 0.82, y + 0.2, 50);
      const blink = st === 'run' ? (Math.sin(t * 8) > 0 ? 1 : 0.35) : 1;
      ctx.globalAlpha = blink; ellipse(lx, ly, 3.2, 3.2, STATE_LIGHT[st]); ctx.globalAlpha = 1;
      if (st === 'run') { ctx.globalAlpha = 0.25; ellipse(lx, ly, 7, 7, STATE_LIGHT[st]); ctx.globalAlpha = 1; }
      if (st === 'fail') { ctx.globalAlpha = 0.5; for (let i = 0; i < 3; i++) { const k = (t * 0.8 + i / 3) % 1; ellipse(gx + Math.sin(i + t) * 4, gy - 10 - k * 22, 4 + k * 6, 3 + k * 4, '#8a8f98'); } ctx.globalAlpha = 1; }
      break;
    }
    case 'conveyor': {
      box(x - 0.01, y + 0.25, 1.02, 0.5, 9, '#3a3f47');
      const top = (u, v) => iso(x + u, y + 0.25 + v * 0.5, 9.2);
      for (let i = 0; i < 4; i++) { const u = ((i / 4 + t * 0.35) % 1); poly([top(u, 0), top(Math.min(1, u + 0.04), 0), top(Math.min(1, u + 0.04), 1), top(u, 1)], '#565c66'); }
      if ((x * 7) % 3 === 0) { const u = (t * 0.35 + rnd(x)) % 1; box(x + u * 0.7, y + 0.33, 0.3, 0.34, 9, '#c9a46b', 9.2); }
      break;
    }
    case 'wbench': box(x + 0.04, y + 0.1, 0.92, 0.8, 16, '#b98a5a'); box(x + 0.3, y + 0.35, 0.3, 0.2, 5, '#5b6573', 16); if (o.busy) { const [px, py] = iso(x + 0.45, y + 0.45, 24); ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 20); ellipse(px, py, 2.5, 2.5, '#ffd25a'); ctx.globalAlpha = 1; } break;
    case 'toolrack': { box(x + 0.1, y + 0.05, 0.8, 0.25, 44, '#8a6a4a'); const f = faceL(x + 0.1, y + 0.05, 0.8, 0.25); for (let i = 0; i < 4; i++) quad(f, 0.12 + i * 0.2, 0.2 + i * 0.2, 14 + (i % 2) * 6, 38, ['#c0392b', '#7f8c8d', '#2c3e50', '#d35400'][i]); break; }
    case 'terminal': {
      box(x + 0.15, y + 0.2, 0.7, 0.6, 18, '#47606f');
      box(x + 0.2, y + 0.25, 0.6, 0.15, 22, '#2b3a44', 18);
      quad(faceL(x + 0.2, y + 0.25, 0.6, 0.15), 0.1, 0.9, 22, 38, o.busy ? (Math.sin(t * 6) > 0 ? '#9ff0d4' : '#6fd6b4') : '#7fcfb6');
      break;
    }
    case 'charger': box(x + 0.2, y + 0.1, 0.6, 0.3, 40, '#3b3f46'); quad(faceL(x + 0.2, y + 0.1, 0.6, 0.3), 0.2, 0.8, 22, 34, '#f4d03f'); break;
    case 'crate': box(x + 0.08, y + 0.08, 0.84, 0.84, 22, '#c9a46b'); quad(faceL(x + 0.08, y + 0.08, 0.84, 0.84), 0.45, 0.55, 0, 22, '#a8864f'); break;
    case 'barrel': { const [px, py] = iso(x + 0.5, y + 0.5); ellipse(px, py - 22, 10, 5, '#2f6fb0'); ctx.fillStyle = '#2a5f97'; ctx.fillRect(px - 10, py - 22, 20, 22); ellipse(px, py, 10, 5, '#2a5f97'); ellipse(px, py - 22, 10, 5, '#3a80c4'); break; }
    case 'pad': break; // 바닥에 그려짐
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
    case 'dish': {
      box(x + 0.35, y + 0.35, 0.3, 0.3, 10, '#9aa3ad');
      const [px, py] = iso(x + 0.5, y + 0.5, 26);
      ctx.save(); ctx.translate(px, py); ctx.rotate(-0.5 + Math.sin(t * 0.5 + x) * 0.15);
      ctx.fillStyle = '#e8ecf0'; ctx.strokeStyle = '#7d8790'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 7, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -12); ctx.stroke();
      ctx.fillStyle = '#e05a47'; ctx.beginPath(); ctx.arc(0, -12, 2, 0, 7); ctx.fill();
      ctx.restore();
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
          ctx.save(); ctx.translate(bx, by - 34); ctx.rotate(i / 7 * Math.PI * 2 + sway); ctx.scale(1, 0.55);
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

export function openElevator(F, ms) { F.elev.until = Math.max(F.elev.until, performance.now() + ms); }
