$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$JumpKey = Join-Path $env:USERPROFILE ".ssh\id_rsa"
$Tgz = Join-Path $PSScriptRoot "frontier-wx-entries.tgz"
$Stage = Join-Path $env:TEMP "frontier-wx-entries-pack"

Write-Host "building admin..."
Push-Location (Join-Path $Root "admin")
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "admin build failed" }
Pop-Location

if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Path (Join-Path $Stage "server-pack\src\routes") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Stage "server-pack\src\services") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Stage "server-pack\prisma") -Force | Out-Null
Copy-Item (Join-Path $Root "server\src\routes\auth.js") (Join-Path $Stage "server-pack\src\routes\auth.js")
Copy-Item (Join-Path $Root "server\src\routes\admin.js") (Join-Path $Stage "server-pack\src\routes\admin.js")
Copy-Item (Join-Path $Root "server\src\menus.js") (Join-Path $Stage "server-pack\src\menus.js")
Copy-Item (Join-Path $Root "server\src\services\analytics.js") (Join-Path $Stage "server-pack\src\services\analytics.js")
Copy-Item (Join-Path $Root "server\prisma\schema.prisma") (Join-Path $Stage "server-pack\prisma\schema.prisma")
Copy-Item -Recurse (Join-Path $Root "admin\dist") (Join-Path $Stage "admin-dist")

Push-Location $Stage
tar -czf $Tgz server-pack admin-dist
Pop-Location
Write-Host "packed $Tgz"

scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 $Tgz ubuntu@120.92.119.154:/tmp/frontier-wx-entries.tgz

$remote = @'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
rm -rf /tmp/frontier-wx-entries-extract
mkdir -p /tmp/frontier-wx-entries-extract
tar -xzf /tmp/frontier-wx-entries.tgz -C /tmp/frontier-wx-entries-extract
cp -f /tmp/frontier-wx-entries-extract/server-pack/src/routes/auth.js "$REMOTE/src/routes/auth.js"
cp -f /tmp/frontier-wx-entries-extract/server-pack/src/routes/admin.js "$REMOTE/src/routes/admin.js"
cp -f /tmp/frontier-wx-entries-extract/server-pack/src/menus.js "$REMOTE/src/menus.js"
cp -f /tmp/frontier-wx-entries-extract/server-pack/src/services/analytics.js "$REMOTE/src/services/analytics.js"
cp -f /tmp/frontier-wx-entries-extract/server-pack/prisma/schema.prisma "$REMOTE/prisma/schema.prisma"
rm -rf "$REMOTE/admin-dist"
cp -a /tmp/frontier-wx-entries-extract/admin-dist "$REMOTE/admin-dist"

cd "$REMOTE"
set -a
. ./.env.production
set +a
export DATABASE_URL="file:$REMOTE/data/prod.db"

node --input-type=module <<'NODE'
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function addCol(sql, label) {
  try {
    await p.$executeRawUnsafe(sql);
    console.log(label + '_added');
  } catch (e) {
    const msg = String(e?.message || e);
    if (/duplicate column|already exists/i.test(msg)) console.log(label + '_exists');
    else throw e;
  }
}
await addCol("ALTER TABLE Member ADD COLUMN wxNickname TEXT NOT NULL DEFAULT ''", 'wxNickname');
await addCol('ALTER TABLE Member ADD COLUMN wxNickAskedAt DATETIME', 'wxNickAskedAt');
await addCol("ALTER TABLE Member ADD COLUMN wxNickResult TEXT NOT NULL DEFAULT ''", 'wxNickResult');
await p.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS WxEntry (
  id TEXT PRIMARY KEY NOT NULL,
  openid TEXT NOT NULL,
  wxNickname TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  nickAskedAt DATETIME,
  status TEXT NOT NULL DEFAULT 'pending',
  boundMemberId TEXT,
  boundAt DATETIME,
  firstSeenAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lastSeenAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
await addCol("ALTER TABLE WxEntry ADD COLUMN phone TEXT NOT NULL DEFAULT ''", 'WxEntry.phone');
await p.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS WxEntry_openid_key ON WxEntry(openid)');
console.log('WxEntry_ok');
await p.$disconnect();
NODE

npx prisma generate

# 同步 admin-dist 到七牛，否则 index 指向 CDN 新 hash 会 404 白屏
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
const extra = new qiniu.form_up.PutExtra();
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
const files = walk(distDir);
console.log('cdn_upload', files.length);
for (const f of files) {
  const key = prefix + f.rel;
  const token = new qiniu.rs.PutPolicy({ scope: bucket + ':' + key }).uploadToken(mac);
  await new Promise((resolve, reject) => {
    up.putFile(token, key, f.full, extra, (err, body, info) => {
      if (err || !info || info.statusCode !== 200) return reject(err || new Error(key + ' ' + info?.statusCode));
      console.log('ok', key); resolve();
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
export ADMIN_DIST="$REMOTE/admin-dist"
export PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 3
curl -sf http://127.0.0.1:3100/api/health >/dev/null && echo health_ok
grep -n "wx-entries\|touchWxEntry\|wx-entry-profile" src/routes/auth.js src/routes/admin.js src/menus.js | head -20
test -f "$REMOTE/admin-dist/index.html" && echo admin_dist_ok
echo ship_ok
'@

$sh = Join-Path $env:TEMP "apply-wx-entries.sh"
[IO.File]::WriteAllText($sh, ($remote -replace "`r`n","`n" -replace "`r","`n"), (New-Object System.Text.UTF8Encoding $false))
scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 $sh ubuntu@120.92.119.154:/tmp/apply-wx-entries.sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -p 9922 ubuntu@120.92.119.154 "scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/frontier-wx-entries.tgz /tmp/apply-wx-entries.sh ubuntu@192.168.123.14:/tmp/ && ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash /tmp/apply-wx-entries.sh"
