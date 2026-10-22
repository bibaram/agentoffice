// 데모: 진짜 Claude 없이 가짜 세션 파일을 한 줄씩 써서 사무실을 움직여 본다.
//   node demo.js            → ./demo-data 에 가짜 세션 기록 (반복)
//   CLAUDE_PROJECTS=./demo-data node server.js   (다른 터미널에서)
// 또는 npm run demo 하나로 둘 다 실행.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.DEMO_ROOT || path.join(__dirname, 'demo-data'));
const PROJ = path.join(ROOT, 'D--demo-project');
const SID = 'demo-session-0001';
const FILE = path.join(PROJ, SID + '.jsonl');
const SUB = path.join(PROJ, SID, 'subagents');
const TASKS = path.join(ROOT, 'tasks');
fs.mkdirSync(SUB, { recursive: true });
fs.mkdirSync(TASKS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const id = () => 'toolu_demo_' + (++n) + '_' + Date.now().toString(36);
const write = (file, rec) => fs.appendFileSync(file, JSON.stringify(Object.assign({ timestamp: new Date().toISOString(), sessionId: SID, cwd: 'D:\\demo\\project' }, rec)) + '\n');

const user = (file, content, extra) => write(file, Object.assign({ type: 'user', message: { role: 'user', content }, origin: { kind: 'human' } }, extra));
const asst = (file, content, stop = 'tool_use') => write(file, { type: 'assistant', message: { role: 'assistant', content, stop_reason: stop } });
const think = (file, text) => asst(file, [{ type: 'thinking', thinking: text }]);
const say = (file, text, stop) => asst(file, [{ type: 'text', text }], stop);

async function tool(file, name, input, ms, result = 'ok', isError = false) {
  const tid = id();
  asst(file, [{ type: 'tool_use', id: tid, name, input }]);
  await sleep(ms);
  write(file, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: result, is_error: isError }] } });
  return tid;
}

async function subagent(agentId, type, desc, steps, toolUseId) {
  const f = path.join(SUB, `agent-${agentId}${Date.now().toString(36)}.jsonl`); // 회차마다 새 파일 = 새 출근
  fs.writeFileSync(f.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({ agentType: type, description: desc, toolUseId }));
  write(f, { type: 'user', isSidechain: true, message: { role: 'user', content: desc } });
  await sleep(1800);
  for (const s of steps) { await s(f); await sleep(500); }
}

// 백그라운드 작업 끝 알림 (Claude Code가 남기는 형식 그대로)
const taskNote = (taskId, toolUseId, out, status, summary) => write(FILE, {
  type: 'user', origin: { kind: 'task-notification' },
  message: { role: 'user', content: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<output-file>${out}</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>` },
});

// 백그라운드 셸 작업: 출력 파일에 한 줄씩 쓰다가 끝나면 알림
async function bgShell(desc, command, lines, every, ok = true) {
  const tid = id(), task = 'b' + Math.random().toString(36).slice(2, 10);
  const out = path.join(TASKS, task + '.output');
  asst(FILE, [{ type: 'tool_use', id: tid, name: 'Bash', input: { command, description: desc, run_in_background: true } }]);
  await sleep(400);
  write(FILE, {
    type: 'user', toolUseResult: { backgroundTaskId: task },
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: `Command running in background with ID: ${task}. Output is being written to: ${out}` }] },
  });
  (async () => {
    for (const l of lines) { fs.appendFileSync(out, l + '\n'); await sleep(every); }
    taskNote(task, tid, out, ok ? 'completed' : 'failed', `Background command "${desc}" ${ok ? 'completed (exit code 0)' : 'failed with exit code 1'}`);
  })();
}

// 백그라운드 서브에이전트: 1층으로 출근
async function bgAgent(type, desc, steps) {
  const tid = id();
  asst(FILE, [{ type: 'tool_use', id: tid, name: 'Agent', input: { description: desc, subagent_type: type, prompt: '...', run_in_background: true } }]);
  await sleep(300);
  write(FILE, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: 'Async agent launched successfully.' }] } });
  (async () => {
    await subagent('demobg', type, desc, steps, tid);
    await sleep(2500);
    taskNote('demobg', tid, '', 'completed', `Agent "${desc}" finished`);
  })();
}

async function scene() {
  write(FILE, { type: 'ai-title', aiTitle: '데모: 로그인 버그 고치기' });
  user(FILE, '로그인하면 가끔 500 에러가 나. 원인 찾아서 고쳐줘');
  await sleep(2500);
  think(FILE, '로그인 흐름부터 봐야겠다. auth 미들웨어와 세션 저장소가 의심된다.');
  await sleep(1200);
  say(FILE, '먼저 로그인 관련 코드를 살펴볼게요.');
  await sleep(1500);
  await tool(FILE, 'Read', { file_path: 'src/auth/login.js' }, 2500);
  await sleep(800);
  await tool(FILE, 'Grep', { pattern: 'sessionStore' }, 2000);
  await sleep(1000);
  await tool(FILE, 'TodoWrite', { todos: [] }, 1800);
  await sleep(800);

  // 오래 걸리는 일은 백그라운드로 → 1층 작업실
  await bgShell('전체 테스트 스위트 실행', 'npm test -- --runInBand', [
    '> jest --runInBand', 'PASS  src/auth/login.test.js', 'PASS  src/auth/refresh.test.js', 'RUNS  src/store/session.test.js',
    'PASS  src/store/session.test.js', 'PASS  src/api/users.test.js', 'RUNS  src/api/orders.test.js', 'PASS  src/api/orders.test.js',
    'Tests: 128 passed, 128 total', 'Time: 31.4 s',
  ], 3000);
  await sleep(800);
  await bgAgent('general-purpose', '의존성 보안 점검', [
    (f) => tool(f, 'Read', { file_path: 'package-lock.json' }, 2500),
    (f) => tool(f, 'Bash', { command: 'npm audit --json', description: '보안 취약점 검사' }, 3500),
    (f) => tool(f, 'WebSearch', { query: 'jsonwebtoken 9.0 CVE' }, 3000),
    (f) => tool(f, 'Write', { file_path: 'SECURITY-REPORT.md' }, 2000),
    async (f) => { say(f, '취약점 2건(중간) 발견, jsonwebtoken 9.0.2로 올리면 해결됩니다. SECURITY-REPORT.md 참고.', 'end_turn'); },
  ]);
  await sleep(800);

  // 서브에이전트 둘에게 일 맡기기
  const t1 = id(), t2 = id();
  asst(FILE, [{ type: 'tool_use', id: t1, name: 'Agent', input: { description: '세션 저장소 구조 조사', subagent_type: 'Explore', prompt: '...' } }]);
  const a1 = subagent('demoexplore', 'Explore', '세션 저장소 구조 조사', [
    (f) => tool(f, 'Glob', { pattern: 'src/**/session*.js' }, 1500),
    (f) => tool(f, 'Read', { file_path: 'src/store/session.js' }, 2500),
    (f) => tool(f, 'Bash', { command: 'rg -n "ttl" src/store', description: 'TTL 설정 찾기' }, 2000),
    (f) => tool(f, 'WebSearch', { query: 'redis session ttl race condition' }, 3000),
    async (f) => { say(f, 'Redis 세션 TTL이 만료되는 순간 로그인 요청이 겹치면 null 세션을 읽습니다. src/store/session.js:42', 'end_turn'); },
  ]);
  await sleep(700);
  asst(FILE, [{ type: 'tool_use', id: t2, name: 'Agent', input: { description: '테스트 실행 계획', subagent_type: 'Plan', prompt: '...' } }]);
  const a2 = subagent('demoplan', 'Plan', '테스트 실행 계획 세우기', [
    (f) => tool(f, 'Read', { file_path: 'package.json' }, 1500),
    (f) => tool(f, 'Bash', { command: 'npm test -- --listTests', description: '테스트 목록 보기' }, 3000),
    (f) => tool(f, 'TodoWrite', { todos: [] }, 1500),
    async (f) => { say(f, 'auth 관련 테스트 3개만 돌리면 됩니다: login, session, refresh.', 'end_turn'); },
  ]);
  await Promise.all([a1, a2]);
  await sleep(1500);
  write(FILE, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: t1, content: 'TTL race' }] } });
  write(FILE, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: t2, content: '3 tests' }] } });
  await sleep(4000);

  think(FILE, '');
  await sleep(500);
  await bgShell('린트 검사', 'npm run lint', ['> eslint src', 'src/store/session.js', '  42:7  error  no-unused-vars', '✖ 1 problem (1 error)'], 2000, false);
  await sleep(600);
  await tool(FILE, 'Bash', { command: 'npm test auth', description: '인증 테스트 실행' }, 3500, 'Exit code 1\n2 failing: session expired', true);
  await sleep(1500);
  await tool(FILE, 'Edit', { file_path: 'src/store/session.js' }, 2500);
  await sleep(600);
  await tool(FILE, 'Bash', { command: "sed -i 's/ttl: 0/ttl: 3600/' config/redis.yml", description: 'TTL 기본값 수정' }, 1500);
  await sleep(600);
  await tool(FILE, 'Bash', { command: 'curl -s http://localhost:3000/health', description: '헬스 체크' }, 1500);
  await sleep(800);
  await tool(FILE, 'Bash', { command: 'npm test auth', description: '인증 테스트 다시 실행' }, 3000, 'all passed');
  await sleep(800);
  await tool(FILE, 'AskUserQuestion', { questions: [{ question: 'TTL을 1시간으로 바꿨어요. 운영에도 바로 반영할까요?' }] }, 4500, 'User has answered your questions: "TTL을 1시간으로 바꿨어요. 운영에도 바로 반영할까요?"="스테이징 먼저"');
  await sleep(1000);
  say(FILE, '좋아요, 스테이징 설정부터 바꿀게요.');
  await sleep(1200);
  await tool(FILE, 'Write', { file_path: 'config/staging.yml' }, 2000);
  await sleep(600);
  const tid = id();
  asst(FILE, [{ type: 'tool_use', id: tid, name: 'Bash', input: { command: 'npm run deploy:staging', description: '스테이징 배포' } }]);
  await sleep(2500);
  user(FILE, [{ type: 'text', text: '[Request interrupted by user for tool use]' }]);
  await sleep(2500);
  user(FILE, '배포는 내가 할게. 요약만 해줘');
  await sleep(3000);
  say(FILE, '원인은 Redis 세션 TTL 경쟁 상태였고, session.js 수정 + 스테이징 TTL 1시간으로 바꿨습니다. 테스트 통과!', 'end_turn');
  write(FILE, { type: 'system', subtype: 'stop_hook_summary' });
}

if (process.argv.includes('--serve')) { // npm run demo: 서버까지 같이 (포트 4778)
  process.env.CLAUDE_PROJECTS = ROOT;
  process.env.PORT = process.env.PORT || '4778';
  require('./server').start();
}

(async () => {
  console.log('🎬 데모 세션 기록 중 →', FILE);
  for (;;) {
    for (const f of fs.readdirSync(SUB)) fs.rmSync(path.join(SUB, f));
    for (const f of fs.readdirSync(TASKS)) fs.rmSync(path.join(TASKS, f));
    await scene();
    await sleep(12000);
  }
})();
