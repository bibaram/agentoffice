// 캐릭터(배우)와 연출(이벤트 → 연기)
// 2층: 사장(나) · Claude · 서브에이전트 / 1층: 백그라운드 서브에이전트 · 작업봇(백그라운드 셸 작업)
import { iso, ctx, ellipse, rrect, shade } from './iso.js';
import { FLOORS, openElevator } from './world.js';

const F2 = FLOORS['2F'], F1 = FLOORS['1F'];

// ---------- 배역 ----------
export const TYPE_KO = { 'general-purpose': '범용', Explore: '탐색', Plan: '계획', 'claude-code-guide': '가이드', 'statusline-setup': '설정', bot: '작업봇' };
export const typeKo = (t) => TYPE_KO[t] || t || '범용';
const hash = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
const HAIRS = ['#2a2420', '#5a3424', '#3b2a1e', '#1f2937', '#7a4e2a', '#4a3f35'];

function styleFor(kind, id) {
  const hair = HAIRS[hash(id) % HAIRS.length];
  switch (kind) {
    case 'claude': return { body: '#d97757', hair: '#5a3424', dot: '#d97757', accent: 'spark' };
    case 'me': return { body: '#2b2f3a', hair: '#2a2420', dot: '#2f6fe0', accent: 'tie' };
    case 'bot': return { body: '#8a96a6', dot: '#f4b400', accent: 'bot' };
    case 'Explore': return { body: '#3f9a5c', hair, dot: '#3f9a5c', accent: 'safari' };
    case 'Plan': return { body: '#3e78c2', hair, dot: '#3e78c2', accent: 'glasses' };
    case 'general-purpose': return { body: '#7d58c6', hair, dot: '#7d58c6', accent: 'cap' };
    default: { const h = hash(kind) % 360; return { body: `hsl(${h},50%,48%)`, hair, dot: `hsl(${h},50%,48%)`, accent: 'band' }; }
  }
}

// ---------- 출연진 ----------
export const actors = new Map();
const claims = new Map();          // "층:x,y" → actor id
const ckey = (F, x, y) => `${F.id}:${x},${y}`;
const overlay = () => document.getElementById('overlay');

export class Actor {
  constructor(id, kind, name, F, x, y, desc = '') {
    Object.assign(this, { id, kind, name, desc, F });
    this.st = styleFor(kind, id);
    this.x = x + 0.5; this.y = y + 0.5;
    this.path = []; this.speed = kind === 'bot' ? 3.8 : 4.6;
    this.face = { dx: 0, dy: 1 };
    this.spot = null; this.room = null;
    this.bubble = null; this.thinkSince = 0; this.idleSince = 0;
    this.tools = new Set(); this.toolCount = 0; this.lastTs = Date.now();
    this.alpha = 1; this.fade = 0;
    this.script = []; this.wait = 0;
    this.hold = false; this.pending = null;   // 업무를 받는 동안엔 다음 이동을 미뤄 둔다
    this.sweatUntil = 0; this.typingUntil = 0;
    this.leaving = false; this.reporting = false; this.background = false;
    this.el = document.createElement('div'); this.el.className = 'bubble'; this.el.style.opacity = 0;
    this.tag = document.createElement('div'); this.tag.className = 'tag';
    this.tag.innerHTML = `<i style="background:${this.st.dot}"></i><span></span>`;
    this.setLabel();
    overlay().append(this.el, this.tag);
    this._html = ''; this._cls = '';
  }
  setLabel() {
    const txt = this.kind === 'claude' || this.kind === 'me' ? this.name
      : this.kind === 'bot' ? `🤖 ${this.desc || '작업봇'}`
      : `${this.background ? '백그라운드 ' : ''}${typeKo(this.kind)} · ${this.desc || this.name}`;
    this.tag.lastChild.textContent = txt;
    this.tag.title = txt;
  }
  cell() { return [Math.floor(this.x), Math.floor(this.y)]; }
  release() { if (this.spot) { claims.delete(ckey(this.F, this.spot.x, this.spot.y)); this.spot = null; } }
  claim(s) { this.release(); this.spot = s; claims.set(ckey(this.F, s.x, s.y), this.id); }
  goTo(tx, ty, instant) {
    if (instant) { this.x = tx + 0.5; this.y = ty + 0.5; this.path = []; return; }
    const [cx, cy] = this.cell();
    this.path = this.F.findPath(cx, cy, tx, ty) || [[tx, ty]];
  }
  goSpot(s, instant) {
    this.claim(s); this.lookAt = [s.fx, s.fy];
    this.goTo(s.x, s.y, instant);
    if (instant) this.faceTo(s.fx, s.fy);
  }
  goRoom(room, instant) {
    if (this.hold && !instant) { this.pending = room; return; }
    const F = this.F, target = F.roomFor(room);
    if (this.room === target && this.spot) return;
    const list = F.spotsFor(room);
    let s = list.find((p) => !claims.has(ckey(F, p.x, p.y)));
    if (!s && F.ROOMS[target]) {
      const r = F.ROOMS[target];
      for (let i = 0; i < 60 && !s; i++) {
        const x = r.x + Math.floor(Math.random() * r.w), y = r.y + Math.floor(Math.random() * r.h);
        if (F.walkable(x, y) && !claims.has(ckey(F, x, y))) s = { x, y, fx: x, fy: y + 1 };
      }
    }
    s = s || list[0];
    if (!s) return;
    this.room = target;
    this.goSpot(s, instant);
  }
  faceTo(x, y) {
    const dx = x + 0.5 - this.x, dy = y + 0.5 - this.y;
    if (Math.abs(dx) + Math.abs(dy) < 0.01) return;
    this.face = Math.abs(dx) > Math.abs(dy) ? { dx: Math.sign(dx), dy: 0 } : { dx: 0, dy: Math.sign(dy) };
  }
  say(kind, text, opts = {}) { this.bubble = Object.assign({ kind, text, since: 0, until: Infinity }, opts); }
  walking() { return this.path.length > 0; }
  seated() { return !this.walking() && this.spot && this.spot.seat && Math.abs(this.x - this.spot.x - 0.5) < 0.05 && Math.abs(this.y - this.spot.y - 0.5) < 0.05; }
  // 업무 받기가 끝나면 미뤄 둔 이동을 실행
  unhold(fallback) {
    this.hold = false;
    const room = this.pending; this.pending = null;
    if (room) this.goRoom(room); else if (fallback) fallback();
  }
  update(dt, now) {
    let step = this.speed * dt;
    while (this.path.length && step > 0) {
      const [nx, ny] = this.path[0];
      const tx = nx + 0.5, ty = ny + 0.5;
      const dx = tx - this.x, dy = ty - this.y, dist = Math.hypot(dx, dy);
      if (dist > 0.001) this.face = Math.abs(dx) > Math.abs(dy) ? { dx: Math.sign(dx), dy: 0 } : { dx: 0, dy: Math.sign(dy) };
      if (dist <= step) { this.x = tx; this.y = ty; this.path.shift(); step -= dist; if (!this.path.length && this.lookAt) this.faceTo(...this.lookAt); }
      else { this.x += dx / dist * step; this.y += dy / dist * step; step = 0; }
    }
    if (this.fade) this.alpha = Math.max(0, Math.min(1, this.alpha + this.fade * dt * 2));
    if (this.script.length && !this.walking() && now >= this.wait) this.script.shift()(this, now);
  }
  remove() { this.release(); this.el.remove(); this.tag.remove(); actors.delete(this.id); }
}

// ---------- 그리기 ----------
export function drawActor(a, t, now) {
  if (a.alpha <= 0) return;
  if (a.kind === 'bot') return drawBot(a, t, now);
  const [sx, sy] = iso(a.x, a.y);
  const walking = a.walking(), sitting = a.seated();
  const sweating = now < a.sweatUntil, typing = now < a.typingUntil || (sitting && a.tools.size > 0);
  const shake = sweating ? Math.sin(t * 50) * 1.2 : 0;
  const bob = walking ? Math.abs(Math.sin(t * 12)) * 1.8 : Math.sin(t * 2 + a.x * 3) * 0.4;
  const front = a.face.dx + a.face.dy >= 0;
  const flip = (a.face.dx - a.face.dy) < 0 ? -1 : 1;
  const st = a.st;
  ctx.save();
  ctx.globalAlpha = a.alpha;
  ctx.translate(sx + shake, sy);
  if (!sitting) ellipse(0, 0, 9, 4.5, 'rgba(40,50,70,.18)');
  ctx.translate(0, -bob);
  ctx.scale(flip, 1);
  ctx.fillStyle = '#3a3f4b';
  if (sitting) { rrect(-4, -12, 9, 3.6, 1.5); ctx.fill(); rrect(-1, -11, 9, 3.6, 1.5); ctx.fill(); }
  else {
    const ph = walking ? Math.sin(t * 12) * 3 : 0;
    ctx.fillRect(-4.5, -11 + Math.max(0, ph) * 0.3, 3.6, 11 - Math.max(0, ph));
    ctx.fillRect(1, -11 + Math.max(0, -ph) * 0.3, 3.6, 11 - Math.max(0, -ph));
    ctx.fillStyle = '#23262d'; ctx.fillRect(-5, -1.5, 4.5, 1.6); ctx.fillRect(0.6, -1.5, 4.5, 1.6);
  }
  ctx.fillStyle = st.body; rrect(-7, -25, 14, 15, 5); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.18)'; rrect(-6, -24, 5, 12, 3); ctx.fill();
  if ((st.accent === 'glasses' || st.accent === 'tie') && front) {
    if (st.accent === 'tie') { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(-3, -25); ctx.lineTo(3, -25); ctx.lineTo(0, -20); ctx.fill(); }
    ctx.fillStyle = st.accent === 'tie' ? '#c9302c' : '#c0392b'; ctx.fillRect(-0.9, -24, 1.8, 8);
  }
  const armC = typeof st.body === 'string' && st.body.startsWith('#') ? shade(st.body, -0.15) : st.body;
  ctx.fillStyle = armC;
  if (typing) { const k = Math.sin(t * 28) * 1.2; rrect(3, -19 + k, 7, 3.6, 1.6); ctx.fill(); rrect(-3, -18 - k, 7, 3.6, 1.6); ctx.fill(); }
  else { const sw = walking ? Math.sin(t * 12) * 2 : 0; rrect(-9.5, -22, 3.4, 10 + sw * 0.5, 1.6); ctx.fill(); rrect(6.1, -22, 3.4, 10 - sw * 0.5, 1.6); ctx.fill(); }
  ellipse(0, -34, 9.5, 9, '#f6d8bf');
  ctx.fillStyle = st.hair;
  if (front) {
    ctx.beginPath(); ctx.ellipse(0, -36, 9.8, 7.5, 0, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-6.5, -34, 3.4, 5, 0.2, 0, 7); ctx.fill();
    ctx.fillStyle = '#2b2420';
    if (sweating) { ctx.fillRect(0.5, -33, 2.6, 1.2); ctx.fillRect(4.6, -33, 2.6, 1.2); }
    else { ellipse(2, -32.5, 1.1, 1.4, '#2b2420'); ellipse(5.8, -32.5, 1.1, 1.4, '#2b2420'); }
    ellipse(7, -29.5, 1.7, 1.1, 'rgba(240,120,110,.4)');
    ctx.strokeStyle = '#7a4a3a'; ctx.lineWidth = 0.9; ctx.beginPath();
    if (sweating) { ctx.moveTo(2.5, -28.6); ctx.lineTo(5.5, -28.6); } else ctx.arc(4, -30, 1.6, 0.2, Math.PI - 0.2);
    ctx.stroke();
  } else { ellipse(0, -34.5, 9.8, 9.2, st.hair); }
  switch (st.accent) {
    case 'safari': ellipse(0, -40, 12, 3.4, '#cdb07a'); ctx.fillStyle = '#dcc290'; ctx.beginPath(); ctx.arc(0, -40.5, 7, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#7a5a2a'; ctx.fillRect(-7, -41.5, 14, 1.6); break;
    case 'glasses': if (front) { ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(2, -32.5, 2.5, 0, 7); ctx.moveTo(8.3, -32.5); ctx.arc(5.8, -32.5, 2.5, 0, 7); ctx.stroke(); } break;
    case 'cap': ctx.fillStyle = '#f2c14e'; ctx.beginPath(); ctx.ellipse(0, -38, 9.2, 6.5, 0, Math.PI, 0); ctx.fill(); if (front) { ctx.fillRect(3, -39, 9, 2.4); } break;
    case 'band': ctx.fillStyle = '#ffffff'; ctx.fillRect(-9, -40, 18, 2.6); break;
  }
  ctx.restore();
  if (st.accent === 'spark') {
    ctx.save(); ctx.globalAlpha = a.alpha;
    ctx.translate(sx + shake, sy - bob - 50);
    ctx.rotate(t * (a.tools.size || a.thinkSince ? 3 : 0.6));
    ctx.strokeStyle = '#d97757'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-5.5, 0); ctx.lineTo(5.5, 0); ctx.stroke(); ctx.rotate(Math.PI / 4); }
    ctx.restore();
  }
  if (st.accent === 'tie') { // 사장 왕관 배지
    ctx.save(); ctx.globalAlpha = a.alpha; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('👑', sx, sy - bob - 47); ctx.restore();
  }
  if (sweating) {
    const k = (t * 2) % 1;
    ellipse(sx - 11 * flip, sy - 38 + k * 6, 2, 3, '#5bb4f0');
    ellipse(sx + 12 * flip, sy - 43 + ((k + 0.5) % 1) * 6, 1.6, 2.4, '#5bb4f0');
  }
}

// 작업봇: 바퀴 달린 네모 로봇. 일하면 팔이 움직이고 불꽃이 튄다
function drawBot(a, t, now) {
  const [sx, sy] = iso(a.x, a.y);
  const walking = a.walking(), working = a.job && a.job.status === 'run' && !walking;
  const fail = a.job && a.job.status === 'fail';
  const shake = now < a.sweatUntil ? Math.sin(t * 50) * 1.2 : 0;
  const flip = (a.face.dx - a.face.dy) < 0 ? -1 : 1;
  const front = a.face.dx + a.face.dy >= 0;
  ctx.save();
  ctx.globalAlpha = a.alpha;
  ctx.translate(sx + shake, sy);
  ellipse(0, 0, 9, 4.5, 'rgba(40,50,70,.2)');
  ctx.scale(flip, 1);
  const hover = walking ? Math.sin(t * 16) * 0.8 : 0;
  // 바퀴
  ctx.fillStyle = '#2f3238'; rrect(-7, -5, 14, 5, 2.5); ctx.fill();
  ctx.fillStyle = '#5b616b'; for (const wx of [-4.5, 0, 4.5]) { ctx.beginPath(); ctx.arc(wx, -2.5, 1.6, 0, 7); ctx.fill(); }
  ctx.translate(0, hover);
  // 몸통
  ctx.fillStyle = '#9aa6b6'; rrect(-7.5, -21, 15, 16, 3); ctx.fill();
  ctx.fillStyle = '#f4b400'; ctx.fillRect(-7.5, -11, 15, 2.4);
  ctx.fillStyle = '#7d8999'; rrect(-4, -18, 8, 5, 1.5); ctx.fill();
  // 팔
  ctx.strokeStyle = '#6f7b8b'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  const k = working ? Math.sin(t * 14) * 3 : 0;
  ctx.beginPath(); ctx.moveTo(6.5, -16); ctx.lineTo(11, -13 + k); ctx.moveTo(-6.5, -16); ctx.lineTo(-10, -11 - k * 0.5); ctx.stroke();
  // 머리 (화면 얼굴)
  ctx.fillStyle = '#c4ccd8'; rrect(-7, -32, 14, 11, 3); ctx.fill();
  ctx.fillStyle = '#1b2430'; rrect(-5.5, -30.5, 11, 8, 2); ctx.fill();
  if (front) {
    const eye = fail ? '#ff5a4f' : a.job && a.job.status === 'ok' ? '#3fd47a' : '#5fe0ff';
    if (fail) { ctx.strokeStyle = eye; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-3.5, -28.5); ctx.lineTo(-1, -25.5); ctx.moveTo(-1, -28.5); ctx.lineTo(-3.5, -25.5); ctx.moveTo(1.5, -28.5); ctx.lineTo(4, -25.5); ctx.moveTo(4, -28.5); ctx.lineTo(1.5, -25.5); ctx.stroke(); }
    else { const blink = Math.sin(t * 1.7 + a.x) > 0.96 ? 0.3 : 2.4; ctx.fillStyle = eye; ctx.fillRect(-3.6, -27.5 - blink / 2, 2.2, blink); ctx.fillRect(1.6, -27.5 - blink / 2, 2.2, blink); }
  }
  // 안테나
  ctx.strokeStyle = '#6f7b8b'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, -32); ctx.lineTo(0, -37); ctx.stroke();
  const lc = fail ? '#ff5a4f' : working ? (Math.sin(t * 10) > 0 ? '#ffd25a' : '#a07a10') : '#3fd47a';
  ellipse(0, -38, 2, 2, lc);
  ctx.restore();
  if (working) { // 불꽃
    for (let i = 0; i < 4; i++) {
      const p = (t * 3 + i / 4) % 1;
      ctx.globalAlpha = 1 - p;
      ellipse(sx + 12 * flip + Math.cos(i * 1.7) * p * 9, sy - 14 - p * 8 + Math.sin(i) * 3, 1.3, 1.3, '#ffcf3a');
    }
    ctx.globalAlpha = 1;
  }
}

// ---------- 출연진 관리 ----------
export let claude = null, me = null;
export function resetCast(userName) {
  for (const a of [...actors.values()]) a.remove();
  claims.clear();
  me = new Actor('user', 'me', `${userName || '사장'} (나)`, F2, F2.HOME.me.x, F2.HOME.me.y);
  me.goSpot(F2.HOME.me, true); me.room = 'desk';
  claude = new Actor('main', 'claude', 'Claude', F2, F2.HOME.claude.x, F2.HOME.claude.y);
  claude.goSpot(F2.HOME.claude, true); claude.room = 'home';
  actors.set('user', me); actors.set('main', claude);
}
export function renameMe(userName) { if (me) { me.name = `${userName} (나)`; me.setLabel(); } }
function goHome(a, instant) {
  if (a === claude) { a.room = 'home'; a.goSpot(F2.HOME.claude, instant); }
}

function agentActor(id, type, desc, background, replay) {
  let a = actors.get(id);
  if (a) { if (desc && !a.desc) { a.desc = desc; a.setLabel(); } return a; }
  type = type || 'general-purpose';
  const F = background ? F1 : F2;
  const [ex, ey] = F.ELEVATOR[actors.size % 2];
  a = new Actor(id, type, typeKo(type), F, ex, ey, desc);
  a.background = !!background; a.setLabel();
  a.face = { dx: 1, dy: 0 };
  if (!replay) { a.alpha = 0; a.fade = 1; openElevator(F, 1700); }
  actors.set(id, a);
  return a;
}

// 작업봇: 충전소의 빈 패드에서 깨어나 기계로 간다
const jobs = new Map(); // toolId → bot
function spawnBot(ev, replay) {
  const id = 'bot:' + ev.toolId;
  let b = actors.get(id);
  if (b) return b;
  const pads = F1.SPOTS.dock;
  const pad = pads.find((p) => !claims.has(ckey(F1, p.x, p.y)) && ![...actors.values()].some((x) => x.home === p)) || pads[jobs.size % pads.length];
  b = new Actor(id, 'bot', '작업봇', F1, pad.x, pad.y, ev.label);
  b.home = pad;
  b.job = { label: ev.label, status: 'run', since: ev.ts, line: '', toolId: ev.toolId, taskId: '' };
  if (!replay) { b.alpha = 0; b.fade = 1; }
  actors.set(id, b); jobs.set(ev.toolId, b);
  b.goRoom('server', replay);
  b.say('tool', `🛠 ${ev.label}`, { since: ev.ts, live: true });
  return b;
}
function botFor(ev) {
  if (ev.toolId && jobs.has(ev.toolId)) return jobs.get(ev.toolId);
  if (ev.taskId) for (const b of jobs.values()) if (b.job.taskId === ev.taskId) return b;
  return null;
}
export function boardJobs(now) {
  const icon = { run: '▶', ok: '✓', fail: '✗', stop: '■' }, color = { run: '#9ff0c0', ok: '#62d98f', fail: '#ff8a80', stop: '#f5c46b' };
  return [...jobs.values()].map((b) => ({ icon: icon[b.job.status], color: color[b.job.status], label: b.job.label, time: fmtSec((b.job.end || now) - b.job.since) }));
}

// ---------- 말풍선 내용 / 상태 ----------
export const fmtSec = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function bubbleFor(a, now) {
  const b = a.bubble;
  if (b && now < b.until) {
    if (b.kind === 'think') return { cls: 'think', html: `<b>${esc(b.text)}</b>${b.sub ? `<small>${esc(b.sub)}</small>` : ''}`, plain: b.text };
    let t = esc(b.text);
    if (b.frozen != null) t += ` <em>· ${fmtSec(b.frozen)} ✓</em>`;
    else if (b.live) t += ` <em>· ${fmtSec(now - b.since)}</em>`;
    const sub = a.job && a.job.line && a.job.status === 'run' ? a.job.line : b.sub;
    if (sub) t += `<small class="${a.kind === 'bot' ? 'mono' : ''}">${esc(sub)}</small>`;
    return { cls: b.kind, html: t, plain: sub || b.text };
  }
  if (a.thinkSince && now - a.thinkSince > 1200) {
    const s = fmtSec(now - a.thinkSince);
    return { cls: 'think', html: `<b>💭 고민 중 <span class="dots"><i></i><i></i><i></i></span></b><small>${s}째 고민 중</small>`, plain: '💭 고민 중…' };
  }
  return null;
}
export function statusOf(a, now) {
  if (a.kind === 'bot') return { run: ['작업 중', 'work'], ok: ['완료', 'bye'], fail: ['실패', 'err'], stop: ['중지됨', 'ask'] }[a.job.status];
  const b = a.bubble && now < a.bubble.until ? a.bubble : null;
  if (a.leaving) return ['퇴근 중', 'bye'];
  if (a.reporting) return ['보고 중', 'report'];
  if (a.hold) return ['업무 받는 중', 'ask'];
  if (b && b.kind.startsWith('question')) return ['질문 중', 'ask'];
  if (b && b.kind === 'error') return ['진땀 중', 'err'];
  if (a.tools.size) return ['작업 중', 'work'];
  if (a.thinkSince) return ['고민 중', 'think'];
  if (b && b.kind === 'say') return ['말하는 중', 'say'];
  return ['대기', 'idle'];
}

// ---------- 연출: 이벤트 → 연기 ----------
let REPLAY = false;
const sayDur = (txt) => Math.min(12000, 3500 + String(txt || '').length * 45);
const now = () => Date.now();
export const setReplay = (v) => { REPLAY = v; };

// 사장 → Claude: 업무 지시를 받으러 사장실로
function briefClaude(ts) {
  claude.hold = true; claude.pending = null; claude.script = [];
  claude.room = 'boss'; claude.goSpot(F2.HOME.boss);
  claude.script = [
    (x, t) => { x.faceTo(F2.HOME.me.x, F2.HOME.me.y); me.faceTo(...x.cell()); x.say('say', '📋 네, 사장님! 업무 접수했습니다', { until: now() + 2200 }); x.thinkSince = 0; x.wait = t + 1600; },
    (x) => { x.thinkSince = x.tools.size ? 0 : Date.now(); x.unhold(() => goHome(x)); },
  ];
  void ts;
}
// Claude → 서브에이전트: Claude 옆으로 와서 업무 배정 (1층은 작업 지시판 앞)
function briefAgent(a) {
  a.hold = true; a.pending = null;
  if (a.background) {
    a.script = [
      (x) => { x.goSpot(F1.HOME.board); },
      (x, t) => { x.say('say', `📋 작업 지시 확인! ${x.desc ? '"' + x.desc + '"' : ''}`, { until: now() + 2200 }); x.wait = t + 1500; },
      (x) => { x.thinkSince = x.tools.size ? 0 : Date.now(); x.unhold(); },
    ];
    return;
  }
  a.script = [
    (x) => { const n = freeNear(claude); x.claim({ x: n[0], y: n[1], fx: claude.cell()[0], fy: claude.cell()[1] }); x.goTo(n[0], n[1]); x.lookAt = claude.cell(); },
    (x, t) => {
      x.faceTo(...claude.cell());
      x.say('say', `📋 "${x.desc || '업무'}" 맡았습니다!`, { until: now() + 2200 });
      const cb = claude.bubble;
      if (!cb || cb.until < now() || /done/.test(cb.kind)) { claude.faceTo(...x.cell()); claude.say('say', '🧑‍💼 부탁해요!', { until: now() + 1800 }); }
      x.wait = t + 1500;
    },
    (x) => { x.thinkSince = x.tools.size ? 0 : Date.now(); x.unhold(); },
  ];
}
function freeNear(target) {
  const F = target.F, [cx, cy] = target.cell();
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [1, 1], [-1, 1], [0, 2], [2, 0], [-2, 0], [0, -1], [1, -1], [-1, -1], [2, 1], [-2, 1]]) {
    const nx = cx + dx, ny = cy + dy;
    if (F.walkable(nx, ny) && !occupied(F, nx, ny)) return [nx, ny];
  }
  return [cx, cy + 1];
}
function occupied(F, x, y) { for (const a of actors.values()) { if (a.F !== F) continue; const [cx, cy] = a.cell(); if (cx === x && cy === y) return true; } return claims.has(ckey(F, x, y)); }

export function direct(ev) {
  const R = REPLAY, ts = ev.ts || now();
  switch (ev.kind) {
    case 'agent_spawn': {
      const a = agentActor(ev.actor, ev.agentType, ev.text, ev.background, R);
      a.thinkSince = ts; a.lastTs = ts;
      if (R) { a.goTo(2, a.cell()[1], true); return; }
      a.say('say', '🛗 출근했습니다!', { until: ts + 2000 });
      a.goTo(2, a.cell()[1]);
      briefAgent(a);
      return;
    }
    case 'agent_done': {
      const a = actors.get(ev.actor);
      if (!a) return;
      if (R) { a.remove(); return; }
      finishAgent(a, ev.text);
      return;
    }
    case 'bg_start':
      if (ev.bgKind === 'shell') spawnBot(ev, R);
      return;
    case 'bg_info': { const b = botFor(ev); if (b) b.job.taskId = ev.taskId; return; }
    case 'bg_progress': { const b = botFor(ev); if (b) b.job.line = ev.line; return; }
    case 'bg_end': {
      const b = botFor(ev);
      if (!b) return;
      finishBot(b, ev, R);
      return;
    }
    case 'interrupt':
      me.say('stop', '✋ 잠깐, 멈춰!', { until: ts + 3000 });
      if (!R) me.typingUntil = now() + 900;
      claude.path = []; claude.tools.clear(); claude.thinkSince = 0; claude.script = []; claude.hold = false; claude.pending = null;
      claude.say('say', '😳 넵, 멈출게요!', { until: ts + 2500 });
      claude.idleSince = ts; claude.lastTs = ts;
      return;
    case 'user_say':
      me.say('user', `📢 ${ev.text}`, { until: ts + sayDur(ev.text) });
      if (!R) { me.typingUntil = now() + 2200; briefClaude(ts); }
      claude.thinkSince = ts; claude.idleSince = 0; claude.lastTs = ts;
      return;
    case 'answer':
      me.say('user', `💬 ${ev.text}`, { until: ts + sayDur(ev.text) });
      if (!R) me.typingUntil = now() + 1200;
      return;
  }
  const a = ev.actor === 'main' ? claude : ev.actor === 'user' ? me : agentActor(ev.actor, ev.agentType, '', false, R);
  a.lastTs = ts;
  switch (ev.kind) {
    case 'think':
      a.idleSince = 0;
      a.say('think', `💭 ${fmtSec(ev.dur || 0)} 고민함`, { sub: ev.text || '', until: ts + 3500 });
      a.thinkSince = ts;
      break;
    case 'say':
      a.thinkSince = 0; a.idleSince = 0;
      a.say('say', ev.text, { until: ts + sayDur(ev.text) });
      break;
    case 'tool_start': case 'question': {
      a.thinkSince = 0; a.idleSince = 0;
      a.tools.add(ev.toolId); a.toolCount++;
      if (a === claude && ev.room === 'desk') { // 나한테 질문·보고 → 사장실로
        if (a.hold) a.pending = null; else { a.room = 'boss'; a.goSpot(F2.HOME.boss, R); }
      } else a.goRoom(ev.room, R);
      a.say(ev.kind === 'question' ? 'question' : 'tool', ev.label, { since: ts, toolId: ev.toolId, live: ev.kind !== 'question' });
      if (ev.kind === 'question') me.faceTo(F2.HOME.boss.x, F2.HOME.boss.y);
      break;
    }
    case 'tool_end': {
      a.tools.delete(ev.toolId);
      const b = a.bubble;
      if (!ev.ok) {
        a.say('error', `❌ ${ev.tool || '도구'} 실패${ev.text ? ' — ' + ev.text : ''}`, { until: ts + 4500 });
        a.sweatUntil = (R ? ts : now()) + 3200;
      } else if (b && b.toolId === ev.toolId) {
        b.kind = b.kind === 'question' ? 'question done' : 'tool done';
        b.frozen = ev.dur != null ? ev.dur : ts - b.since;
        b.until = ts + 900;
      }
      if (!a.tools.size) a.thinkSince = ts;
      me.faceTo(F2.HOME.me.fx, F2.HOME.me.fy);
      break;
    }
    case 'error':
      a.say('error', ev.text, { until: ts + 4000 }); a.sweatUntil = (R ? ts : now()) + 2500;
      break;
    case 'turn_end':
      if (a === claude) { a.tools.clear(); a.thinkSince = 0; a.idleSince = ts; me.faceTo(F2.HOME.me.fx, F2.HOME.me.fy); }
      break;
  }
}

function finishBot(b, ev, replay) {
  const st = ev.status === 'completed' ? 'ok' : ev.status === 'failed' ? 'fail' : 'stop';
  b.job.status = st; b.job.end = ev.ts || now();
  jobs.delete(b.job.toolId);
  if (replay) { b.remove(); return; }
  jobs.set(b.job.toolId, b); // 완료 표시를 잠깐 지시판에 남김
  const head = { ok: '✅ 완료', fail: '❌ 실패', stop: '⏹ 중지됨' }[st];
  b.say(st === 'ok' ? 'bye' : st === 'fail' ? 'error' : 'stop', `${head} · ${b.job.label}`, { until: now() + 4000, sub: ev.summary || '' });
  if (st === 'fail') b.sweatUntil = now() + 2500;
  b.script = [
    (x, t) => { x.wait = t + 3500; },
    (x) => { x.release(); x.room = null; x.goSpot(x.home); },
    (x, t) => { x.fade = -1; x.wait = t + 800; },
    (x) => { jobs.delete(x.job.toolId); x.remove(); },
  ];
}

function finishAgent(a, report) {
  a.tools.clear(); a.thinkSince = 0; a.bubble = null; a.reporting = true; a.hold = false; a.pending = null;
  a.release(); a.room = null;
  const toBoard = a.background;
  a.script = [
    (x) => {
      if (toBoard) { x.goSpot(F1.HOME.board); return; }
      const n = freeNear(claude);
      x.claim({ x: n[0], y: n[1], fx: claude.cell()[0], fy: claude.cell()[1] });
      x.goTo(n[0], n[1]); x.lookAt = claude.cell();
    },
    (x, t) => {
      if (!toBoard) x.faceTo(...claude.cell());
      x.say('report', `📄 ${report || '맡긴 일 끝냈습니다!'}`, { until: now() + sayDur(report) });
      x.wait = t + sayDur(report);
      if (!toBoard) {
        const cb = claude.bubble;
        if (!cb || cb.until < now() || /done/.test(cb.kind)) { claude.faceTo(...x.cell()); claude.say('say', '👍 수고했어요!', { until: now() + 2500 }); }
      }
    },
    (x, t) => { x.reporting = false; x.leaving = true; x.say('bye', '👋 퇴근합니다!', { until: now() + 2200 }); x.wait = t + 1900; },
    (x) => { x.release(); const [ex, ey] = x.F.ELEVATOR[Math.random() < 0.5 ? 0 : 1]; x.goTo(ex, ey); x.lookAt = [ex - 1, ey]; },
    (x, t) => { openElevator(x.F, 1500); x.face = { dx: -1, dy: 0 }; x.fade = -1; x.wait = t + 900; },
    (x) => x.remove(),
  ];
}

export function afterReplay() {
  if (claude.idleSince && now() - claude.idleSince > 5000) { goHome(claude, true); claude.idleSince = 0; }
  for (const a of actors.values()) if (a.thinkSince && now() - a.thinkSince > 15 * 60000) a.thinkSince = 0;
  // 반나절 넘게 끝 소식이 없는 백그라운드 작업은 이미 사라진 것으로 본다
  for (const b of [...jobs.values()]) if (now() - b.job.since > 12 * 3600000) { jobs.delete(b.job.toolId); b.remove(); }
}

// 매 프레임: 쉬는 Claude는 자리로
export function tickDirector(wall) {
  if (claude && claude.idleSince && wall - claude.idleSince > 5000 && !claude.walking() && !claude.tools.size && !claude.hold) {
    claude.idleSince = 0;
    if (claude.room !== 'home') goHome(claude);
  }
}
