// 에이전트 사무실 서버
// ~/.claude/projects/<프로젝트>/<세션ID>.jsonl 끝을 0.25초마다 들여다보고,
// 새 줄이 붙으면 "캐릭터가 할 일" 이벤트로 바꿔 브라우저(SSE)로 보낸다.
// 파일만 읽으므로 토큰은 전혀 쓰지 않는다. 의존성 없음 (Node 18+).

const http = require('http');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { StringDecoder } = require('string_decoder');
const { Classifier, clip } = require('./lib/classify');

const ROOT = path.resolve(process.env.CLAUDE_PROJECTS || path.join(os.homedir(), '.claude', 'projects'));
const PORT = Number(process.env.PORT) || 4777;
const USER = process.env.AGENTOFFICE_USER || (() => { try { return os.userInfo().username; } catch { return '나'; } })();
const PUBLIC = path.join(__dirname, 'public');
const POLL_MS = 250;
const TAIL_BYTES = 768 * 1024; // 접속 시 최근 상태를 복원하려고 읽는 양
const HISTORY = 120;

// ---------- 파일 끝 따라 읽기 ----------
class FileTail {
  constructor(file) { this.file = file; this.off = 0; this.buf = ''; this.dec = new StringDecoder('utf8'); }
  size() { try { return fs.statSync(this.file).size; } catch { return -1; } }
  // 끝에서 maxBytes 만큼 읽어 완전한 줄만 돌려주고, 이후부터 따라간다
  readTail(maxBytes) {
    const size = this.size();
    if (size < 0) return [];
    const start = Math.max(0, size - maxBytes);
    const lines = this._read(start, size - start);
    if (start > 0) lines.shift(); // 잘린 첫 줄 버림
    return lines;
  }
  poll() {
    const size = this.size();
    if (size < 0) return [];
    if (size < this.off) { this.off = 0; this.buf = ''; this.dec = new StringDecoder('utf8'); }
    if (size === this.off) return [];
    return this._read(this.off, Math.min(size - this.off, 16 << 20));
  }
  _read(pos, len) {
    const b = Buffer.alloc(len);
    const fd = fs.openSync(this.file, 'r');
    try { fs.readSync(fd, b, 0, len, pos); } finally { fs.closeSync(fd); }
    this.off = pos + len;
    const parts = (this.buf + this.dec.write(b)).split('\n');
    this.buf = parts.pop();
    return parts.filter((l) => l.trim());
  }
}

const parse = (l) => { try { return JSON.parse(l); } catch { return null; } };

// 파일 끝 4KB에서 마지막으로 보이는 줄 (ANSI 색 코드 제거, 진행바의 CR 줄바꿈 처리)
function lastLine(file) {
  try {
    const size = fs.statSync(file).size;
    if (!size) return '';
    const len = Math.min(size, 4096), b = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, b, 0, len, size - len); } finally { fs.closeSync(fd); }
    const lines = b.toString('utf8').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').split(/\r?\n|\r/).map((l) => l.trim()).filter(Boolean);
    return clip(lines[lines.length - 1] || '', 90);
  } catch { return ''; }
}

// ---------- 세션 하나를 지켜보는 감시자 (여러 브라우저가 공유) ----------
class SessionWatch {
  constructor(file) {
    this.file = file;
    this.id = path.basename(file, '.jsonl');
    this.subDir = path.join(path.dirname(file), this.id, 'subagents');
    this.clients = new Set();
    this.history = [];
    this.agents = new Map(); // agentId → state
    this.title = null;
    this.tail = new FileTail(file);
    this.cls = new Classifier('main');
    this.lastSubScan = 0;
    this.bgAgentTools = new Set(); // 백그라운드로 띄운 서브에이전트의 toolUseId
    this.bgJobs = new Map();       // 백그라운드 셸 작업: toolId → { file, taskId, last }
    this.lastBgRead = 0;
    this.boot();
    this.timer = setInterval(() => this.tick(), POLL_MS);
  }

  boot() {
    // 최근 기록으로 현재 상태 복원 (replay 이벤트)
    for (const l of this.tail.readTail(TAIL_BYTES)) this.onMain(parse(l), true);
    this.scanSubagents(true);
    this.title = this.cls.title;
    this.readBgOutputs(true);
  }

  push(e, replay) {
    if (replay) e.replay = true;
    this.history.push(e);
    if (this.history.length > HISTORY) this.history.splice(0, this.history.length - HISTORY);
    if (!replay) { this.broadcast(e); bus.emit('event', e, this); }
  }

  broadcast(e) {
    const data = `data: ${JSON.stringify(e)}\n\n`;
    for (const res of this.clients) res.write(data);
  }

  onMain(rec, replay) {
    if (!rec) return;
    if (rec.cwd) this.cwd = rec.cwd;
    for (const e of this.cls.classify(rec)) {
      this.trackBg(e);
      this.push(e, replay);
      // 메인이 받은 tool_result가 서브에이전트 호출 결과면 → 그 에이전트 퇴근 앞당김
      if (e.kind === 'tool_end') {
        for (const a of this.agents.values()) if (a.meta && a.meta.toolUseId === e.toolId) a.parentDone = Date.now();
      }
    }
  }

  trackBg(e) {
    if (e.kind === 'bg_start') {
      if (e.bgKind === 'agent') this.bgAgentTools.add(e.toolId);
      else this.bgJobs.set(e.toolId, { file: '', taskId: '', last: '', ts: e.ts });
    } else if (e.kind === 'bg_info') {
      const j = this.bgJobs.get(e.toolId);
      if (j) { j.file = e.outputFile; j.taskId = e.taskId; }
    } else if (e.kind === 'bg_end') {
      for (const [id, j] of this.bgJobs) if (id === e.toolId || (e.taskId && j.taskId === e.taskId)) this.bgJobs.delete(id);
      for (const a of this.agents.values()) if (a.meta && (a.meta.toolUseId === e.toolId || a.id === e.taskId)) a.parentDone = Date.now();
    }
  }

  // 돌고 있는 백그라운드 작업의 출력 파일에서 마지막 줄을 읽어 작업봇 말풍선으로 보낸다
  readBgOutputs(replay) {
    for (const [toolId, j] of this.bgJobs) {
      if (!j.file || Date.now() - j.ts > 12 * 3600000) continue;
      const line = lastLine(j.file);
      if (line && line !== j.last) { j.last = line; this.push({ actor: 'main', ts: Date.now(), kind: 'bg_progress', toolId, line }, replay); }
    }
  }

  scanSubagents(initial) {
    let names;
    try { names = fs.readdirSync(this.subDir); } catch { return; }
    for (const n of names) {
      const m = n.match(/^agent-(.+)\.jsonl$/);
      if (!m || this.agents.has(m[1])) continue;
      const file = path.join(this.subDir, n);
      let mtime = 0;
      try { mtime = fs.statSync(file).mtimeMs; } catch {}
      const a = {
        id: m[1], file, actor: 'agent:' + m[1], tail: new FileTail(file),
        cls: new Classifier('agent:' + m[1]), meta: null, seenAt: Date.now(),
        spawned: false, done: false, lastLineAt: Date.now(), endAt: 0, endText: '',
      };
      this.agents.set(a.id, a);
      if (initial && Date.now() - mtime > 120000) {
        a.done = true; a.spawned = true; a.tail.off = a.tail.size(); // 이미 끝난 옛 에이전트
        continue;
      }
      a.replayBoot = initial;
    }
  }

  readMeta(a) {
    if (a.meta) return true;
    try { a.meta = JSON.parse(fs.readFileSync(a.file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); return true; } catch { return false; }
  }

  tickAgent(a, now) {
    if (a.done) return;
    if (!a.spawned) {
      if (!this.readMeta(a) && now - a.seenAt < 1500) return; // meta.json 조금 기다려 줌
      a.spawned = true;
      const m = a.meta || {};
      const background = !!(m.toolUseId && this.bgAgentTools.has(m.toolUseId));
      this.push({ actor: a.actor, ts: now, kind: 'agent_spawn', agentType: m.agentType || 'general-purpose', text: clip(m.description || '', 60), background }, a.replayBoot);
      if (a.replayBoot) {
        for (const l of a.tail.readTail(TAIL_BYTES)) this.onAgentLine(a, parse(l), true, now);
        a.replayBoot = false;
        return;
      }
    }
    const lines = a.tail.poll();
    for (const l of lines) this.onAgentLine(a, parse(l), false, now);
    const la = a.cls.lastAssistant;
    const finalText = la && la.hasText && !la.hasTool && la.stop !== 'tool_use' && la.ts >= a.lastLineTs;
    const quiet = now - a.lastLineAt;
    if ((finalText && (quiet > (la.stop === 'end_turn' ? 1500 : 8000) || a.parentDone)) || quiet > 10 * 60000) {
      a.done = true;
      this.push({ actor: a.actor, ts: now, kind: 'agent_done', text: clip(finalText ? la.text : '', 140) });
    }
  }

  onAgentLine(a, rec, replay, now) {
    if (!rec) return;
    a.lastLineAt = now;
    a.lastLineTs = Date.parse(rec.timestamp) || 0;
    for (const e of a.cls.classify(rec)) {
      if (e.kind === 'user_say' || e.kind === 'session') continue; // 서브에이전트의 "user"는 Claude가 준 지시
      this.push(e, replay);
    }
  }

  tick() {
    const now = Date.now();
    for (const l of this.tail.poll()) this.onMain(parse(l), false);
    if (this.cls.title && this.cls.title !== this.title) this.title = this.cls.title;
    if (now - this.lastSubScan > 500) { this.lastSubScan = now; this.scanSubagents(false); }
    for (const a of this.agents.values()) this.tickAgent(a, now);
    if (this.bgJobs.size && now - this.lastBgRead > 1000) { this.lastBgRead = now; this.readBgOutputs(false); }
  }

  addClient(res) {
    this.clients.add(res);
    clearTimeout(this.idleTimer);
    res.write(`data: ${JSON.stringify({ kind: 'hello', session: rel(this.file), id: this.id, title: this.title, cwd: this.cwd || '', home: os.homedir(), user: USER })}\n\n`);
    res.write(`data: ${JSON.stringify({ kind: 'replay_begin' })}\n\n`);
    for (const e of this.history) res.write(`data: ${JSON.stringify(Object.assign({}, e, { replay: true }))}\n\n`);
    res.write(`data: ${JSON.stringify({ kind: 'replay_end' })}\n\n`);
  }

  removeClient(res) {
    this.clients.delete(res);
    if (!this.clients.size) this.idleTimer = setTimeout(() => this.close(), 30000);
  }

  close() { clearInterval(this.timer); watches.delete(this.file); }
}

const watches = new Map();
const bus = new EventEmitter(); // 앱(Electron)이 알림·트레이 상태용으로 구독
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

// ---------- 세션 목록 ----------
const titleCache = new Map();
function sessionInfo(file, st) {
  const c = titleCache.get(file);
  if (c && c.mtime === st.mtimeMs) return c.info;
  let title = '', cwd = '';
  try {
    const t = new FileTail(file);
    const lines = t.readTail(256 * 1024);
    for (let i = lines.length - 1; i >= 0 && (!title || !cwd); i--) {
      const l = lines[i];
      if (!title && /"(custom-title|ai-title)"/.test(l)) { const r = parse(l); if (r) title = r.customTitle || r.aiTitle || ''; }
      if (!title && /"last-prompt"/.test(l)) { const r = parse(l); if (r) title = clip(r.lastPrompt, 50); }
      if (!cwd) { const m = l.match(/"cwd":"((?:[^"\\]|\\.)*)"/); if (m) cwd = JSON.parse(`"${m[1]}"`); }
    }
  } catch {}
  const dir = path.basename(path.dirname(file));
  const info = {
    session: rel(file), id: path.basename(file, '.jsonl'),
    project: cwd ? path.basename(cwd) : dir, projectKey: dir, cwd,
    title: title || `제목 없는 세션 · ${path.basename(file, '.jsonl').slice(0, 8)}`,
    mtime: st.mtimeMs, size: st.size,
  };
  titleCache.set(file, { mtime: st.mtimeMs, info });
  return info;
}

function listSessions(limit = 40) {
  const all = [];
  let dirs = [];
  try { dirs = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch {}
  for (const d of dirs) {
    const pdir = path.join(ROOT, d.name);
    let files = [];
    try { files = fs.readdirSync(pdir).filter((f) => f.endsWith('.jsonl')); } catch {}
    for (const f of files) {
      const file = path.join(pdir, f);
      try { const st = fs.statSync(file); all.push({ file, st }); } catch {}
    }
  }
  all.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  return all.slice(0, limit).map(({ file, st }) => sessionInfo(file, st));
}

// 프로젝트 = 층. 프로젝트마다 세션 목록을 묶어 준다
function listFloors(perFloor = 30) {
  const floors = [];
  let dirs = [];
  try { dirs = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch {}
  for (const d of dirs) {
    const pdir = path.join(ROOT, d.name);
    const files = [];
    try {
      for (const f of fs.readdirSync(pdir)) {
        if (!f.endsWith('.jsonl')) continue;
        try { const st = fs.statSync(path.join(pdir, f)); if (st.size > 0) files.push({ file: path.join(pdir, f), st }); } catch {}
      }
    } catch {}
    if (!files.length) continue;
    files.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    const sessions = files.slice(0, perFloor).map(({ file, st }) => sessionInfo(file, st));
    const cwd = (sessions.find((x) => x.cwd) || {}).cwd || '';
    floors.push({ key: d.name, name: cwd ? path.basename(cwd) : d.name, cwd, count: files.length, mtime: files[0].st.mtimeMs, sessions });
  }
  floors.sort((a, b) => b.mtime - a.mtime);
  return floors;
}

function resolveSession(key) {
  if (!key || key === 'auto') { const s = listSessions(1)[0]; return s ? path.join(ROOT, s.session) : null; }
  const file = path.resolve(ROOT, key);
  if (!file.startsWith(ROOT + path.sep) || !file.endsWith('.jsonl') || !fs.existsSync(file)) return null;
  return file;
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ root: ROOT, sessions: listSessions() }));
  }
  if (url.pathname === '/api/floors') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ now: Date.now(), user: USER, home: os.homedir(), floors: listFloors() }));
  }
  if (url.pathname === '/events') {
    const file = resolveSession(url.searchParams.get('session'));
    if (!file) { res.writeHead(404); return res.end('session not found'); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    let w = watches.get(file);
    if (!w) { w = new SessionWatch(file); watches.set(file, w); }
    w.addClient(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); w.removeClient(res); });
    return;
  }
  const p = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!p.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

// port 0 이면 비어 있는 포트를 OS가 골라 준다
function start(port = PORT) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      console.log(`🏢 에이전트 사무실 → http://localhost:${p}`);
      console.log(`   지켜보는 폴더: ${ROOT}`);
      resolve({ port: p, url: `http://127.0.0.1:${p}` });
    });
  });
}

// ---------- 알림용: 최근에 움직인 모든 세션을 가볍게 따라 읽기 ----------
// 창에 띄운 세션과 상관없이, 어느 프로젝트에서든 Claude가 질문하거나 일을 마치면 앱이 알 수 있게 한다.
class GlobalWatch {
  constructor() {
    this.files = new Map(); // file → { tail, cls, cwd }
    this.first = true; this.lastScan = 0;
    this.timer = setInterval(() => this.tick(), POLL_MS);
  }
  scan(now) {
    let dirs = [];
    try { dirs = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch {}
    for (const d of dirs) {
      let names = [];
      try { names = fs.readdirSync(path.join(ROOT, d.name)).filter((f) => f.endsWith('.jsonl')); } catch {}
      for (const n of names) {
        const file = path.join(ROOT, d.name, n);
        let st; try { st = fs.statSync(file); } catch { continue; }
        if (this.files.has(file)) { if (now - st.mtimeMs > 30 * 60000) this.files.delete(file); continue; }
        if (now - st.mtimeMs > 10 * 60000) continue;
        const tail = new FileTail(file);
        // 앱이 켜질 때 이미 있던 기록은 건너뛰고, 그 뒤에 생긴 새 세션은 처음부터 읽는다
        tail.off = this.first ? st.size : 0;
        this.files.set(file, { tail, cls: new Classifier('main'), cwd: '' });
      }
    }
    this.first = false;
  }
  tick() {
    const now = Date.now();
    if (now - this.lastScan > 2000) { this.lastScan = now; this.scan(now); }
    for (const [file, t] of this.files) {
      for (const l of t.tail.poll()) {
        const rec = parse(l);
        if (!rec) continue;
        if (rec.cwd) t.cwd = rec.cwd;
        const src = { file, cwd: t.cwd, project: t.cwd ? path.basename(t.cwd) : path.basename(path.dirname(file)), viewed: isViewed(file) };
        for (const e of t.cls.classify(rec)) bus.emit('global', e, src);
      }
    }
  }
}
let globalWatch = null;
function watchAll() { if (!globalWatch) globalWatch = new GlobalWatch(); }
// 지금 창(브라우저)에 띄워져 있는 세션인지
function isViewed(file) { const w = watches.get(file); return !!(w && w.clients.size); }

module.exports = { start, bus, ROOT, watchAll };
if (require.main === module) start();
