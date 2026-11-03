$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$JumpKey = Join-Path $env:USERPROFILE ".ssh\id_rsa"
$Tgz = Join-Path $PSScriptRoot "frontier-analytics-export.tgz"
$Stage = Join-Path $env:TEMP "frontier-analytics-export-pack"

if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Path $Stage | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Stage "server-pack\src\services") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Stage "server-pack\src\routes") | Out-Null

Copy-Item (Join-Path $Root "server\src\services\analytics.js") (Join-Path $Stage "server-pack\src\services\analytics.js")
Copy-Item (Join-Path $Root "server\src\routes\admin.js") (Join-Path $Stage "server-pack\src\routes\admin.js")
Copy-Item -Recurse (Join-Path $Root "admin\dist") (Join-Path $Stage "admin-dist")

Push-Location $Stage
tar -czf $Tgz admin-dist server-pack
Pop-Location

Write-Host "packed $Tgz"
scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 $Tgz ubuntu@120.92.119.154:/tmp/frontier-analytics-export.tgz

$remote = @'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
rm -rf /tmp/frontier-analytics-export-extract
mkdir -p /tmp/frontier-analytics-export-extract
tar -xzf /tmp/frontier-analytics-export.tgz -C /tmp/frontier-analytics-export-extract
cp -f /tmp/frontier-analytics-export-extract/server-pack/src/services/analytics.js "$REMOTE/src/services/analytics.js"
cp -f /tmp/frontier-analytics-export-extract/server-pack/src/routes/admin.js "$REMOTE/src/routes/admin.js"
rm -rf "$REMOTE/admin-dist"
cp -a /tmp/frontier-analytics-export-extract/admin-dist "$REMOTE/admin-dist"
grep -n "buildAnalyticsCsv\|profiles\|format === 'csv'" "$REMOTE/src/services/analytics.js" "$REMOTE/src/routes/admin.js" | head -20

# upload CDN
cd "$REMOTE"
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
  const map = { '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8' };
  return map[ext] || 'application/octet-stream';
}
const mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
const config = new qiniu.conf.Config();
config.zone = qiniu.zone.Zone_z1;
config.useCdnDomain = true;
const formUploader = new qiniu.form_up.FormUploader(config);
const putExtra = new qiniu.form_up.PutExtra();
const files = walk(distDir);
console.log('cdn_upload', files.length);
for (const f of files) {
  const key = `${prefix}${f.rel}`;
  const putPolicy = new qiniu.rs.PutPolicy({ scope: `${bucket}:${key}` });
  const token = putPolicy.uploadToken(mac);
  putExtra.mimeType = mimeOf(f.full);
  await new Promise((resolve, reject) => {
    formUploader.putFile(token, key, f.full, putExtra, (err, body, info) => {
      if (err) return reject(err);
      if (!info || info.statusCode !== 200) return reject(new Error(`${key} ${info?.statusCode}`));
      console.log('ok', key);
      resolve();
    });
  });
}
const indexUrl = `${domain}/${prefix}index.html`;
const js = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8').match(/https:\/\/[^"]+\/assets\/[^"]+\.js/);
const urls = [indexUrl];
if (js) urls.push(js[0]);
await new Promise((resolve, reject) => {
  new qiniu.cdn.CdnManager(mac).refreshUrls(urls, (err, body, info) => {
    if (err) return reject(err);
    console.log('cdn_refresh', JSON.stringify(body));
    resolve();
  });
});
NODE
node "$REMOTE/upload-admin-cdn-now.mjs"
rm -f "$REMOTE/upload-admin-cdn-now.mjs"

# restart api
if [ -f frontier-api.pid ]; then kill "$(cat frontier-api.pid)" 2>/dev/null || true; rm -f frontier-api.pid; fi
pkill -f "/home/ubuntu/apps/frontier-society/src/index.js" 2>/dev/null || true
sleep 2
for p in $(ss -lntp 2>/dev/null | grep ':3100' | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u); do kill -9 "$p" 2>/dev/null || true; done
sleep 1
export DATABASE_URL="file:$REMOTE/data/prod.db"
export ADMIN_DIST="$REMOTE/admin-dist"
export PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 3
curl -sf http://127.0.0.1:3100/api/health
echo
JS=$(grep -oE 'https://[^"]+/assets/index-[^"]+\.js' admin-dist/index.html | head -1)
curl -sf -o /dev/null -w "cdn_js=%{http_code}\n" "$JS"
echo ship_ok
'@

$remotePath = "/tmp/apply-analytics-export.sh"
$remoteBytes = [System.Text.Encoding]::UTF8.GetBytes(($remote -replace "`r`n","`n" -replace "`r","`n"))
[IO.File]::WriteAllBytes((Join-Path $env:TEMP "apply-analytics-export.sh"), $remoteBytes)
scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 (Join-Path $env:TEMP "apply-analytics-export.sh") ubuntu@120.92.119.154:/tmp/apply-analytics-export.sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -p 9922 ubuntu@120.92.119.154 "scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/frontier-analytics-export.tgz /tmp/apply-analytics-export.sh ubuntu@192.168.123.14:/tmp/ && ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash /tmp/apply-analytics-export.sh"
