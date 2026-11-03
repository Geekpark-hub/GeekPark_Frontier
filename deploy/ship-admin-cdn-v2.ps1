$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$JumpKey = Join-Path $env:USERPROFILE ".ssh\id_rsa"
$Tgz = Join-Path $PSScriptRoot "frontier-admin-cdn-v2.tgz"
$Stage = Join-Path $env:TEMP "frontier-admin-cdn-v2-pack"

Write-Host "building admin (API-host SPA + CDN assets)..."
Push-Location (Join-Path $Root "admin")
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "admin build failed" }
Pop-Location

$index = Get-Content (Join-Path $Root "admin\dist\index.html") -Raw
if ($index -notmatch "frontier/admin/v2/") {
  throw "build index.html missing frontier/admin/v2/ base"
}
Write-Host "index ok (CDN asset base)"

if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Path $Stage -Force | Out-Null
Copy-Item -Recurse (Join-Path $Root "admin\dist") (Join-Path $Stage "admin-dist")
Push-Location $Stage
tar -czf $Tgz admin-dist
Pop-Location
Write-Host "packed $Tgz"

scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 $Tgz ubuntu@120.92.119.154:/tmp/frontier-admin-cdn-v2.tgz
if ($LASTEXITCODE -ne 0) { throw "scp failed" }

$remote = @'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
rm -rf /tmp/frontier-admin-cdn-v2-extract
mkdir -p /tmp/frontier-admin-cdn-v2-extract
tar -xzf /tmp/frontier-admin-cdn-v2.tgz -C /tmp/frontier-admin-cdn-v2-extract
rm -rf "$REMOTE/admin-dist"
cp -a /tmp/frontier-admin-cdn-v2-extract/admin-dist "$REMOTE/admin-dist"
grep -q 'frontier/admin/v2/' "$REMOTE/admin-dist/index.html"

cd "$REMOTE"
# 宿主机路径，禁止 /app/admin-dist（那是容器路径，会导致页面 接口不存在）
if grep -q '^ADMIN_DIST=' .env.production 2>/dev/null; then
  sed -i 's|^ADMIN_DIST=.*|ADMIN_DIST=/home/ubuntu/apps/frontier-society/admin-dist|' .env.production
else
  echo 'ADMIN_DIST=/home/ubuntu/apps/frontier-society/admin-dist' >> .env.production
fi
set -a; . ./.env.production; set +a
export ADMIN_DIST=/home/ubuntu/apps/frontier-society/admin-dist

cat > "$REMOTE/upload-admin-cdn-v2.mjs" <<'NODE'
import fs from 'fs';
import path from 'path';
import qiniu from 'qiniu';

const distDir = '/home/ubuntu/apps/frontier-society/admin-dist';
const prefix = 'frontier/admin/v2/';
const mac = new qiniu.auth.digest.Mac(process.env.QINIU_ACCESS_KEY, process.env.QINIU_SECRET_KEY);
const bucket = process.env.QINIU_BUCKET || 'frontier-1';
const domain = String(process.env.QINIU_DOMAIN || 'https://frontier.geekpark.net').replace(/\/$/, '');
const config = new qiniu.conf.Config();
config.zone = qiniu.zone.Zone_z1;
config.useCdnDomain = true;
const up = new qiniu.form_up.FormUploader(config);

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

const files = walk(distDir);
console.log('cdn_upload', files.length, 'prefix', prefix);
for (const f of files) {
  const key = prefix + f.rel;
  const token = new qiniu.rs.PutPolicy({ scope: `${bucket}:${key}` }).uploadToken(mac);
  const extra = new qiniu.form_up.PutExtra();
  extra.mimeType = mimeOf(f.full);
  await new Promise((resolve, reject) => {
    up.putFile(token, key, f.full, extra, (err, body, info) => {
      if (err || !info || info.statusCode !== 200) {
        return reject(err || new Error(`${key} ${info?.statusCode}`));
      }
      console.log('ok', key);
      resolve();
    });
  });
}
const urls = files.map((f) => `${domain}/${prefix}${f.rel}`);
await new Promise((resolve, reject) => {
  new qiniu.cdn.CdnManager(mac).refreshUrls([...new Set(urls)].slice(0, 120), (e, b) => {
    if (e) return reject(e);
    console.log('cdn_refresh', JSON.stringify(b));
    resolve();
  });
});
NODE
node "$REMOTE/upload-admin-cdn-v2.mjs"
rm -f "$REMOTE/upload-admin-cdn-v2.mjs"

if [ -f frontier-api.pid ]; then kill "$(cat frontier-api.pid)" 2>/dev/null || true; rm -f frontier-api.pid; fi
pkill -f "/home/ubuntu/apps/frontier-society/src/index.js" 2>/dev/null || true
sleep 2
for p in $(ss -lntp 2>/dev/null | grep ':3100' | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u); do kill -9 "$p" 2>/dev/null || true; done
sleep 1
export ADMIN_DIST=/home/ubuntu/apps/frontier-society/admin-dist
export PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 3
curl -sf http://127.0.0.1:3100/api/health >/dev/null && echo health_ok
code=$(curl -sS -o /tmp/login.html -w '%{http_code}' -H 'Accept: text/html' http://127.0.0.1:3100/login)
echo "login_local:$code"
grep -q '<div id="app">' /tmp/login.html
echo ship_admin_cdn_v2_ok
echo entry https://frontier-api.geekpark.net/login
'@

$sh = Join-Path $env:TEMP "apply-admin-cdn-v2.sh"
[IO.File]::WriteAllText($sh, ($remote -replace "`r`n","`n" -replace "`r","`n"), (New-Object System.Text.UTF8Encoding $false))
scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 $sh ubuntu@120.92.119.154:/tmp/apply-admin-cdn-v2.sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -p 9922 ubuntu@120.92.119.154 "scp -o BatchMode=yes /tmp/frontier-admin-cdn-v2.tgz /tmp/apply-admin-cdn-v2.sh ubuntu@192.168.123.14:/tmp/ && ssh -o BatchMode=yes ubuntu@192.168.123.14 bash /tmp/apply-admin-cdn-v2.sh"
