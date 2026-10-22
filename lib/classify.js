// 세션 jsonl 한 줄(레코드) → "캐릭터가 할 일" 이벤트로 바꾸는 분류기.
// AI 호출 없음. 순수하게 JSON 필드만 보고 판단한다.

const ROOM = {
  ARCHIVE: 'archive', // 자료실   Read · Grep · Glob · rg/cat
  DEV: 'dev',         // 개발실   Edit · Write · sed -i
  SERVER: 'server',   // 서버실   Bash (빌드·실행)
  SEARCH: 'search',   // 정보검색실 WebSearch · MCP · curl
  MEETING: 'meeting', // 회의실   할 일 · 계획 · 서브에이전트 배정
  DESK: 'desk',       // 내 자리   나한테 질문
};

const clip = (s, n) => {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');

// ---------- Bash / PowerShell 명령을 까서 방 고르기 ----------
const NET = /^(curl|wget|http|https|xh|gh|ping|nslookup|dig|invoke-webrequest|iwr|invoke-restmethod|irm|test-netconnection)$/i;
const READ = /^(rg|grep|egrep|fgrep|ag|ack|cat|bat|head|tail|less|more|ls|ll|dir|find|fd|wc|tree|stat|file|du|which|where|type|pwd|awk|sed|jq|yq|diff|cut|sort|uniq|realpath|basename|dirname|get-content|gc|select-string|sls|get-childitem|gci|test-path|get-item|resolve-path|measure-object|format-hex|readlink|xxd|od|strings)$/i;
const WRITE = /^(tee|mv|cp|rm|rmdir|mkdir|touch|patch|chmod|chown|ln|truncate|dd|unzip|tar|set-content|out-file|add-content|new-item|remove-item|copy-item|move-item|rename-item|ni|del|copy|move|ren)$/i;
const GIT_READ = /^(log|show|diff|status|blame|grep|ls-files|branch|rev-parse|describe|shortlog|reflog)$/i;
const GIT_WRITE = /^(apply|mv|rm|checkout|restore|add|am|stash)$/i;

function words(seg) {
  const w = seg.trim().split(/\s+/).filter(Boolean);
  while (w.length && (/^\w+=/.test(w[0]) || /^(sudo|time|nohup|env|exec|command|xargs|&)$/i.test(w[0]))) w.shift();
  return w;
}

function shellRoom(cmd) {
  let c = String(cmd || '');
  // 리디렉션 중 파일 쓰기가 아닌 것들 지우기
  c = c.replace(/\d?>&\d/g, ' ').replace(/&?\d?>\s*(\/dev\/null|\$null|nul)\b/gi, ' ');
  // heredoc 본문은 무시 (첫 줄만 판단)
  const heredoc = /<<-?\s*['"]?(\w+)/.test(c);
  if (heredoc) c = c.split('\n')[0];
  const writesFile = /(^|[^<>\d&])>{1,2}\s*[^\s&|>]/.test(c);
  const segs = c.split(/&&|\|\||;|\||\n/).map(words).filter((w) => w.length);
  let sawNet = false, sawWrite = writesFile, allRead = segs.length > 0;
  for (const w of segs) {
    const cmd0 = base(w[0]).replace(/\.exe$/i, '');
    if (/^(cd|pushd|popd|echo|printf|set-location|sl|true|export|set|write-host|write-output)$/i.test(cmd0)) continue;
    if (/^(sed|perl)$/i.test(cmd0) && w.some((x) => /^-\w*i/.test(x))) { sawWrite = true; allRead = false; continue; }
    if (cmd0 === 'git') {
      const sub = w.find((x, i) => i > 0 && !x.startsWith('-')) || '';
      if (GIT_WRITE.test(sub)) { sawWrite = true; allRead = false; }
      else if (!GIT_READ.test(sub)) allRead = false;
      continue;
    }
    if (NET.test(cmd0)) { sawNet = true; allRead = false; continue; }
    if (WRITE.test(cmd0)) { sawWrite = true; allRead = false; continue; }
    if (READ.test(cmd0)) continue;
    allRead = false;
  }
  if (sawWrite) return ROOM.DEV;
  if (sawNet) return ROOM.SEARCH;
  if (allRead) return ROOM.ARCHIVE;
  return ROOM.SERVER;
}

const ROOM_ICON = { archive: '📖', dev: '✏️', server: '🖥️', search: '🌐', meeting: '📋', desk: '🙋' };

function hostOf(u) { try { return new URL(u).host; } catch { return clip(u, 30); } }

// ---------- 도구 → 방 + 말풍선 문구 ----------
function toolInfo(name, input) {
  input = input || {};
  const n = String(name || '');
  switch (n) {
    case 'Read': return { room: ROOM.ARCHIVE, label: `📖 ${base(input.file_path || input.path)} 읽는 중` };
    case 'Grep': return { room: ROOM.ARCHIVE, label: `🔎 "${clip(input.pattern, 24)}" 찾는 중` };
    case 'Glob': return { room: ROOM.ARCHIVE, label: `🗂️ ${clip(input.pattern, 28)} 훑는 중` };
    case 'LS': return { room: ROOM.ARCHIVE, label: `🗂️ ${base(input.path)} 둘러보는 중` };
    case 'Edit': case 'MultiEdit': return { room: ROOM.DEV, label: `✏️ ${base(input.file_path)} 고치는 중` };
    case 'Write': return { room: ROOM.DEV, label: `📝 ${base(input.file_path)} 쓰는 중` };
    case 'NotebookEdit': return { room: ROOM.DEV, label: `📓 ${base(input.notebook_path)} 고치는 중` };
    case 'Bash': case 'PowerShell': {
      const room = shellRoom(input.command);
      const what = input.description ? clip(input.description, 34) : '$ ' + clip(input.command, 30);
      return { room, label: `${ROOM_ICON[room]} ${what}` };
    }
    case 'BashOutput': case 'TaskOutput': case 'Monitor': case 'KillShell': case 'TaskStop':
      return { room: ROOM.SERVER, label: '🖥️ 백그라운드 작업 확인 중' };
    case 'WebSearch': return { room: ROOM.SEARCH, label: `🌐 "${clip(input.query, 24)}" 검색 중` };
    case 'WebFetch': return { room: ROOM.SEARCH, label: `🌐 ${hostOf(input.url)} 읽는 중` };
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': case 'TaskList': case 'TaskGet':
      return { room: ROOM.MEETING, label: '📋 할 일 정리 중' };
    case 'EnterPlanMode': case 'ExitPlanMode': return { room: ROOM.MEETING, label: '🗺️ 계획 세우는 중' };
    case 'Agent': case 'Task':
      return { room: ROOM.MEETING, label: `🧑‍💼 "${clip(input.description, 26)}" 맡기는 중`, agent: true };
    case 'SendMessage': return { room: ROOM.MEETING, label: '📨 동료에게 메시지 보내는 중' };
    case 'AskUserQuestion': {
      const q = (input.questions && input.questions[0] && input.questions[0].question) || '질문이 있어요';
      return { room: ROOM.DESK, label: `❓ ${clip(q, 60)}`, question: true };
    }
    case 'Skill': return { room: ROOM.ARCHIVE, label: `📚 ${clip(input.skill, 24)} 스킬 펼치는 중` };
    case 'ToolSearch': return { room: ROOM.ARCHIVE, label: '📚 도구 설명서 찾는 중' };
    case 'Artifact': return { room: ROOM.DEV, label: '🎨 페이지 만드는 중' };
  }
  if (n.startsWith('mcp__')) {
    const [, server = '', tool = ''] = n.split('__');
    if (/update_plan|todo/i.test(tool)) return { room: ROOM.MEETING, label: '📋 할 일 정리 중' };
    if (/wrap_up/i.test(tool)) return { room: ROOM.DESK, label: '📮 결과 보고 정리 중' };
    const srv = /^[0-9a-f-]{20,}$/i.test(server) ? 'mcp' : server.replace(/^claude[-_]?/i, '');
    return { room: ROOM.SEARCH, label: `🔌 ${clip(srv, 14)}·${clip(tool, 20)}` };
  }
  return { room: ROOM.DEV, label: `🛠️ ${clip(n, 24)}` };
}

// 백그라운드 작업이 끝나면 Claude Code가 남기는 <task-notification> 기록 해석
function parseTaskNote(text) {
  if (!/<task-notification>/.test(text || '')) return null;
  const g = (t) => ((text.match(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>')) || [])[1] || '').trim();
  return { taskId: g('task-id'), toolId: g('tool-use-id'), status: g('status') || 'completed', summary: clip(g('summary'), 120), outputFile: g('output-file') };
}

function resultText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (b && b.type === 'text' ? b.text : b && b.type === 'image' ? '🖼️' : '')).join(' ');
  return '';
}

// ---------- 분류기: actor 하나(메인 or 서브에이전트)당 하나 ----------
class Classifier {
  constructor(actor) {
    this.actor = actor;
    this.pending = new Map(); // toolUseId → { name, ts }
    this.lastTs = 0;
    this.title = null;
  }

  classify(rec) {
    const out = [];
    if (!rec || typeof rec !== 'object') return out;
    const ts = Date.parse(rec.timestamp) || Date.now();
    const actor = this.actor;
    const isMain = actor === 'main';
    const emit = (e) => out.push(Object.assign({ actor, ts }, e));

    if (rec.type === 'custom-title' || rec.type === 'ai-title') {
      const t = rec.customTitle || rec.aiTitle;
      if (t && t !== this.title && (rec.type === 'custom-title' || !this.customTitle)) {
        if (rec.type === 'custom-title') this.customTitle = true;
        this.title = t;
        if (isMain) out.push({ actor, ts, kind: 'session', title: t });
      }
      return out;
    }

    if (rec.type === 'system') {
      if (rec.subtype === 'stop_hook_summary' || rec.subtype === 'turn_duration') emit({ kind: 'turn_end' });
      else if (rec.subtype === 'api_error') emit({ kind: 'error', text: '⚠️ API 오류, 다시 시도 중' });
      else if (rec.subtype === 'compact_boundary') emit({ kind: 'say', text: '🧹 대화가 길어서 요약(compact)하는 중' });
      return out;
    }

    const msg = rec.message;
    if (!msg) return out;

    if (rec.type === 'user') {
      if (rec.isMeta) return out;
      const c = msg.content;
      const human = !rec.origin || rec.origin.kind === 'human';
      if (typeof c === 'string') {
        if (/^\[Request interrupted/.test(c)) { emit({ kind: 'interrupt', actor: 'user' }); return out; }
        const note = parseTaskNote(c);
        if (note) { emit(Object.assign({ kind: 'bg_end' }, note)); return out; }
        if (!isMain || !human) return out;
        const cmd = c.match(/<command-name>([^<]+)<\/command-name>/);
        if (cmd) {
          const args = (c.match(/<command-args>([^<]*)<\/command-args>/) || [])[1] || '';
          emit({ kind: 'user_say', actor: 'user', text: clip(`${cmd[1]} ${args}`, 140) });
        } else if (!/^\s*</.test(c) && !/^Caveat:/.test(c)) {
          emit({ kind: 'user_say', actor: 'user', text: clip(c, 160) });
        }
        this.lastTs = ts;
        return out;
      }
      if (!Array.isArray(c)) return out;
      const texts = [];
      let hadResult = false;
      for (const b of c) {
        if (!b) continue;
        if (b.type === 'tool_result') {
          hadResult = true;
          const p = this.pending.get(b.tool_use_id);
          this.pending.delete(b.tool_use_id);
          const txt = resultText(b.content);
          const interrupted = /interrupted by user|user doesn't want to proceed|rejected/i.test(txt) && b.is_error;
          emit({
            kind: 'tool_end', toolId: b.tool_use_id, tool: p ? p.name : undefined,
            ok: !b.is_error, interrupted,
            text: b.is_error ? clip(txt.replace(/^Error:\s*/, ''), 90) : p && p.desc != null ? clip(txt, 140) : undefined,
            agentDesc: p ? p.desc : undefined,
            dur: p ? ts - p.ts : undefined,
          });
          if (p && p.bg && !b.is_error) {
            const tur = rec.toolUseResult && typeof rec.toolUseResult === 'object' ? rec.toolUseResult : {};
            const taskId = tur.backgroundTaskId || tur.agentId || (txt.match(/(?:with ID|agentId|task[_ ]id)[:\s]+([\w-]+)/i) || [])[1] || '';
            const outputFile = tur.outputFile || (txt.match(/written to:\s*(\S+?\.output)/i) || txt.match(/output_file[":\s]+([^\s"]+)/i) || [])[1] || '';
            emit({ kind: 'bg_info', toolId: b.tool_use_id, taskId, outputFile });
          }
          if (p && p.name === 'AskUserQuestion' && !b.is_error) {
            const ans = (txt.match(/"[^"]*"="([^"]*)"/) || [])[1] || txt;
            emit({ kind: 'answer', actor: 'user', text: clip(ans, 80) });
          }
        } else if (b.type === 'text') {
          if (/^\[Request interrupted/.test(b.text)) { emit({ kind: 'interrupt', actor: 'user' }); continue; }
          const note = parseTaskNote(b.text);
          if (note) { emit(Object.assign({ kind: 'bg_end' }, note)); hadResult = true; continue; }
          if (!/^\s*</.test(b.text)) texts.push(b.text);
        } else if (b.type === 'image') texts.push('🖼️(이미지)');
      }
      if (isMain && human && !hadResult && texts.length) emit({ kind: 'user_say', actor: 'user', text: clip(texts.join(' '), 160) });
      this.lastTs = ts;
      return out;
    }

    if (rec.type === 'assistant') {
      const c = Array.isArray(msg.content) ? msg.content : [];
      let hasText = false, hasTool = false, lastText = '';
      for (const b of c) {
        if (!b) continue;
        if (b.type === 'thinking' || b.type === 'redacted_thinking') {
          emit({ kind: 'think', text: clip(b.thinking || '', 80), dur: this.lastTs ? Math.max(0, ts - this.lastTs) : 0 });
        } else if (b.type === 'text') {
          const t = (b.text || '').trim();
          if (!t || t === 'No response requested.') continue;
          hasText = true; lastText = t;
          emit({ kind: 'say', text: clip(t, 200) });
        } else if (b.type === 'tool_use') {
          hasTool = true;
          const info = toolInfo(b.name, b.input);
          const inp = b.input || {};
          const bg = inp.run_in_background === true; // 백그라운드 실행 → 1층 작업실에서 돌아감
          this.pending.set(b.id, { name: b.name, ts, bg, desc: info.agent ? clip(inp.description, 60) : undefined });
          emit({
            kind: info.question ? 'question' : 'tool_start', toolId: b.id, tool: b.name,
            room: info.room, label: bg ? `🚀 ${info.label.replace(/^\S+\s/, '')} → 1층` : info.label, bg,
            agentType: info.agent ? inp.subagent_type || 'general-purpose' : undefined,
          });
          if (bg) emit({
            kind: 'bg_start', toolId: b.id, bgKind: info.agent ? 'agent' : 'shell',
            label: clip(inp.description || inp.command || b.name, 48),
            agentType: info.agent ? inp.subagent_type || 'general-purpose' : undefined,
          });
        }
      }
      if (msg.stop_reason === 'end_turn' && !hasTool) emit({ kind: 'turn_end' });
      this.lastTs = ts;
      this.lastAssistant = { ts, hasText, hasTool, text: lastText, stop: msg.stop_reason };
      return out;
    }
    return out;
  }
}

module.exports = { Classifier, shellRoom, toolInfo, clip, ROOM };
