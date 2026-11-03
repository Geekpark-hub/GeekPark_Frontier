import { prisma } from '../prisma.js';

const SENSITIVE_KEY = /(password|secret|token|api[_-]?key|authorization)/i;
const MAX_JSON = 1800;

function safeJson(value) {
  try {
    const text = JSON.stringify(value);
    if (!text) return '{}';
    return text.length > MAX_JSON ? `${text.slice(0, MAX_JSON)}…` : text;
  } catch {
    return '{}';
  }
}

function redact(value) {
  if (Array.isArray(value)) return value.slice(0, 30).map(redact);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(k)) out[k] = '[已隐藏]';
    else if (typeof v === 'string' && v.length > 500) out[k] = `${v.slice(0, 500)}…`;
    else out[k] = redact(v);
  }
  return out;
}

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.ip || req.socket?.remoteAddress || '';
}

/** 把 method + path 收成可读动作 */
export function describeAdminAction(method, path = '') {
  const p = String(path || '').replace(/^\/api\/admin/, '').replace(/^\//, '');
  const m = String(method || 'GET').toUpperCase();
  const idMatch = p.match(/\/([a-zA-Z0-9_-]{6,})(?:\/|$)/);
  const targetId = idMatch?.[1] || '';

  const rules = [
    [/members\/[^/]+\/unbind-wechat/, 'POST', '解绑微信'],
    [/^members\/[^/]+$/, 'PUT', '编辑会员/用户'],
    [/^members\/[^/]+$/, 'DELETE', '删除会员/用户'],
    [/^members$/, 'POST', '创建会员/用户'],
    [/^members$/, 'GET', '查看会员/用户列表'],
    [/^feed\/batch-delete$/, 'POST', '批量删除动态'],
    [/^feed\/[^/]+$/, 'PUT', '编辑/发布动态'],
    [/^feed\/[^/]+$/, 'DELETE', '删除动态'],
    [/^feed$/, 'POST', '创建动态'],
    [/^feed$/, 'GET', '查看动态列表'],
    [/^feed\/member-options$/, 'GET', '加载动态关联会员'],
    [/^feed\/hero$/, 'GET', '查看动态页封面设置'],
    [/^feed\/hero$/, 'PUT', '更新动态页封面设置'],
    [/^ai\/run-feed$/, 'POST', '运行 AI 抓取'],
    [/^ai\/status$/, 'GET', '查看 AI 状态'],
    [/^ai\/sources\/[^/]+\/probe$/, 'POST', '探测信息源'],
    [/^ai\/sources\/[^/]+$/, 'PUT', '编辑信息源'],
    [/^ai\/sources\/[^/]+$/, 'DELETE', '删除信息源'],
    [/^ai\/sources$/, 'POST', '创建信息源'],
    [/^ai\/sources$/, 'GET', '查看信息源'],
    [/^jobs\/maintenance$/, 'POST', '运行维护任务'],
    [/^jobs\/logs$/, 'GET', '查看任务日志'],
    [/^polls\/[^/]+\/results$/, 'GET', '查看投票结果'],
    [/^polls\/[^/]+$/, 'PUT', '编辑投票'],
    [/^polls\/[^/]+$/, 'DELETE', '删除投票'],
    [/^polls$/, 'POST', '创建投票'],
    [/^polls$/, 'GET', '查看投票列表'],
    [/^events\/[^/]+\/registrations$/, 'GET', '查看活动报名'],
    [/^events\/[^/]+$/, 'PUT', '编辑活动'],
    [/^events\/[^/]+$/, 'DELETE', '删除活动'],
    [/^events$/, 'POST', '创建活动'],
    [/^events$/, 'GET', '查看活动列表'],
    [/^registrations\/[^/]+$/, 'PUT', '更新报名状态'],
    [/^requests\/[^/]+$/, 'PUT', '更新会员需求'],
    [/^requests$/, 'GET', '查看需求列表'],
    [/^analytics/, 'GET', '查看活跃分析'],
    [/^audit-logs/, 'GET', '查看操作记录'],
    [/^upload\//, 'POST', '上传文件'],
  ];

  for (const [re, needMethod, label] of rules) {
    if (needMethod === m && re.test(p)) {
      return { action: label, targetId };
    }
  }
  return { action: `${m} /${p}`, targetId };
}

function shouldSkip(req) {
  const method = String(req.method || '').toUpperCase();
  if (method === 'OPTIONS' || method === 'HEAD') return true;
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  // 高频轮询、审计页自身不写，避免刷屏/递归
  if (method === 'GET' && /\/admin\/ai\/status\/?$/.test(path)) return true;
  if (/\/admin\/audit-logs/.test(path)) return true;
  return false;
}

export function adminAuditMiddleware(req, res, next) {
  if (shouldSkip(req)) return next();

  const started = Date.now();
  res.on('finish', () => {
    void persistAudit(req, res, Date.now() - started);
  });
  next();
}

async function persistAudit(req, res, durationMs) {
  try {
    const actor = req.member;
    const rawPath = String(req.originalUrl || req.url || '');
    const pathOnly = rawPath.split('?')[0].replace(/^\/api\/admin/, '') || '/';
    const { action, targetId } = describeAdminAction(req.method, pathOnly);
    const statusCode = Number(res.statusCode) || 0;
    const body =
      req.method === 'GET' || req.method === 'DELETE'
        ? {}
        : redact(req.body || {});

    await prisma.adminAuditLog.create({
      data: {
        actorId: actor?.id || '',
        actorName: actor?.name || '',
        actorPhone: actor?.phone || '',
        method: String(req.method || '').toUpperCase(),
        path: pathOnly.slice(0, 240),
        action,
        targetType: '',
        targetId: targetId || String(req.params?.id || ''),
        statusCode,
        success: statusCode >= 200 && statusCode < 400,
        ip: clientIp(req).slice(0, 80),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 240),
        query: safeJson(redact(req.query || {})),
        body: safeJson({ ...body, _durationMs: durationMs }),
      },
    });
  } catch (err) {
    console.warn('[audit] write failed', err.message || err);
  }
}
