// 메인: 렌더 루프, 카메라(이동·확대), 층별 안내, 사람들·활동 로그, 서버 연결
import { iso, setCtx } from './iso.js';
import { W, H, WALLH, FURN, ROOMS, drawFloor, drawBackWalls, staticItems, elevator, roomAt } from './world.js';
import { actors, claude, me, drawActor, resetCast, renameMe, direct, setReplay, afterReplay, tickDirector, bubbleFor, statusOf, typeKo, fmtSec } from './actors.js';

const $ = (id) => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
setCtx(ctx);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ======================================================================
// 카메라
// ======================================================================
const B = { minX: iso(0, H)[0], maxX: iso(W, 0)[0], minY: -WALLH - 30, maxY: iso(W, H)[1] + 26 };
const WC = { x: (B.minX + B.maxX) / 2, y: (B.minY + B.maxY) / 2 };
const cam = { zoom: 1, px: 0, py: 0 }, camGoal = { zoom: 1, px: 0, py: 0, on: false };
let view = { s: 1, ox: 0, oy: 0, base: 1 };

function computeView() {
  const cw = cv.clientWidth, ch = cv.clientHeight;
  const base = Math.min((cw - 30) / (B.maxX - B.minX), (ch - 40) / (B.maxY - B.minY));
  const s = base * cam.zoom;
  view = { s, base, ox: cw / 2 + cam.px - WC.x * s, oy: ch / 2 + 10 + cam.py - WC.y * s, cw, ch };
}
function zoomAt(mx, my, factor) {
  camGoal.on = false;
  const z = Math.max(0.6, Math.min(4, cam.zoom * factor));
  const wx = (mx - view.ox) / view.s, wy = (my - view.oy) / view.s;
  const s2 = view.base * z;
  cam.px = mx - wx * s2 - view.cw / 2 + WC.x * s2;
  cam.py = my - wy * s2 - view.ch / 2 - 10 + WC.y * s2;
  cam.zoom = z;
}
function resetCam() { Object.assign(camGoal, { zoom: 1, px: 0, py: 0, on: true }); }
function focusActor(a) {
  const z = Math.max(cam.zoom, 1.8), s = view.base * z;
  const [wx, wy] = iso(a.x, a.y, 30);
  Object.assign(camGoal, { zoom: z, px: (WC.x - wx) * s, py: (WC.y - wy) * s - 10, on: true });
}
let drag = null;
cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; camGoal.on = false; cv.setPointerCapture(e.pointerId); cv.classList.add('grab'); });
cv.addEventListener('pointermove', (e) => { if (!drag) return; cam.px += e.clientX - drag.x; cam.py += e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; });
cv.addEventListener('pointerup', () => { drag = null; cv.classList.remove('grab'); });
cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
cv.addEventListener('dblclick', resetCam);
$('zoomIn').onclick = () => zoomAt(view.cw / 2, view.ch / 2, 1.25);
$('zoomOut').onclick = () => zoomAt(view.cw / 2, view.ch / 2, 0.8);
$('zoomReset').onclick = resetCam;

// ======================================================================
// 시뮬레이션 (타이머로 돌려서 탭이 가려져도 진행)
// ======================================================================
let lastSim = performance.now();
function simulate() {
  const pt = performance.now();
  const elapsed = Math.min(5, (pt - lastSim) / 1000); lastSim = pt;
  const wall = Date.now();
  let left = elapsed;
  while (left > 0) { const dt = Math.min(0.05, left); left -= dt; for (const a of [...actors.values()]) a.update(dt, wall); }
  tickDirector(wall);
  elevator.open += ((pt < elevator.until ? 1 : 0) - elevator.open) * Math.min(1, elapsed * 6);
  if (camGoal.on) {
    const k = Math.min(1, elapsed * 6);
    cam.zoom += (camGoal.zoom - cam.zoom) * k; cam.px += (camGoal.px - cam.px) * k; cam.py += (camGoal.py - cam.py) * k;
    if (Math.abs(camGoal.px - cam.px) + Math.abs(camGoal.py - cam.py) < 0.5 && Math.abs(camGoal.zoom - cam.zoom) < 0.002) camGoal.on = false;
  }
}
setInterval(simulate, 33);

// ======================================================================
// 렌더
// ======================================================================
function frame(pt) {
  simulate();
  const t = pt / 1000, wall = Date.now();
  const dpr = window.devicePixelRatio || 1;
  const cw = cv.clientWidth, ch = cv.clientHeight;
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
  computeView();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.ox, dpr * view.oy);

  const active = new Set(), busy = new Set();
  for (const a of actors.values()) {
    if (a.walking()) continue;
    const working = a.tools.size || a.thinkSince;
    if (working && a.kind !== 'me') active.add(roomAt(...a.cell()));
    if (a.spot && (a.tools.size || wall < a.typingUntil)) busy.add(a.spot.fx + ',' + a.spot.fy);
  }
  for (const o of FURN) o.busy = busy.has(o.x + ',' + o.y) || (o.t === 'rack' && active.has('server')) || (o.t === 'kiosk' && active.has('search'));

  drawFloor(t, active);
  drawBackWalls(t, active);
  const items = staticItems().slice();
  for (const a of actors.values()) items.push({ k: a.x + a.y + 0.03, draw: () => drawActor(a, t, wall) });
  items.sort((p, q) => p.k - q.k);
  for (const it of items) it.draw(t);

  layoutOverlay(wall);
  requestAnimationFrame(frame);
}

// 말풍선·이름표를 캐릭터 머리 위에
function layoutOverlay(now) {
  const placed = [];
  const list = [...actors.values()].map((a) => {
    const [wx, wy] = iso(a.x, a.y, a.seated() ? 44 : 48);
    return { a, sx: view.ox + wx * view.s, sy: view.oy + wy * view.s };
  }).sort((p, q) => q.sy - p.sy);
  for (const { a, sx, sy } of list) {
    const tagY = sy - (a.kind === 'claude' ? 14 : 2) * view.s;
    a.tag.style.transform = `translate(${sx.toFixed(1)}px, ${tagY.toFixed(1)}px) translate(-50%,-100%)`;
    a.tag.style.opacity = a.alpha;
    const bb = bubbleFor(a, now);
    if (!bb) { a.el.style.opacity = 0; continue; }
    const cls = 'bubble ' + bb.cls;
    if (a._cls !== cls) { a.el.className = cls; a._cls = cls; }
    if (a._html !== bb.html) { a.el.innerHTML = bb.html; a._html = bb.html; }
    let by = tagY - 24;
    const w = a.el.offsetWidth, h = a.el.offsetHeight;
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      if (Math.abs(p.x - sx) < (p.w + w) / 2 + 4 && by > p.y - p.h - 4 && by - h < p.y + 4) { by = p.y - p.h - 8; i = -1; }
    }
    placed.push({ x: sx, y: by, w, h });
    a.el.style.transform = `translate(${sx.toFixed(1)}px, ${by.toFixed(1)}px) translate(-50%,-100%)`;
    a.el.style.opacity = a.alpha;
  }
}

// ======================================================================
// 사람들 패널 · 활동 로그
// ======================================================================
const people = $('people');
function renderPeople() {
  const now = Date.now();
  const list = [...actors.values()].filter((a) => a.kind !== 'me');
  $('peopleCount').textContent = `${list.length}명 근무 중`;
  const html = list.map((a) => {
    const [st, cls] = statusOf(a, now);
    const bb = bubbleFor(a, now);
    const title = a.kind === 'claude' ? 'Claude' : (a.desc || typeKo(a.kind));
    const sub = a.kind === 'claude' ? 'Claude' : typeKo(a.kind);
    const av = a.kind === 'claude' ? '✳' : typeKo(a.kind).slice(0, 1);
    return `<div class="person" data-id="${esc(a.id)}">
      <div class="av" style="background:${a.st.dot}">${esc(av)}</div>
      <div class="pm"><div class="pt"><b title="${esc(title)}">${esc(title)}</b><span class="ty">${esc(sub)}</span><span class="pill ${cls}">${st}</span></div>
      <div class="pa">${esc(bb ? bb.plain : '—')}</div>
      <div class="ps">도구 ${a.toolCount}회 · ${fmtSec(now - a.lastTs)}</div></div></div>`;
  }).join('');
  if (people._html !== html) { people.innerHTML = html; people._html = html; }
}
people.addEventListener('click', (e) => { const p = e.target.closest('.person'); if (p) { const a = actors.get(p.dataset.id); if (a) focusActor(a); } });
setInterval(renderPeople, 400);

const log = $('log');
let userName = '나';
const ICON = { user_say: '👤', interrupt: '✋', say: '💬', think: '💭', answer: '💬', agent_spawn: '🛗', agent_done: '👋', error: '⚠️', turn_end: '✅' };
function whoOf(ev) {
  if (ev.actor === 'user' || ev.kind === 'interrupt' || ev.kind === 'answer') return userName;
  if (ev.actor === 'main') return 'Claude';
  const a = actors.get(ev.actor);
  return (a && (a.desc || typeKo(a.kind))) || (ev.kind === 'agent_spawn' && ev.text) || typeKo(ev.agentType);
}
function addLog(ev, who) {
  let txt = null, cls = '';
  switch (ev.kind) {
    case 'user_say': txt = ev.text; break;
    case 'interrupt': txt = '잠깐, 멈춰! (Esc)'; cls = 'stop'; break;
    case 'say': txt = ev.text; break;
    case 'think': txt = `${fmtSec(ev.dur || 0)} 고민`; break;
    case 'tool_start': case 'question': txt = ev.label; break;
    case 'tool_end': if (!ev.ok) { txt = `❌ ${ev.tool || ''} 실패 ${ev.text || ''}`; cls = 'err'; } break;
    case 'answer': txt = `답변: ${ev.text}`; break;
    case 'agent_spawn': txt = `${typeKo(ev.agentType)} 출근 — ${ev.text || ''}`; break;
    case 'agent_done': txt = `퇴근 — ${ev.text || ''}`; break;
    case 'error': txt = ev.text; cls = 'err'; break;
    case 'turn_end': if (ev.actor === 'main') txt = '턴 끝'; break;
  }
  if (!txt) return;
  const icon = ICON[ev.kind] ? ICON[ev.kind] + ' ' : '';
  const d = new Date(ev.ts || Date.now());
  const li = document.createElement('li');
  if (cls) li.className = cls;
  li.innerHTML = `<time>${d.getHours()}시 ${d.getMinutes()}분 ${d.getSeconds()}초</time><b title="${esc(who)}">${esc(who)}</b><span>${esc(icon + txt)}</span>`;
  log.prepend(li);
  while (log.children.length > 120) log.lastChild.remove();
}

// ======================================================================
// 층별 안내 · 세션 선택 · 연결
// ======================================================================
const FLOOR_COLORS = [['#fde2e4', '#d6455d'], ['#fde8cf', '#e07a1f'], ['#e2f0d9', '#4a8f3a'], ['#dfe8fb', '#3c64c8'], ['#ece1fb', '#7d4fc9'], ['#d8f1ef', '#2c8f86']];
let floors = [], showAllFloors = false, current = null, es = null, info = {};
let sel = { floor: null, session: null, follow: true };
try { Object.assign(sel, JSON.parse(localStorage.getItem('agentoffice.sel') || '{}')); } catch {}
const saveSel = () => { try { localStorage.setItem('agentoffice.sel', JSON.stringify(sel)); } catch {} };
const ACTIVE_MS = 90 * 1000;
function ago(ms) { const s = (Date.now() - ms) / 1000; return s < 60 ? '방금' : s < 3600 ? `${Math.floor(s / 60)}분 전` : s < 86400 ? `${Math.floor(s / 3600)}시간 전` : `${Math.floor(s / 86400)}일 전`; }
const hashStr = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

function floorNumbering(list) { const n = list.length; return new Map(list.map((f, i) => [f.key, n - i])); }

function renderFloors() {
  const recent = floors.slice(0, 4);
  const cur = floors.find((f) => f.key === sel.floor);
  if (cur && !recent.includes(cur)) recent.push(cur);
  const shown = showAllFloors ? floors : recent;
  const nums = floorNumbering(shown);
  const now = Date.now();
  const html = shown.map((f) => {
    const [bg, fg] = FLOOR_COLORS[hashStr(f.key) % FLOOR_COLORS.length];
    const live = now - f.mtime < ACTIVE_MS;
    const open = f.key === sel.floor;
    let body = '';
    if (open) {
      body = `<div class="fbody"><label class="follow"><input type="checkbox" ${sel.follow ? 'checked' : ''} data-follow> 🔄 최근 세션 자동으로 따라가기</label><div class="slist">` +
        f.sessions.map((s) => {
          const isCur = s.session === current;
          const act = now - s.mtime < ACTIVE_MS;
          return `<div class="sitem ${isCur ? 'cur' : ''}" data-session="${esc(s.session)}" title="${esc(s.title)}"><span class="st">${isCur ? '📌 ' : ''}${esc(s.title)}</span><span class="sa ${act ? 'on' : ''}">${act && isCur ? '지금 활동 중' : act ? '활동 중' : ago(s.mtime)}</span></div>`;
        }).join('') + '</div></div>';
    }
    return `<div class="floor ${open ? 'open' : ''}" data-floor="${esc(f.key)}">
      <div class="fhead2"><span class="fno" style="background:${bg};color:${fg}">${nums.get(f.key)}F</span>
      <div class="fm"><b title="${esc(f.cwd)}">${esc(f.name)}</b><small>세션 ${f.count}개 · ${live ? '지금 활동 중' : ago(f.mtime)}</small></div>
      <span class="fdot ${live ? 'on' : ''}"></span></div>${body}</div>`;
  }).join('');
  const el = $('floorList');
  if (el._html !== html) {
    const sl = el.querySelector('.slist'); const scroll = sl ? sl.scrollTop : 0;
    el.innerHTML = html; el._html = html;
    const sl2 = el.querySelector('.slist'); if (sl2) sl2.scrollTop = scroll;
  }
  const rest = floors.length - recent.length;
  $('moreFloors').textContent = showAllFloors ? '최근 층만 보기' : `오래 쉰 층 ${rest}개 더 보기`;
  $('moreFloors').style.display = rest > 0 || showAllFloors ? '' : 'none';
  // 무대 위 카드
  if (cur) {
    const [bg, fg] = FLOOR_COLORS[hashStr(cur.key) % FLOOR_COLORS.length];
    const fno = $('cardFloor'); fno.textContent = `${nums.get(cur.key) || ''}F`; fno.style.background = fg;
    $('cardProject').textContent = cur.name;
    const s = cur.sessions.find((x) => x.session === current);
    if (s && !info.title) $('cardTitle').textContent = s.title;
  }
}

$('floorList').addEventListener('click', (e) => {
  if (e.target.closest('[data-follow]')) { sel.follow = e.target.checked; if (sel.follow) sel.session = null; saveSel(); refreshFloors(); return; }
  const si = e.target.closest('.sitem');
  if (si) { sel.session = si.dataset.session; sel.follow = false; saveSel(); connect(sel.session); renderFloors(); return; }
  const fl = e.target.closest('.floor');
  if (fl && e.target.closest('.fhead2')) {
    if (sel.floor === fl.dataset.floor) return;
    sel = { floor: fl.dataset.floor, session: null, follow: true }; saveSel(); refreshFloors();
  }
});
$('moreFloors').onclick = () => { showAllFloors = !showAllFloors; renderFloors(); };

async function refreshFloors() {
  try { const j = await (await fetch('/api/floors')).json(); floors = j.floors || []; if (j.user) { userName = j.user; } } catch { return; }
  if (!floors.length) { renderFloors(); return; }
  let f = floors.find((x) => x.key === sel.floor);
  if (!f) { f = floors[0]; sel = { floor: f.key, session: null, follow: true }; saveSel(); }
  let target;
  if (sel.follow) {
    target = f.sessions[0].session;
    const cur = f.sessions.find((s) => s.session === current);
    // 지금 보는 세션이 아직 살아 있으면 성급히 갈아타지 않음
    if (cur && target !== current && f.sessions[0].mtime - cur.mtime < 15000) target = current;
  } else target = sel.session && f.sessions.some((s) => s.session === sel.session) ? sel.session : f.sessions[0].session;
  if (target !== current) connect(target);
  renderFloors();
}

function connect(key) {
  if (es) es.close();
  resetCast(userName);
  log.innerHTML = ''; info = {};
  current = key;
  $('cardTitle').textContent = '';
  setLive(false, '연결 중');
  es = new EventSource('/events?session=' + encodeURIComponent(key));
  es.onopen = () => setLive(true);
  es.onerror = () => setLive(false, '재연결 중');
  es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch (err) { console.error(err); } };
}
function setLive(on, txt) { const l = $('live'); l.className = 'live ' + (on ? 'on' : 'off'); l.textContent = on ? '● LIVE' : '● ' + txt; }

function onEvent(ev) {
  switch (ev.kind) {
    case 'hello': {
      info = ev; if (ev.user) { userName = ev.user; renameMe(ev.user); }
      const p = ev.cwd && ev.home && ev.cwd.toLowerCase().startsWith(ev.home.toLowerCase()) ? '~' + ev.cwd.slice(ev.home.length).replace(/\\/g, '/') : (ev.cwd || '').replace(/\\/g, '/');
      $('projPath').textContent = p || '—'; $('projPath').title = ev.cwd || '';
      $('sessId').textContent = (ev.id || '').slice(0, 8);
      if (ev.title) $('cardTitle').textContent = ev.title;
      return;
    }
    case 'session': info.title = ev.title; $('cardTitle').textContent = ev.title; return;
    case 'replay_begin': setReplay(true); return;
    case 'replay_end': setReplay(false); afterReplay(); return;
  }
  const who = whoOf(ev);
  direct(ev);
  addLog(ev, who);
}

// ======================================================================
// 양쪽 패널 접기 (좁은 화면에선 층별 안내가 기본으로 접힘)
// ======================================================================
const narrow = window.matchMedia('(max-width: 900px)');
let panels = { floors: true, side: true };
try { Object.assign(panels, JSON.parse(localStorage.getItem('agentoffice.panels') || '{}')); } catch {}
let floorsOpenNarrow = false;
function applyPanels() {
  const b = document.body.classList;
  const floorsShown = narrow.matches ? floorsOpenNarrow : panels.floors;
  b.toggle('no-floors', !narrow.matches && !panels.floors);
  b.toggle('show-floors', narrow.matches && floorsOpenNarrow);
  b.toggle('no-side', !panels.side);
  $('toggleFloors').textContent = floorsShown ? '◀ 층별 안내' : '▶ 층별 안내';
  $('toggleSide').textContent = panels.side ? '사람들 · 로그 ▶' : '◀ 사람들 · 로그';
}
$('toggleFloors').onclick = () => {
  if (narrow.matches) floorsOpenNarrow = !floorsOpenNarrow; else panels.floors = !panels.floors;
  try { localStorage.setItem('agentoffice.panels', JSON.stringify(panels)); } catch {}
  applyPanels();
};
$('toggleSide').onclick = () => {
  panels.side = !panels.side;
  try { localStorage.setItem('agentoffice.panels', JSON.stringify(panels)); } catch {}
  applyPanels();
};
narrow.addEventListener('change', applyPanels);
applyPanels();

resetCast(userName);
window.__office = { actors, cam, focusActor };
requestAnimationFrame(frame);
refreshFloors();
setInterval(refreshFloors, 5000);
