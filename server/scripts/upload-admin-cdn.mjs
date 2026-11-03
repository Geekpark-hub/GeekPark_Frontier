/**
 * 把 admin/dist 上传到七牛：frontier/admin/
 * 用法（在 server 目录）：node scripts/upload-admin-cdn.mjs
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import qiniu from 'qiniu';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../admin/dist');
const prefix = 'frontier/admin/';

function walk(dir, base = dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walk(full, base));
    else out.push({ full, rel: path.relative(base, full).split(path.sep).join('/') });
  }
  return out;
}

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json',
  };
  return map[ext] || 'application/octet-stream';
}

async function main() {
  if (!fs.existsSync(distDir)) {
    throw new Error(`缺少构建产物: ${distDir}，请先 npm run build`);
  }
  const accessKey = process.env.QINIU_ACCESS_KEY;
  const secretKey = process.env.QINIU_SECRET_KEY;
  const bucket = process.env.QINIU_BUCKET || 'frontier-1';
  const domain = String(process.env.QINIU_DOMAIN || 'https://frontier.geekpark.net').replace(/\/$/, '');
  if (!accessKey || !secretKey) throw new Error('缺少七牛密钥');

  const mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
  const config = new qiniu.conf.Config();
  config.zone = qiniu.zone.Zone_z1;
  config.useCdnDomain = true;
  const formUploader = new qiniu.form_up.FormUploader(config);
  const putExtra = new qiniu.form_up.PutExtra();

  const files = walk(distDir);
  console.log(`upload ${files.length} files -> ${domain}/${prefix}`);

  for (const f of files) {
    const key = `${prefix}${f.rel}`;
    const putPolicy = new qiniu.rs.PutPolicy({ scope: `${bucket}:${key}` });
    const token = putPolicy.uploadToken(mac);
    putExtra.mimeType = mimeOf(f.full);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve, reject) => {
      formUploader.putFile(token, key, f.full, putExtra, (err, body, info) => {
        if (err) return reject(err);
        if (!info || info.statusCode !== 200) {
          return reject(new Error(`${key} => ${info?.statusCode} ${JSON.stringify(body)}`));
        }
        console.log('✓', key);
        resolve(body);
      });
    });
  }
  const indexUrl = `${domain}/${prefix}index.html`;
  const cdnManager = new qiniu.cdn.CdnManager(mac);
  await new Promise((resolve, reject) => {
    cdnManager.refreshUrls([indexUrl], (err, body, info) => {
      if (err) return reject(err);
      if (!info || info.statusCode !== 200) {
        return reject(new Error(`cdn refresh ${info?.statusCode} ${JSON.stringify(body)}`));
      }
      console.log('cdn refresh', indexUrl, JSON.stringify(body));
      resolve(body);
    });
  });
  console.log('done. sample:', indexUrl);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
