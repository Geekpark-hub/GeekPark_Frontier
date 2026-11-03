$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$JumpKey = Join-Path $env:USERPROFILE ".ssh\id_rsa"
$Tgz = Join-Path $PSScriptRoot "frontier-nick-copy.tgz"
$Stage = Join-Path $env:TEMP "frontier-nick-copy-pack"

if (-not (Test-Path (Join-Path $Root "admin\dist\index.html"))) {
  Write-Host "building admin..."
  Push-Location (Join-Path $Root "admin")
  npm run build
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "admin build failed" }
  Pop-Location
}

if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Path (Join-Path $Stage "server-pack\src\routes") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Stage "server-pack\src\middleware") -Force | Out-Null
Copy-Item (Join-Path $Root "server\src\routes\auth.js") (Join-Path $Stage "server-pack\src\routes\auth.js")
Copy-Item (Join-Path $Root "server\src\middleware\auth.js") (Join-Path $Stage "server-pack\src\middleware\auth.js")
Copy-Item -Recurse (Join-Path $Root "admin\dist") (Join-Path $Stage "admin-dist")

Push-Location $Stage
tar -czf $Tgz admin-dist server-pack
Pop-Location
Write-Host "packed $Tgz"

scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 $Tgz ubuntu@120.92.119.154:/tmp/frontier-nick-copy.tgz
if ($LASTEXITCODE -ne 0) { throw "scp to jump failed" }

$remote = @'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
rm -rf /tmp/frontier-nick-copy-extract
mkdir -p /tmp/frontier-nick-copy-extract
tar -xzf /tmp/frontier-nick-copy.tgz -C /tmp/frontier-nick-copy-extract
cp -f /tmp/frontier-nick-copy-extract/server-pack/src/routes/auth.js "$REMOTE/src/routes/auth.js"
cp -f /tmp/frontier-nick-copy-extract/server-pack/src/middleware/auth.js "$REMOTE/src/middleware/auth.js"
rm -rf "$REMOTE/admin-dist"
cp -a /tmp/frontier-nick-copy-extract/admin-dist "$REMOTE/admin-dist"
grep -n "选用微信昵称" "$REMOTE/src/routes/auth.js" | head -3

cd "$REMOTE"
set -a
. ./.env.production
set +a

cat > "$REMOTE/upload-admin-cdn-now.mjs" <<'NODE'
import fs from 'fs';
import path from 'path';
import qiniu from 'qiniu';
const distDir = '/home/ubuntu/apps/frontier-society/admin-dist';
const prefix = 'frontier/admin/v2/';
const mac = new qiniu.auth.digest.Mac(process.env.QINIU_ACCESS_KEY, process.env.QINIU_SECRET_KEY);
const bucket = process.env.QINIU_BUCKET || 'frontier-1';
const domain = String(process.env.QINIU_DOMAIN || 'https://frontier.geekpark.net').replace(/\/$/, '');
const config = new qiniu.conf.Config(); config.zone = qiniu.zone.Zone_z1; config.useCdnDomain = true;
const up = new qiniu.form_up.FormUploader(config);
const extra = new qiniu.form_up.PutExtra();
function walk(dir, base=dir){const o=[];for(const n of fs.readdirSync(dir)){const f=path.join(dir,n);const st=fs.statSync(f);if(st.isDirectory())o.push(...walk(f,base));else o.push({full:f,rel:path.relative(base,f).split(path.sep).join('/')});}return o;}
const files = walk(distDir);
console.log('cdn_upload', files.length, 'prefix', prefix);
for (const f of files) {
  const key = prefix + f.rel;
  const token = new qiniu.rs.PutPolicy({ scope: `${bucket}:${key}` }).uploadToken(mac);
  extra.mimeType = ({'.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8'})[path.extname(f.full).toLowerCase()] || 'application/octet-stream';
  await new Promise((resolve,reject)=>up.putFile(token,key,f.full,extra,(e,b,i)=>{if(e||!i||i.statusCode!==200)return reject(e||new Error(String(i&&i.statusCode)));console.log('ok',key);resolve();}));
}
const urls = files.map((f) => `${domain}/${prefix}${f.rel}`);
await new Promise((resolve,reject)=>new qiniu.cdn.CdnManager(mac).refreshUrls(urls, (e,b,i)=>{if(e)return reject(e);console.log('cdn_refresh',JSON.stringify(b));resolve();}));
NODE
node "$REMOTE/upload-admin-cdn-now.mjs"
rm -f "$REMOTE/upload-admin-cdn-now.mjs"

if [ -f frontier-api.pid ]; then kill "$(cat frontier-api.pid)" 2>/dev/null || true; rm -f frontier-api.pid; fi
pkill -f "/home/ubuntu/apps/frontier-society/src/index.js" 2>/dev/null || true
sleep 2
for p in $(ss -lntp 2>/dev/null | grep ':3100' | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u); do kill -9 "$p" 2>/dev/null || true; done
sleep 1
export ADMIN_DIST="$REMOTE/admin-dist"
export PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 3
curl -sf http://127.0.0.1:3100/api/health >/dev/null && echo health_ok
echo ship_nick_copy_ok
'@

$sh = Join-Path $env:TEMP "apply-nick-copy.sh"
[IO.File]::WriteAllText($sh, ($remote -replace "`r`n","`n" -replace "`r","`n"), (New-Object System.Text.UTF8Encoding $false))
scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 $sh ubuntu@120.92.119.154:/tmp/apply-nick-copy.sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -p 9922 ubuntu@120.92.119.154 "scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/frontier-nick-copy.tgz /tmp/apply-nick-copy.sh ubuntu@192.168.123.14:/tmp/ && ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash /tmp/apply-nick-copy.sh"
