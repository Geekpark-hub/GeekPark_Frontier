/**
 * Node 16（Ubuntu 18.04）无全局 fetch；为搜索/LLM/飞书等补齐。
 * Node 18+ 自带 fetch 时不覆盖。
 */
import { createRequire } from 'module';

if (typeof globalThis.fetch !== 'function') {
  const require = createRequire(import.meta.url);
  const fetch = require('node-fetch');
  globalThis.fetch = fetch;
  globalThis.Headers = fetch.Headers;
  globalThis.Request = fetch.Request;
  globalThis.Response = fetch.Response;
}
