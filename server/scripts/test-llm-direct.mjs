import 'dotenv/config';
import { getLlmStatus, refineNewsItem } from '../src/services/llm.js';

const status = getLlmStatus();
console.log('llm status', status);

const result = await refineNewsItem({
  member: {
    name: '张三',
    company: '星河智能',
    title: '创始人',
  },
  item: {
    title: '星河智能发布新一代 AI Agent 产品',
    url: 'https://example.com/xinghe-ai-agent-2026',
    snippet:
      '星河智能今日宣布推出面向企业的新一代 AI Agent 平台，支持多工具调用与私有知识库接入，并完成新一轮战略融资。创始人张三表示将继续深耕产业落地。',
    publishedAt: new Date().toISOString(),
  },
});

console.log(JSON.stringify(result, null, 2));
