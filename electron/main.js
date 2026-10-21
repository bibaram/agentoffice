// 에이전트 사무실 데스크톱 앱 (Electron)
// - 앱 안에서 server.js를 그대로 띄우고 창은 그 화면을 연다
// - 트레이 아이콘: Claude가 일하면 초록 점, 질문하면 노란 점
// - 알림: 질문할 때 / 답을 마쳤을 때 / 서브에이전트 퇴근
// - 미니 모드: 작은 창을 항상 위에
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { start, bus, watchAll } = require('../server');

const APP_NAME = '에이전트 사무실';
const PREFERRED_PORT = 47770; // 고정 포트여야 창의 저장값(localStorage)이 유지된다
const asset = (f) => path.join(__dirname, 'assets', f);
const START_HIDDEN = process.argv.includes('--hidden'); // 로그인 시 자동 실행이면 트레이로만

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('com.agentoffice.app'); // Windows 알림에 필요

// ---------- 설정 ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { notifyAsk: true, notifyDone: true, notifyAgent: true, mini: false, bounds: null, trayHintShown: false };
function loadSettings() { try { Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); } catch {} }
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch {} }, 300);
}

let win = null, tray = null, url = null, quitting = false;

// ---------- 창 ----------
function createWindow() {
  const b = settings.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1440, height: b.height || 880, x: b.x, y: b.y,
    minWidth: 480, minHeight: 320,
    title: APP_NAME, icon: asset('icon.png'), backgroundColor: '#eef1f5',
    autoHideMenuBar: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.removeMenu();
  win.loadURL(url);
  win.once('ready-to-show', () => { if (!START_HIDDEN) win.show(); if (settings.mini) setMini(true); });
  win.webContents.on('did-finish-load', () => applyMiniClass());
  win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });
  const remember = () => { if (!settings.mini && !win.isMaximized() && !win.isMinimized()) { settings.bounds = win.getBounds(); saveSettings(); } };
  win.on('resize', remember); win.on('move', remember);
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); win.hide(); // 닫아도 트레이에서 계속 지켜봄
    if (!settings.trayHintShown) {
      settings.trayHintShown = true; saveSettings();
      notify('트레이에서 계속 실행 중', 'Claude가 질문하거나 일을 마치면 알려 드릴게요. 종료는 트레이 아이콘 메뉴에서.');
    }
  });
}
function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

// ---------- 미니 모드 (항상 위) ----------
let normalBounds = null;
function applyMiniClass() {
  if (!win) return;
  win.webContents.executeJavaScript(`document.body.classList.toggle('mini', ${settings.mini}); window.dispatchEvent(new Event('resize'));`).catch(() => {});
}
function setMini(on) {
  settings.mini = on; saveSettings();
  if (!win) return;
  if (on) {
    normalBounds = win.isMaximized() ? null : win.getBounds();
    if (win.isMaximized()) win.unmaximize();
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const w = 560, h = 380;
    win.setBounds({ x: wa.x + wa.width - w - 16, y: wa.y + wa.height - h - 16, width: w, height: h });
    win.setAlwaysOnTop(true, 'floating');
  } else {
    win.setAlwaysOnTop(false);
    const b = normalBounds || settings.bounds;
    if (b) win.setBounds(b); else win.setSize(1440, 880);
  }
  applyMiniClass();
  buildMenu();
}

// ---------- 트레이 ----------
// 세션마다 상태를 따로 들고, 트레이는 그중 가장 급한 것(질문 > 작업 > 쉼)을 보여 준다
const sessions = new Map(); // file → { mode, turnStart, lastSay, askToolId, project }
let trayMode = 'idle';
const TRAY_ICON = { idle: 'tray', busy: 'tray-busy', ask: 'tray-ask' };
const MODE_TEXT = { idle: '쉬는 중', busy: '작업 중', ask: '질문 중' };
function trayImage(mode) {
  const img = nativeImage.createFromPath(asset(TRAY_ICON[mode] + '.png'));
  const hi = asset(TRAY_ICON[mode] + '@2x.png');
  if (fs.existsSync(hi)) img.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(hi) });
  return img;
}
function refreshTray() {
  const list = [...sessions.values()];
  const mode = list.some((s) => s.mode === 'ask') ? 'ask' : list.some((s) => s.mode === 'busy') ? 'busy' : 'idle';
  if (!tray) return;
  if (mode !== trayMode) { trayMode = mode; tray.setImage(trayImage(mode)); }
  const lines = list.filter((s) => s.mode !== 'idle').map((s) => `· ${s.project}: ${MODE_TEXT[s.mode]}`);
  tray.setToolTip(lines.length ? `${APP_NAME}\n${lines.join('\n')}` : `${APP_NAME} — Claude 쉬는 중`);
}
// turnStart: 쉬다가 일을 시작한 시각 (질문 ↔ 작업 사이를 오가도 유지)
function setMode(s, mode) { if (s.mode === mode) return; if (s.mode === 'idle') s.turnStart = Date.now(); s.mode = mode; refreshTray(); }

function buildMenu() {
  if (!tray) return;
  const login = app.getLoginItemSettings().openAtLogin;
  const toggle = (key) => (item) => { settings[key] = item.checked; saveSettings(); };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '열기', click: showWindow },
    { label: '미니 모드 (항상 위에)', type: 'checkbox', checked: settings.mini, click: (i) => { showWindow(); setMini(i.checked); } },
    { type: 'separator' },
    { label: '알림', submenu: [
      { label: 'Claude가 질문할 때', type: 'checkbox', checked: settings.notifyAsk, click: toggle('notifyAsk') },
      { label: 'Claude가 답을 마쳤을 때', type: 'checkbox', checked: settings.notifyDone, click: toggle('notifyDone') },
      { label: '서브에이전트 일 끝남', type: 'checkbox', checked: settings.notifyAgent, click: toggle('notifyAgent') },
      { type: 'separator' },
      { label: '알림 테스트 보내기', click: () => notify('🔔 알림 테스트', '이 알림이 보이면 정상입니다. Claude가 질문하거나 일을 마치면 이렇게 알려 드려요.') },
    ] },
    { label: 'Windows 시작 시 자동 실행', type: 'checkbox', checked: login, visible: process.platform !== 'linux',
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--hidden'] }) },
    { label: '브라우저에서 열기', click: () => shell.openExternal(url) },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]));
}
function createTray() {
  tray = new Tray(trayImage('idle'));
  tray.setToolTip(APP_NAME);
  tray.on('click', () => (win && win.isVisible() && win.isFocused() ? win.hide() : showWindow()));
  buildMenu();
}

// ---------- 알림 ----------
const logFile = () => path.join(app.getPath('userData'), 'agentoffice.log');
function log(...a) { try { fs.appendFileSync(logFile(), `[${new Date().toISOString()}] ${a.join(' ')}\n`); } catch {} }
const live = new Set(); // Windows에선 알림 객체가 GC되면 토스트가 사라질 수 있어 닫힐 때까지 붙잡아 둔다
function notify(title, body) {
  if (!Notification.isSupported()) { log('notify: not supported'); return; }
  const n = new Notification({ title, body: String(body || '').slice(0, 180), icon: asset('icon.png') });
  live.add(n);
  const drop = () => setTimeout(() => live.delete(n), 60000);
  n.on('click', () => { showWindow(); drop(); });
  n.on('close', drop);
  n.on('failed', (_e, err) => { log('notify failed:', title, err); drop(); });
  n.on('show', () => log('notify shown:', title));
  n.show();
}
// 창을 보고 있고, 그 창에 띄운 세션이라면 굳이 알리지 않는다
const userLooking = (src) => win && win.isVisible() && win.isFocused() && !win.isMinimized() && src.viewed;

bus.on('global', (e, src) => {
  let s = sessions.get(src.file);
  if (!s) { s = { mode: 'idle', turnStart: Date.now(), lastSay: '', askToolId: null, project: src.project }; sessions.set(src.file, s); }
  s.project = src.project || s.project;
  const where = s.project ? `[${s.project}] ` : '';
  switch (e.kind) {
    case 'user_say': s.lastSay = ''; setMode(s, 'busy'); break;
    case 'think': case 'tool_start': if (s.mode !== 'ask') setMode(s, 'busy'); break;
    case 'say': s.lastSay = e.text; if (s.mode !== 'ask') setMode(s, 'busy'); break;
    case 'question':
      s.askToolId = e.toolId; setMode(s, 'ask');
      if (settings.notifyAsk && !userLooking(src)) notify('❓ Claude가 질문이 있어요', where + String(e.label || '').replace(/^❓\s*/, ''));
      break;
    case 'tool_end':
      if (e.toolId === s.askToolId) { s.askToolId = null; setMode(s, 'busy'); }
      // 서브에이전트(Agent 도구)가 결과를 돌려줌. 백그라운드 실행 접수 응답은 제외
      if (e.agentDesc != null && e.ok && !/async|background|launched|running in the background/i.test(e.text || '') && settings.notifyAgent && !userLooking(src)) {
        notify('👋 서브에이전트 일 끝남', where + (e.agentDesc ? `${e.agentDesc} — ` : '') + (e.text || '맡긴 일을 끝냈어요.'));
      }
      break;
    case 'interrupt': s.askToolId = null; setMode(s, 'idle'); break;
    case 'turn_end': {
      if (s.mode === 'idle') break; // stop_hook 과 end_turn 이 둘 다 오므로 한 번만
      const worked = Date.now() - s.turnStart;
      setMode(s, 'idle');
      if (settings.notifyDone && !userLooking(src) && worked > 10000) notify('✅ Claude가 답을 마쳤어요', where + (s.lastSay || '작업이 끝났습니다.'));
      break;
    }
  }
});

// ---------- 시작 ----------
app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', (e) => e.preventDefault()); // 트레이에 남는다
app.on('activate', showWindow); // mac 독 아이콘 클릭

app.whenReady().then(async () => {
  loadSettings();
  let r;
  try { r = await start(PREFERRED_PORT); } catch { r = await start(0); }
  url = r.url;
  watchAll(); // 모든 프로젝트의 최근 세션을 알림용으로 지켜봄
  log('started', url, 'notifications supported:', Notification.isSupported());
  createTray();
  createWindow();
});
