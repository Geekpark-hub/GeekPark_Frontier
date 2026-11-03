/**
 * 多次冒烟：健康检查、登录、维护任务、AI 抓取、Feed 待审、发布链路
 */
import 'dotenv/config';

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3000';

async function req(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `${res.status} ${path}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function round(n) {
  console.log(`\n===== smoke round ${n} =====`);

  const health = await req('/api/health');
  assert(health.ok, 'health failed');
  console.log('health', health.search, health.llm);

  const login = await req('/api/auth/admin-login', {
    method: 'POST',
    body: { phone: '17611294568' },
  });
  assert(login.token, 'admin login failed');
  const token = login.token;

  const maint = await req('/api/admin/jobs/maintenance', { method: 'POST', token });
  assert(maint.ok, 'maintenance failed');
  console.log('maintenance', maint.result.summary);

  const ai = await req('/api/admin/ai/run-feed', {
    method: 'POST',
    token,
    body: { limitPerMember: 1, async: true },
  });
  assert(ai.ok && (ai.started || ai.reason === 'already_running'), 'ai start failed');
  console.log('ai start', ai.message || ai.run?.summary);

  // 等待后台任务结束（最多 90s）；若已有任务在跑也等到结束
  let finalRun = null;
  for (let i = 0; i < 45; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await req('/api/admin/ai/status', { token });
    finalRun = st.currentRun;
    if (finalRun && finalRun.status !== 'running') break;
  }
  assert(finalRun && finalRun.status !== 'running', 'ai run still running');
  console.log('ai done', finalRun.summary);

  const pending = await req('/api/admin/feed?status=pending&sourceType=auto', { token });
  assert(Array.isArray(pending.posts), 'pending feed missing');
  console.log('pending auto posts', pending.posts.length);
  const skipped = finalRun.result?.skipped || 0;
  assert(pending.posts.length > 0 || skipped > 0 || finalRun.status === 'ok', 'expected pending or skipped after AI');

  const status = await req('/api/admin/ai/status', { token });
  assert(status.search && status.llm, 'ai status incomplete');
  console.log('ai status pendingAuto=', status.pendingAuto, 'jobs=', (status.recentJobs || []).length);

  // 会员 mock 登录（需 ALLOW_MOCK_LOGIN=true；默认已关闭）
  const memberLogin = await req('/api/auth/mock-login', {
    method: 'POST',
    body: { phone: '13800000001' },
  });
  if (memberLogin.token && memberLogin.status === 'member') {
    const mToken = memberLogin.token;
    const feed = await req('/api/feed', { token: mToken });
    assert(Array.isArray(feed.posts), 'member feed failed');
    const polls = await req('/api/polls/active', { token: mToken });
    assert(Array.isArray(polls.polls), 'active polls failed');
    console.log('member feed', feed.posts.length, 'active polls', polls.polls.length);
  } else {
    console.log('skip member mock-login (ALLOW_MOCK_LOGIN off)');
  }

  console.log(`round ${n} OK`);
}

async function main() {
  const times = Number(process.env.SMOKE_ROUNDS || 3);
  for (let i = 1; i <= times; i += 1) {
    await round(i);
  }
  console.log(`\nAll ${times} smoke rounds passed.`);
}

main().catch((err) => {
  console.error('\nSMOKE FAILED:', err.message);
  process.exit(1);
});
