$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$JumpKey = Join-Path $env:USERPROFILE ".ssh\id_rsa"
$Tgz = Join-Path $PSScriptRoot "frontier-pending-nick.tgz"
$Stage = Join-Path $env:TEMP "frontier-pending-nick-pack"

Write-Host "building admin..."
Push-Location (Join-Path $Root "admin")
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "admin build failed" }
Pop-Location

if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Path (Join-Path $Stage "server-pack\src\routes") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Stage "server-pack\src\middleware") -Force | Out-Null
Copy-Item (Join-Path $Root "server\src\routes\auth.js") (Join-Path $Stage "server-pack\src\routes\auth.js")
Copy-Item (Join-Path $Root "server\src\routes\feed.js") (Join-Path $Stage "server-pack\src\routes\feed.js")
Copy-Item (Join-Path $Root "server\src\routes\events.js") (Join-Path $Stage "server-pack\src\routes\events.js")
Copy-Item (Join-Path $Root "server\src\routes\polls.js") (Join-Path $Stage "server-pack\src\routes\polls.js")
Copy-Item (Join-Path $Root "server\src\routes\analytics.js") (Join-Path $Stage "server-pack\src\routes\analytics.js")
Copy-Item (Join-Path $Root "server\src\middleware\auth.js") (Join-Path $Stage "server-pack\src\middleware\auth.js")
Copy-Item -Recurse (Join-Path $Root "admin\dist") (Join-Path $Stage "admin-dist")

Push-Location $Stage
tar -czf $Tgz server-pack admin-dist
Pop-Location
Write-Host "packed $Tgz"

scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 $Tgz ubuntu@120.92.119.154:/tmp/frontier-pending-nick.tgz

$remote = @'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
rm -rf /tmp/frontier-pending-nick-extract
mkdir -p /tmp/frontier-pending-nick-extract
tar -xzf /tmp/frontier-pending-nick.tgz -C /tmp/frontier-pending-nick-extract
cp -f /tmp/frontier-pending-nick-extract/server-pack/src/routes/auth.js "$REMOTE/src/routes/auth.js"
cp -f /tmp/frontier-pending-nick-extract/server-pack/src/routes/feed.js "$REMOTE/src/routes/feed.js"
cp -f /tmp/frontier-pending-nick-extract/server-pack/src/routes/events.js "$REMOTE/src/routes/events.js"
cp -f /tmp/frontier-pending-nick-extract/server-pack/src/routes/polls.js "$REMOTE/src/routes/polls.js"
cp -f /tmp/frontier-pending-nick-extract/server-pack/src/routes/analytics.js "$REMOTE/src/routes/analytics.js"
cp -f /tmp/frontier-pending-nick-extract/server-pack/src/middleware/auth.js "$REMOTE/src/middleware/auth.js"
rm -rf "$REMOTE/admin-dist"
cp -a /tmp/frontier-pending-nick-extract/admin-dist "$REMOTE/admin-dist"

cd "$REMOTE"
set -a; . ./.env.production; set +a
export DATABASE_URL="file:$REMOTE/data/prod.db"

cat > "$REMOTE/upload-admin-cdn-now.mjs" <<'NODE'
import fs from 'fs';
import path from 'path';
import qiniu from 'qiniu';
const distDir = '/home/ubuntu/apps/frontier-society/admin-dist';
const prefix = 'frontier/admin/';
const mac = new qiniu.auth.digest.Mac(process.env.QINIU_ACCESS_KEY, process.env.QINIU_SECRET_KEY);
const bucket = process.env.QINIU_BUCKET || 'frontier-1';
const domain = String(process.env.QINIU_DOMAIN || 'https://frontier.geekpark.net').replace(/\/$/, '');
const config = new qiniu.conf.Config(); config.zone = qiniu.zone.Zone_z1; config.useCdnDomain = true;
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
for (const f of walk(distDir)) {
  const key = prefix + f.rel;
  const token = new qiniu.rs.PutPolicy({ scope: bucket + ':' + key }).uploadToken(mac);
  const extra = new qiniu.form_up.PutExtra();
  extra.mimeType = mimeOf(f.full);
  await new Promise((resolve, reject) => {
    up.putFile(token, key, f.full, extra, (err, body, info) => {
      if (err || !info || info.statusCode !== 200) return reject(err || new Error(key + ' ' + info?.statusCode));
      console.log('ok', key, extra.mimeType); resolve();
    });
  });
}
const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const urls = [domain + '/' + prefix + 'index.html', ...[...html.matchAll(/https:\/\/[^"]+\/frontier\/admin\/assets\/[^"]+/g)].map((m) => m[0])];
await new Promise((resolve, reject) => {
  new qiniu.cdn.CdnManager(mac).refreshUrls([...new Set(urls)], (e, b) => (e ? reject(e) : (console.log('cdn_refresh', JSON.stringify(b)), resolve())));
});
NODE
node "$REMOTE/upload-admin-cdn-now.mjs"
rm -f "$REMOTE/upload-admin-cdn-now.mjs"

if [ -f frontier-api.pid ]; then kill "$(cat frontier-api.pid)" 2>/dev/null || true; rm -f frontier-api.pid; fi
pkill -f "/home/ubuntu/apps/frontier-society/src/index.js" 2>/dev/null || true
sleep 2
for pid in $(ss -lntp 2>/dev/null | grep ':3100' | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u); do kill -9 "$pid" 2>/dev/null || true; done
sleep 1
export ADMIN_DIST="$REMOTE/admin-dist" PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 3
curl -sf http://127.0.0.1:3100/api/health >/dev/null && echo health_ok
grep -n "bind-wx-nick\|signVisitorToken\|requireMemberOrVisitor" src/routes/auth.js src/middleware/auth.js | head -20
echo ship_ok
'@

$sh = Join-Path $env:TEMP "apply-pending-nick.sh"
[IO.File]::WriteAllText($sh, ($remote -replace "`r`n","`n" -replace "`r","`n"), (New-Object System.Text.UTF8Encoding $false))
scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 $sh ubuntu@120.92.119.154:/tmp/apply-pending-nick.sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -p 9922 ubuntu@120.92.119.154 "scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/frontier-pending-nick.tgz /tmp/apply-pending-nick.sh ubuntu@192.168.123.14:/tmp/ && ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash /tmp/apply-pending-nick.sh"
