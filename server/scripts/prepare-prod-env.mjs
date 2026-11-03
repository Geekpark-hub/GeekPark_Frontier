import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const envPath = path.join(serverRoot, '.env');
const outPath = path.join(serverRoot, '.env.production');

const raw = fs.readFileSync(envPath, 'utf8');
const map = {};
for (const line of raw.split(/\r?\n/)) {
  if (!line || line.trim().startsWith('#')) continue;
  const i = line.indexOf('=');
  if (i < 0) continue;
  const k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  map[k] = v;
}

const jwt = crypto.randomBytes(32).toString('hex');
const lines = [
  'NODE_ENV=production',
  'PORT=3100',
  'DATABASE_URL=file:/data/prod.db',
  'ADMIN_DIST=/app/admin-dist',
  `JWT_SECRET=${jwt}`,
  'ALLOW_MOCK_LOGIN=false',
  'ENABLE_JOBS=true',
  `WX_APPID=${map.WX_APPID || ''}`,
  `WX_SECRET=${map.WX_SECRET || ''}`,
  `FEISHU_WEBHOOK_URL=${map.FEISHU_WEBHOOK_URL || ''}`,
  `QINIU_ACCESS_KEY=${map.QINIU_ACCESS_KEY || ''}`,
  `QINIU_SECRET_KEY=${map.QINIU_SECRET_KEY || ''}`,
  `QINIU_BUCKET=${map.QINIU_BUCKET || 'frontier-1'}`,
  `QINIU_DOMAIN=${map.QINIU_DOMAIN || 'https://frontier.geekpark.net'}`,
  `QINIU_ZONE=${map.QINIU_ZONE || 'z1'}`,
  `QINIU_PREFIX=${map.QINIU_PREFIX || 'frontier/'}`,
  `SEARCH_PROVIDER=${map.SEARCH_PROVIDER || 'serper'}`,
  `SERPER_API_KEY=${map.SERPER_API_KEY || ''}`,
  `LLM_PROVIDER=${map.LLM_PROVIDER || 'openai'}`,
  `LLM_BASE_URL=${map.LLM_BASE_URL || ''}`,
  `LLM_MODEL=${map.LLM_MODEL || ''}`,
  `MODELINK_API_KEY=${map.MODELINK_API_KEY || ''}`,
];

fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
console.log('wrote', outPath);
console.log('keys', lines.map((l) => l.split('=')[0]).join(','));
