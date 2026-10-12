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

export async function refineNewsItem({ member, item }) {
  const provider = providerName();
  if (provider === 'openai') {
    return refineWithOpenAI({ member, item });
  }
  return refineMock({ member, item });
}

async function refineWithOpenAI({ member, item }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('缺少 MODELINK_API_KEY / LLM_API_KEY');

  const base = (process.env.LLM_BASE_URL || 'https://api.modelink.ai/v1').replace(/\/$/, '');
  const model = process.env.LLM_MODEL || 'deepseek/deepseek-v4-pro';

  const system = `你是「前沿社」会员动态编辑。根据公开信息整理会员/公司动态。
规则：
1. 必须与会员姓名或其公司名称明确相关；正文/标题里应能对上公司名或人名
2. 只保留近一个月、值得会员关注的重要公开信息（融资、产品、合作、任命、上市、重要采访等）
3. 标题简洁客观；正文 100-300 字；不夸张、不营销、不用套话
4. 以下情况必须 accepted=false：
   - 博彩/色情/刷单/无关聚合站/标题党垃圾
   - 仅因人名常见而误匹配（如张三、李四）但公司对不上
   - 信息不足以核对来源是否真实
5. 只输出 JSON，不要 markdown`;

  const user = JSON.stringify({
    member: {
      name: member.name,
      company: member.company,
      title: member.title,
    },
    source: item,
  });

  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `${user}\n\n请返回 JSON：{"accepted":boolean,"reason":string,"title":string,"content":string}`,
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

  return {
    accepted: Boolean(parsed.accepted),
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

function refineMock({ member, item }) {
  const company = member.company || '相关公司';
  const name = member.name || '会员';
  const title = (item.title || '').replace(/\s+/g, ' ').trim() || `${company} 最新公开进展`;
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
    reason: 'mock：本地模拟通过筛选',
    title: title.slice(0, 80),
    content,
  };
}
