/**
 * 公开信息搜索适配层。
 * SEARCH_PROVIDER: mock | tavily | serper
 * 未配置 Key 时自动走 mock，便于本地联调。
 */

function providerName() {
  const forced = (process.env.SEARCH_PROVIDER || '').trim().toLowerCase();
  if (forced) return forced;
  if (process.env.TAVILY_API_KEY) return 'tavily';
  if (process.env.SERPER_API_KEY || process.env.SEARCH_API_KEY) return 'serper';
  return 'mock';
}

export function getSearchStatus() {
  const provider = providerName();
  const configured =
    provider === 'mock' ||
    (provider === 'tavily' && Boolean(process.env.TAVILY_API_KEY)) ||
    (provider === 'serper' && Boolean(process.env.SERPER_API_KEY || process.env.SEARCH_API_KEY));
  return { provider, configured, mode: provider === 'mock' ? 'mock' : 'live' };
}

export async function searchMemberNews(member, { days = 30, limit = 5 } = {}) {
  const provider = providerName();
  const query = buildQuery(member);
  if (provider === 'tavily') return searchTavily(query, { days, limit });
  if (provider === 'serper') return searchSerper(query, { days, limit });
  return searchMock(member, { limit });
}

function buildQuery(member) {
  const name = (member.name || '').trim();
  const company = (member.company || '').trim();
  // 优先公司名，避免「张三」这类常见名搜出大量无关/垃圾站
  // 注意：Serper 免费账号禁止查询里使用英文双引号精确匹配（会 400 Query pattern not allowed）
  let subject = '';
  if (company && name) subject = `${company} ${name}`;
  else if (company) subject = company;
  else if (name) subject = name;
  else subject = '前沿科技';
  // 补一个 ASCII 别名（英文名/品牌），不加引号
  const alias = String(member.rssKeywords || '')
    .split(/[;；,，|]/)
    .map((s) => s.trim())
    .find((s) => s && s !== name && s !== company && /^[\x20-\x7E]+$/.test(s) && s.length >= 3);
  if (alias) subject = `${subject} ${alias}`;
  return `${subject} (融资 OR 发布 OR 合作 OR 上市 OR 任命 OR 采访 OR 产品 OR launch OR funding)`;
}

async function searchTavily(query, { days, limit }) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error('缺少 TAVILY_API_KEY');

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: 'basic',
      include_answer: false,
      max_results: limit,
      days,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tavily 搜索失败: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.results || []).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || r.snippet || '',
    publishedAt: r.published_date || null,
  }));
}

async function searchSerper(query, { limit }) {
  const key = process.env.SERPER_API_KEY || process.env.SEARCH_API_KEY;
  if (!key) throw new Error('缺少 SERPER_API_KEY / SEARCH_API_KEY');

  // Serper 单页通常最多 10 条；免费账号对部分高级写法更敏感
  const num = Math.min(Math.max(Number(limit) || 5, 1), 10);
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': key,
    },
    body: JSON.stringify({ q: query, num, tbs: 'qdr:m' }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Serper 搜索失败: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.organic || []).map((r) => ({
    title: r.title || '',
    url: r.link || '',
    snippet: r.snippet || '',
    publishedAt: r.date || null,
  }));
}

async function searchMock(member, { limit }) {
  const company = member.company || '相关公司';
  const name = member.name || '会员';
  const now = Date.now();
  const items = [
    {
      title: `${company} 发布新一代产品进展`,
      url: `https://example.com/news/${encodeURIComponent(member.id)}-product`,
      snippet: `${company}（关联会员 ${name}）近日公布产品与市场进展，引发行业关注。`,
      publishedAt: new Date(now - 2 * 86400000).toISOString(),
    },
    {
      title: `${name} 谈行业趋势与下一阶段重点`,
      url: `https://example.com/interview/${encodeURIComponent(member.id)}`,
      snippet: `公开采访中，${name} 分享了 ${company} 在技术与商业化上的最新思考。`,
      publishedAt: new Date(now - 5 * 86400000).toISOString(),
    },
    {
      title: `${company} 宣布一项战略合作`,
      url: `https://example.com/partner/${encodeURIComponent(member.id)}`,
      snippet: `${company} 与合作方宣布在市场拓展方面达成合作。`,
      publishedAt: new Date(now - 9 * 86400000).toISOString(),
    },
  ];
  return items.slice(0, limit);
}
