/**
 * 大模型适配层（OpenAI 兼容接口）。
 * 支持 Modelink / OpenAI 等：
 *   MODELINK_API_KEY 或 LLM_API_KEY / OPENAI_API_KEY
 *   LLM_BASE_URL（默认 https://api.modelink.ai/v1）
 *   LLM_MODEL（默认 deepseek/deepseek-v4-pro）
 */

function getApiKey() {
  return (
    process.env.MODELINK_API_KEY ||
    process.env.LLM_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ''
  ).trim();
}

function providerName() {
  const forced = (process.env.LLM_PROVIDER || '').trim().toLowerCase();
  if (forced) return forced;
  if (getApiKey()) return 'openai';
  return 'mock';
}

export function getLlmStatus() {
  const provider = providerName();
  const configured = provider === 'mock' || Boolean(getApiKey());
  return {
    provider,
    configured,
    mode: provider === 'mock' ? 'mock' : 'live',
    model: process.env.LLM_MODEL || 'deepseek/deepseek-v4-pro',
    baseURL: process.env.LLM_BASE_URL || 'https://api.modelink.ai/v1',
  };
}

/**
 * @param {{ member: object, item: object, existingPosts?: Array<{ id?: string, title?: string, content?: string, sourceUrl?: string }> }} args
 */
export async function refineNewsItem({ member, item, existingPosts = [] }) {
  const provider = providerName();
  if (provider === 'openai') {
    return refineWithOpenAI({ member, item, existingPosts });
  }
  return refineMock({ member, item, existingPosts });
}

function summarizeExistingPosts(existingPosts = []) {
  return (existingPosts || [])
    .slice(0, 25)
    .map((p, i) => ({
      i: i + 1,
      title: String(p.title || '').slice(0, 120),
      content: String(p.content || '').slice(0, 280),
      sourceUrl: String(p.sourceUrl || '').slice(0, 200),
    }))
    .filter((p) => p.title || p.content);
}

async function refineWithOpenAI({ member, item, existingPosts = [] }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('缺少 MODELINK_API_KEY / LLM_API_KEY');

  const base = (process.env.LLM_BASE_URL || 'https://api.modelink.ai/v1').replace(/\/$/, '');
  const model = process.env.LLM_MODEL || 'deepseek/deepseek-v4-pro';
  const existing = summarizeExistingPosts(existingPosts);

  const system = `你是「前沿社」会员动态编辑。根据「已抓取的页面正文」整理会员/公司动态。
规则：
1. 必须以 pageText / title 为准；搜索摘要仅供参考；禁止脑补正文没有的事实、身份或栏目名
2. 必须与会员姓名或其公司名称明确相关
3. 只保留近一个月、有明确事件节点的单篇公开信息（融资、产品发布、合作、任命、上市、活动启动、重要专访等）
4. 标题简洁客观；正文 100-300 字；不夸张、不营销、不用套话
5. 语义去重（重要）：对照 existingPosts。若候选与其中任一条是同一新闻事件（同一融资轮次/同一产品发布/同一任命等），即使媒体不同、标题措辞不同、链接不同，也必须 accepted=false，并设 sameAsExisting=true，reason 写「与已有动态同一事件」
6. 以下情况必须 accepted=false（sameAsExisting=false）：
   - 博彩/色情/刷单/无关聚合站/标题党垃圾
   - 仅因人名常见而误匹配，但公司/正文对不上
   - pageText 不足以核对是否为单篇真实报道
   - 栏目页、标签页、作者页、搜索结果、文章列表、「综合报道」合集
   - 「持续更新专栏」「定期发文」这类常青入口
7. 只输出 JSON，不要 markdown`;

  const user = JSON.stringify({
    member: {
      name: member.name,
      company: member.company,
      title: member.title,
    },
    source: {
      url: item.url,
      searchTitle: item.title,
      searchSnippet: item.snippet,
      pageTitle: item.title,
      pageText: String(item.pageText || '').slice(0, 4500),
      publishedAt: item.publishedAt || null,
    },
    existingPosts: existing,
  });

  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `${user}\n\n请返回 JSON：{"accepted":boolean,"sameAsExisting":boolean,"reason":string,"title":string,"content":string}`,
      },
    ],
  };

  // 部分兼容网关不支持 json_object，默认关闭；需要时可设 LLM_JSON_MODE=true
  if (String(process.env.LLM_JSON_MODE || '').toLowerCase() === 'true') {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM 调用失败: ${res.status} ${text.slice(0, 240)}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '{}';
  const parsed = parseJsonLoose(raw);

  const sameAsExisting = Boolean(parsed.sameAsExisting)
    || /同一事件|语义重复|已有动态/.test(String(parsed.reason || ''));
  const accepted = Boolean(parsed.accepted) && !sameAsExisting;

  return {
    accepted,
    sameAsExisting,
    reason: String(parsed.reason || ''),
    title: String(parsed.title || item.title || '').slice(0, 120),
    content: String(parsed.content || item.snippet || '').slice(0, 1200),
  };
}

function parseJsonLoose(raw) {
  const text = String(raw || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        /* fallthrough */
      }
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        /* fallthrough */
      }
    }
    throw new Error('LLM 返回非 JSON');
  }
}

function refineMock({ member, item, existingPosts = [] }) {
  const company = member.company || '相关公司';
  const name = member.name || '会员';
  const title = (item.title || '').replace(/\s+/g, ' ').trim() || `${company} 最新公开进展`;
  const titleKey = title.slice(0, 24);
  const dup = (existingPosts || []).find((p) => {
    const t = String(p.title || '');
    return titleKey && t.includes(titleKey.slice(0, 12));
  });
  if (dup) {
    return {
      accepted: false,
      sameAsExisting: true,
      reason: '与已有动态同一事件（mock）',
      title: title.slice(0, 80),
      content: '',
    };
  }
  const content = [
    `${company}（会员 ${name}）近期出现新的公开信息。`,
    (item.snippet || '').trim(),
    '该信息与会员/公司相关，建议运营审核后决定是否发布到前沿动态。',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 600);

  return {
    accepted: true,
    sameAsExisting: false,
    reason: 'mock：本地模拟通过筛选',
    title: title.slice(0, 80),
    content,
  };
}
