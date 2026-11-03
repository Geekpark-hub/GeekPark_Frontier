#!/bin/bash
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"

cp -f /tmp/maintenance.js src/jobs/maintenance.js
rm -rf admin-dist
tar -xzf /tmp/admin-dist-maint.tgz -C "$REMOTE"
# tarball should contain admin-dist/
if [ ! -d admin-dist ]; then
  mkdir -p admin-dist
  tar -xzf /tmp/admin-dist-maint.tgz -C admin-dist
fi
ls admin-dist/index.html
grep -n "状态改为已过期\|名词说明\|未推送" src/jobs/maintenance.js | head -12

set -a
. ./.env.production
set +a

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
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}
const mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
const config = new qiniu.conf.Config();
config.zone = qiniu.zone.Zone_z1;
config.useCdnDomain = true;
const formUploader = new qiniu.form_up.FormUploader(config);
const putExtra = new qiniu.form_up.PutExtra();
for (const f of walk(distDir)) {
  const key = prefix + f.rel;
  const token = new qiniu.rs.PutPolicy({ scope: bucket + ':' + key }).uploadToken(mac);
  putExtra.mimeType = mimeOf(f.full);
  await new Promise((resolve, reject) => {
    formUploader.putFile(token, key, f.full, putExtra, (err, body, info) => {
      if (err) return reject(err);
      if (!info || info.statusCode !== 200) return reject(new Error(key + ' ' + (info && info.statusCode)));
      console.log('ok', key);
      resolve();
    });
  });
}
const indexUrl = domain + '/' + prefix + 'index.html';
const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const m = html.match(/https:\/\/[^"]+\/assets\/[^"]+\.js/);
const urls = [indexUrl];
if (m) urls.push(m[0]);
await new Promise((resolve, reject) => {
  new qiniu.cdn.CdnManager(mac).refreshUrls(urls, (err, body) => {
    if (err) return reject(err);
    console.log('cdn_refresh', JSON.stringify(body));
    resolve();
  });
});
NODE
node "$REMOTE/upload-admin-cdn-now.mjs"
rm -f "$REMOTE/upload-admin-cdn-now.mjs"

if [ -f frontier-api.pid ]; then kill "$(cat frontier-api.pid)" 2>/dev/null || true; rm -f frontier-api.pid; fi
pkill -f "/home/ubuntu/apps/frontier-society/src/index.js" 2>/dev/null || true
sleep 2
for p in $(ss -lntp 2>/dev/null | grep ':3100' | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u); do
  kill -9 "$p" 2>/dev/null || true
done
sleep 1
export DATABASE_URL="file:$REMOTE/data/prod.db"
export ADMIN_DIST="$REMOTE/admin-dist"
export PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 3
curl -sf http://127.0.0.1:3100/api/health >/dev/null && echo health_ok
echo ship_ok
