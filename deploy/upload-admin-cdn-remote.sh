#!/bin/bash
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"

set -a
. ./.env.production
set +a

# write uploader inside app so ESM resolves ./node_modules/qiniu
cat > "$REMOTE/upload-admin-cdn-now.mjs" <<'NODE'
import fs from 'fs';
import path from 'path';
import qiniu from 'qiniu';

const distDir = '/home/ubuntu/apps/frontier-society/admin-dist';
const prefix = 'frontier/admin/';
const accessKey = process.env.QINIU_ACCESS_KEY;
const secretKey = process.env.QINIU_SECRET_KEY;
const bucket = process.env.QINIU_BUCKET || 'frontier-1';
const domain = String(process.env.QINIU_DOMAIN || 'https://frontier.geekpark.net').replace(/\/$/, '');
if (!accessKey || !secretKey) throw new Error('missing qiniu keys');
if (!fs.existsSync(distDir)) throw new Error('missing admin-dist');

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
  };
  return map[ext] || 'application/octet-stream';
}

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
  await new Promise((resolve, reject) => {
    formUploader.putFile(token, key, f.full, putExtra, (err, body, info) => {
      if (err) return reject(err);
      if (!info || info.statusCode !== 200) {
        return reject(new Error(`${key} => ${info?.statusCode} ${JSON.stringify(body)}`));
      }
      console.log('ok', key);
      resolve(body);
    });
  });
}

const urls = [
  `${domain}/${prefix}index.html`,
  `${domain}/${prefix}assets/index-bDQTI7u7.js`,
];
const cdnManager = new qiniu.cdn.CdnManager(mac);
await new Promise((resolve, reject) => {
  cdnManager.refreshUrls(urls, (err, body, info) => {
    if (err) return reject(err);
    if (!info || info.statusCode !== 200) {
      return reject(new Error(`cdn refresh ${info?.statusCode} ${JSON.stringify(body)}`));
    }
    console.log('cdn_refresh', JSON.stringify(body));
    resolve(body);
  });
});
console.log('upload_done');
NODE

node "$REMOTE/upload-admin-cdn-now.mjs"
rm -f "$REMOTE/upload-admin-cdn-now.mjs"

echo "===verify==="
JS=$(grep -oE 'https://[^"]+/assets/[^"]+\.js' admin-dist/index.html | head -1)
CSS=$(grep -oE 'https://[^"]+/assets/[^"]+\.css' admin-dist/index.html | head -1)
echo "js=$JS"
curl -sf -o /dev/null -w "cdn_js=%{http_code}\n" "$JS"
curl -sf -o /dev/null -w "cdn_css=%{http_code}\n" "$CSS"
# also refresh-check after short wait
sleep 2
curl -sf -o /dev/null -w "cdn_js2=%{http_code}\n" "$JS"
echo cdn_ok
