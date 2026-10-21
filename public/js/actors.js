// 캐릭터(배우)와 연출(이벤트 → 연기)
import { iso, ctx, ellipse, rrect, shade } from './iso.js';
import { ROOMS, SPOTS, HOME, ELEVATOR, walkable, findPath, openElevator, roomAt } from './world.js';

// ---------- 배역 ----------
export const TYPE_KO = { 'general-purpose': '범용', Explore: '탐색', Plan: '계획', 'claude-code-guide': '가이드', 'statusline-setup': '설정' };
export const typeKo = (t) => TYPE_KO[t] || t || '범용';
const hash = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
const HAIRS = ['#2a2420', '#5a3424', '#3b2a1e', '#1f2937', '#7a4e2a', '#4a3f35'];

function styleFor(kind, id) {
  const hair = HAIRS[hash(id) % HAIRS.length];
  switch (kind) {
    case 'claude': return { body: '#d97757', hair: '#5a3424', dot: '#d97757', accent: 'spark' };
    case 'me': return { body: '#2f4f86', hair: '#2a2420', dot: '#2f6fe0', accent: 'headset' };
    case 'Explore': return { body: '#3f9a5c', hair, dot: '#3f9a5c', accent: 'safari' };
    case 'Plan': return { body: '#3e78c2', hair, dot: '#3e78c2', accent: 'glasses' };
    case 'general-purpose': return { body: '#7d58c6', hair, dot: '#7d58c6', accent: 'cap' };
    default: { const h = hash(kind) % 360; return { body: `hsl(${h},50%,48%)`, hair, dot: `hsl(${h},50%,48%)`, accent: 'band' }; }
  }
}

// ---------- 출연진 ----------
export const actors = new Map();
const claims = new Map();
const overlay = () => document.getElementById('overlay');

export class Actor {
  constructor(id, kind, name, x, y, desc = '') {
    Object.assign(this, { id, kind, name, desc });
    this.st = styleFor(kind, id);
    this.x = x + 0.5; this.y = y + 0.5;
    this.path = []; this.speed = 4.6;
    this.face = { dx: 0, dy: 1 };
    this.spot = null; this.room = null;
    this.bubble = null; this.thinkSince = 0; this.idleSince = 0;
    this.tools = new Set(); this.toolCount = 0; this.lastTs = Date.now();
    this.alpha = 1; this.fade = 0;
    this.script = []; this.wait = 0;
    this.sweatUntil = 0; this.typingUntil = 0;
    this.leaving = false; this.reporting = false;
    this.el = document.createElement('div'); this.el.className = 'bubble'; this.el.style.opacity = 0;
    this.tag = document.createElement('div'); this.tag.className = 'tag';
    this.tag.innerHTML = `<i style="background:${this.st.dot}"></i><span></span>`;
    this.setLabel();
    overlay().append(this.el, this.tag);
    this._html = ''; this._cls = '';
  }
  setLabel() {
    const txt = this.kind === 'claude' || this.kind === 'me' ? this.name : `${typeKo(this.kind)} · ${this.desc || this.name}`;
    this.tag.lastChild.textContent = txt;
    this.tag.title = txt;
  }
  cell() { return [Math.floor(this.x), Math.floor(this.y)]; }
  release() { if (this.spot) { claims.delete(this.spot.x + ',' + this.spot.y); this.spot = null; } }
  claim(s) { this.release(); this.spot = s; claims.set(s.x + ',' + s.y, this.id); }
  goTo(tx, ty, instant) {
    if (instant) { this.x = tx + 0.5; this.y = ty + 0.5; this.path = []; return; }
    const [cx, cy] = this.cell();
    this.path = findPath(cx, cy, tx, ty) || [[tx, ty]];
  }
  goSpot(s, instant) {
    this.claim(s); this.lookAt = [s.fx, s.fy];
    this.goTo(s.x, s.y, instant);
    if (instant) this.faceTo(s.fx, s.fy);
  }
  goRoom(room, instant) {
    if (this.room === room && this.spot) return;
    const list = SPOTS[room] || [];
    let s = list.find((p) => !claims.has(p.x + ',' + p.y));
    if (!s) {
      const r = ROOMS[room];
      for (let i = 0; i < 60 && !s; i++) {
        const x = r.x + Math.floor(Math.random() * r.w), y = r.y + Math.floor(Math.random() * r.h);
        if (walkable(x, y) && !claims.has(x + ',' + y)) s = { x, y, fx: x, fy: y + 1 };
      }
      s = s || list[0];
    }
    this.room = room;
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

// ---------- 그리기 (치비 스타일) ----------
export function drawActor(a, t, now) {
  if (a.alpha <= 0) return;
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
  // 다리
  ctx.fillStyle = '#3a3f4b';
  if (sitting) { rrect(-4, -12, 9, 3.6, 1.5); ctx.fill(); rrect(-1, -11, 9, 3.6, 1.5); ctx.fill(); }
  else {
    const ph = walking ? Math.sin(t * 12) * 3 : 0;
    ctx.fillRect(-4.5, -11 + Math.max(0, ph) * 0.3, 3.6, 11 - Math.max(0, ph));
    ctx.fillRect(1, -11 + Math.max(0, -ph) * 0.3, 3.6, 11 - Math.max(0, -ph));
    ctx.fillStyle = '#23262d'; ctx.fillRect(-5, -1.5, 4.5, 1.6); ctx.fillRect(0.6, -1.5, 4.5, 1.6);
  }
  // 몸통
  ctx.fillStyle = st.body; rrect(-7, -25, 14, 15, 5); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.18)'; rrect(-6, -24, 5, 12, 3); ctx.fill();
  if (st.accent === 'glasses' && front) { ctx.fillStyle = '#c0392b'; ctx.fillRect(-0.9, -24, 1.8, 8); }
  // 팔
  const armC = typeof st.body === 'string' && st.body.startsWith('#') ? shade(st.body, -0.15) : st.body;
  ctx.fillStyle = armC;
  if (typing) { const k = Math.sin(t * 28) * 1.2; rrect(3, -19 + k, 7, 3.6, 1.6); ctx.fill(); rrect(-3, -18 - k, 7, 3.6, 1.6); ctx.fill(); }
  else { const sw = walking ? Math.sin(t * 12) * 2 : 0; rrect(-9.5, -22, 3.4, 10 + sw * 0.5, 1.6); ctx.fill(); rrect(6.1, -22, 3.4, 10 - sw * 0.5, 1.6); ctx.fill(); }
  // 머리 (큼직하게)
  ellipse(0, -34, 9.5, 9, '#f6d8bf');
  ctx.fillStyle = st.hair;
  if (front) {
    ctx.beginPath(); ctx.ellipse(0, -36, 9.8, 7.5, 0, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-6.5, -34, 3.4, 5, 0.2, 0, 7); ctx.fill();
    // 얼굴
    ctx.fillStyle = '#2b2420';
    if (sweating) { ctx.fillRect(0.5, -33, 2.6, 1.2); ctx.fillRect(4.6, -33, 2.6, 1.2); }
    else { ellipse(2, -32.5, 1.1, 1.4, '#2b2420'); ellipse(5.8, -32.5, 1.1, 1.4, '#2b2420'); }
    ellipse(7, -29.5, 1.7, 1.1, 'rgba(240,120,110,.4)');
    ctx.strokeStyle = '#7a4a3a'; ctx.lineWidth = 0.9; ctx.beginPath();
    if (sweating) { ctx.moveTo(2.5, -28.6); ctx.lineTo(5.5, -28.6); } else ctx.arc(4, -30, 1.6, 0.2, Math.PI - 0.2);
    ctx.stroke();
  } else { ellipse(0, -34.5, 9.8, 9.2, st.hair); }
  // 소품
  switch (st.accent) {
    case 'safari': ellipse(0, -40, 12, 3.4, '#cdb07a'); ctx.fillStyle = '#dcc290'; ctx.beginPath(); ctx.arc(0, -40.5, 7, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#7a5a2a'; ctx.fillRect(-7, -41.5, 14, 1.6); break;
    case 'glasses': if (front) { ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(2, -32.5, 2.5, 0, 7); ctx.moveTo(8.3, -32.5); ctx.arc(5.8, -32.5, 2.5, 0, 7); ctx.stroke(); } break;
    case 'cap': ctx.fillStyle = '#f2c14e'; ctx.beginPath(); ctx.ellipse(0, -38, 9.2, 6.5, 0, Math.PI, 0); ctx.fill(); if (front) { ctx.fillRect(3, -39, 9, 2.4); } break;
    case 'band': ctx.fillStyle = '#ffffff'; ctx.fillRect(-9, -40, 18, 2.6); break;
    case 'headset': ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(0, -35, 10.5, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); ellipse(-9.5, -33, 2.2, 3.2, '#1f2937'); break;
  }
  ctx.restore();
  // Claude 반짝이 (생각·작업 중이면 빨리 돈다)
  if (st.accent === 'spark') {
    ctx.save(); ctx.globalAlpha = a.alpha;
    ctx.translate(sx + shake, sy - bob - 50);
    ctx.rotate(t * (a.tools.size || a.thinkSince ? 3 : 0.6));
    ctx.strokeStyle = '#d97757'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-5.5, 0); ctx.lineTo(5.5, 0); ctx.stroke(); ctx.rotate(Math.PI / 4); }
    ctx.restore();
  }
  if (sweating) {
    const k = (t * 2) % 1;
    ellipse(sx - 11 * flip, sy - 38 + k * 6, 2, 3, '#5bb4f0');
    ellipse(sx + 12 * flip, sy - 43 + ((k + 0.5) % 1) * 6, 1.6, 2.4, '#5bb4f0');
  }
}

// ---------- 출연진 관리 ----------
export let claude = null, me = null;
export function resetCast(userName) {
  for (const a of [...actors.values()]) a.remove();
  claims.clear();
  me = new Actor('user', 'me', `${userName || '나'} (나)`, HOME.me.x, HOME.me.y);
  me.goSpot(HOME.me, true);
  claude = new Actor('main', 'claude', 'Claude', HOME.claude.x, HOME.claude.y);
  claude.goSpot(HOME.claude, true); claude.room = 'desk-home';
  actors.set('user', me); actors.set('main', claude);
}
export function renameMe(userName) { if (me) { me.name = `${userName} (나)`; me.setLabel(); } }
function goHome(a, instant) { if (a === claude) { a.room = 'desk-home'; a.goSpot(HOME.claude, instant); } }

function agentActor(id, type, desc, replay) {
  let a = actors.get(id);
  if (a) { if (desc && !a.desc) { a.desc = desc; a.setLabel(); } return a; }
  type = type || 'general-purpose';
  const [ex, ey] = ELEVATOR[actors.size % 2];
  a = new Actor(id, type, typeKo(type), ex, ey, desc);
  a.face = { dx: 1, dy: 0 };
  if (!replay) { a.alpha = 0; a.fade = 1; openElevator(1700); }
  actors.set(id, a);
  return a;
}

// ---------- 말풍선 내용 / 상태 ----------
export const fmtSec = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function bubbleFor(a, now) {
  const b = a.bubble;
  if (b && now < b.until) {
    if (b.kind === 'think') return { cls: 'think', html: `<b>${esc(b.text)}</b>${b.sub ? `<small>${esc(b.sub)}</small>` : ''}`, plain: b.text };
    let t = esc(b.text);
    if (b.frozen != null) t += ` <em>· ${fmtSec(b.frozen)} ✓</em>`;
    else if (b.live) t += ` <em>· ${fmtSec(now - b.since)}</em>`;
    return { cls: b.kind, html: t, plain: b.text };
  }
  if (a.thinkSince && now - a.thinkSince > 1200) {
    const s = fmtSec(now - a.thinkSince);
    return { cls: 'think', html: `<b>💭 고민 중 <span class="dots"><i></i><i></i><i></i></span></b><small>${s}째 고민 중</small>`, plain: '💭 고민 중…' };
  }
  return null;
}
export function statusOf(a, now) {
  const b = a.bubble && now < a.bubble.until ? a.bubble : null;
  if (a.leaving) return ['퇴근 중', 'bye'];
  if (a.reporting) return ['보고 중', 'report'];
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
export const isReplay = () => REPLAY;

export function direct(ev) {
  const R = REPLAY, ts = ev.ts || now();
  const a0 = ev.actor === 'main' ? claude : ev.actor === 'user' ? me : null;
  if (ev.kind === 'agent_spawn') {
    const a = agentActor(ev.actor, ev.agentType, ev.text, R);
    a.say('say', `🛗 출근했습니다!`, { until: ts + 3000 });
    a.thinkSince = ts; a.lastTs = ts;
    a.goTo(2, a.cell()[1], R);
    return;
  }
  if (ev.kind === 'agent_done') {
    const a = actors.get(ev.actor);
    if (!a) return;
    if (R) { a.remove(); return; }
    finishAgent(a, ev.text);
    return;
  }
  if (ev.kind === 'interrupt') {
    me.say('stop', '✋ 잠깐, 멈춰!', { until: ts + 3000 });
    if (!R) me.typingUntil = now() + 900;
    claude.path = []; claude.tools.clear(); claude.thinkSince = 0;
    claude.say('say', '😳 넵, 멈출게요!', { until: ts + 2500 });
    claude.idleSince = ts; claude.lastTs = ts;
    return;
  }
  if (ev.kind === 'user_say') {
    me.say('user', ev.text, { until: ts + sayDur(ev.text) });
    if (!R) me.typingUntil = now() + 2200;
    claude.thinkSince = ts; claude.idleSince = 0; claude.lastTs = ts;
    return;
  }
  if (ev.kind === 'answer') {
    me.say('user', `💬 ${ev.text}`, { until: ts + sayDur(ev.text) });
    if (!R) me.typingUntil = now() + 1200;
    return;
  }
  const a = a0 || agentActor(ev.actor, ev.agentType, '', R);
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
      if (a === claude && ev.room === 'desk') {
        if (ev.kind === 'question') { a.room = 'desk-ask'; a.goSpot(HOME.ask, R); }
        else goHome(a, R);
      } else a.goRoom(ev.room, R);
      a.say(ev.kind === 'question' ? 'question' : 'tool', ev.label, { since: ts, toolId: ev.toolId, live: ev.kind !== 'question' });
      if (ev.kind === 'question') me.faceTo(a.spot.x, a.spot.y);
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
      if (a === me) me.faceTo(HOME.me.fx, HOME.me.fy);
      break;
    }
    case 'error':
      a.say('error', ev.text, { until: ts + 4000 }); a.sweatUntil = (R ? ts : now()) + 2500;
      break;
    case 'turn_end':
      if (a === claude) { a.tools.clear(); a.thinkSince = 0; a.idleSince = ts; me.faceTo(HOME.me.fx, HOME.me.fy); }
      break;
  }
}

function finishAgent(a, report) {
  a.tools.clear(); a.thinkSince = 0; a.bubble = null; a.reporting = true;
  a.release(); a.room = null;
  a.script = [
    (x) => { // Claude 옆 빈칸으로
      const [cx, cy] = claude.cell();
      let best = null;
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [1, 1], [-1, 1], [0, 2], [2, 0], [-2, 0], [0, -1], [1, -1], [-1, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (walkable(nx, ny) && !actorsAt(nx, ny)) { best = [nx, ny]; break; }
      }
      best = best || [cx, cy + 1];
      x.claim({ x: best[0], y: best[1], fx: cx, fy: cy });
      x.goTo(best[0], best[1]); x.lookAt = [cx, cy];
    },
    (x, t) => {
      x.faceTo(...claude.cell());
      x.say('report', `📄 ${report || '맡긴 일 끝냈습니다!'}`, { until: now() + sayDur(report) });
      x.wait = t + sayDur(report);
      const cb = claude.bubble;
      if (!cb || cb.until < now() || /done/.test(cb.kind)) { claude.faceTo(...x.cell()); claude.say('say', '👍 수고했어요!', { until: now() + 2500 }); }
    },
    (x, t) => { x.reporting = false; x.leaving = true; x.say('bye', '👋 퇴근합니다!', { until: now() + 2200 }); x.wait = t + 1900; },
    (x) => { x.release(); const [ex, ey] = ELEVATOR[Math.random() < 0.5 ? 0 : 1]; x.goTo(ex, ey); x.lookAt = [ex - 1, ey]; },
    (x, t) => { openElevator(1500); x.face = { dx: -1, dy: 0 }; x.fade = -1; x.wait = t + 900; },
    (x) => x.remove(),
  ];
}
function actorsAt(x, y) { for (const a of actors.values()) { const [cx, cy] = a.cell(); if (cx === x && cy === y) return true; } return claims.has(x + ',' + y); }

export function afterReplay() {
  if (claude.idleSince && now() - claude.idleSince > 5000) { goHome(claude, true); claude.idleSince = 0; }
  for (const a of actors.values()) if (a.thinkSince && now() - a.thinkSince > 15 * 60000) a.thinkSince = 0;
}

// 매 프레임: 쉬는 Claude는 자리로
export function tickDirector(wall) {
  if (claude && claude.idleSince && wall - claude.idleSince > 5000 && !claude.walking() && !claude.tools.size) {
    claude.idleSince = 0;
    if (claude.room !== 'desk-home') goHome(claude);
  }
}
export { roomAt };
