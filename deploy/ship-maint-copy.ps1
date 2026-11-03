$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$JumpKey = Join-Path $env:USERPROFILE ".ssh\id_rsa"
$Tgz = Join-Path $PSScriptRoot "frontier-maint-copy.tgz"
$Stage = Join-Path $env:TEMP "frontier-maint-copy-pack"
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Path (Join-Path $Stage "server-pack\src\jobs") -Force | Out-Null
Copy-Item (Join-Path $Root "server\src\jobs\maintenance.js") (Join-Path $Stage "server-pack\src\jobs\maintenance.js")
Copy-Item -Recurse (Join-Path $Root "admin\dist") (Join-Path $Stage "admin-dist")
Push-Location $Stage
tar -czf $Tgz admin-dist server-pack
Pop-Location
scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 $Tgz ubuntu@120.92.119.154:/tmp/frontier-maint-copy.tgz
$remote = @'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
rm -rf /tmp/frontier-maint-copy-extract
mkdir -p /tmp/frontier-maint-copy-extract
tar -xzf /tmp/frontier-maint-copy.tgz -C /tmp/frontier-maint-copy-extract
cp -f /tmp/frontier-maint-copy-extract/server-pack/src/jobs/maintenance.js "$REMOTE/src/jobs/maintenance.js"
rm -rf "$REMOTE/admin-dist"
cp -a /tmp/frontier-maint-copy-extract/admin-dist "$REMOTE/admin-dist"
grep -n "状态改为已过期\|名词说明\|未推送" src/jobs/maintenance.js | head -15
set -a; . ./.env.production; set +a
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
function walk(dir, base=dir){const o=[];for(const n of fs.readdirSync(dir)){const f=path.join(dir,n);const st=fs.statSync(f);if(st.isDirectory())o.push(...walk(f,base));else o.push({full:f,rel:path.relative(base,f).split(path.sep).join('/')});}return o;}
for (const f of walk(distDir)) {
  const key = prefix + f.rel;
  const token = new qiniu.rs.PutPolicy({ scope: `${bucket}:${key}` }).uploadToken(mac);
  extra.mimeType = ({'.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8'})[path.extname(f.full).toLowerCase()] || 'application/octet-stream';
  await new Promise((resolve,reject)=>up.putFile(token,key,f.full,extra,(e,b,i)=>{if(e||!i||i.statusCode!==200)return reject(e||new Error(String(i&&i.statusCode)));console.log('ok',key);resolve();}));
}
const indexUrl = `${domain}/${prefix}index.html`;
const js = fs.readFileSync(path.join(distDir,'index.html'),'utf8').match(/https:\/\/[^"]+\/assets\/[^"]+\.js/);
await new Promise((resolve,reject)=>new qiniu.cdn.CdnManager(mac).refreshUrls([indexUrl, ...(js?[js[0]]:[])], (e,b,i)=>{if(e)return reject(e);console.log('cdn_refresh',JSON.stringify(b));resolve();}));
NODE
node "$REMOTE/upload-admin-cdn-now.mjs"
rm -f "$REMOTE/upload-admin-cdn-now.mjs"
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
curl -sf http://127.0.0.1:3100/api/health >/dev/null && echo health_ok
echo ship_ok
'@
$sh = Join-Path $env:TEMP "apply-maint-copy.sh"
[IO.File]::WriteAllText($sh, ($remote -replace "`r`n","`n" -replace "`r","`n"), (New-Object System.Text.UTF8Encoding $false))
scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 $sh ubuntu@120.92.119.154:/tmp/apply-maint-copy.sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -p 9922 ubuntu@120.92.119.154 "scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/frontier-maint-copy.tgz /tmp/apply-maint-copy.sh ubuntu@192.168.123.14:/tmp/ && ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash /tmp/apply-maint-copy.sh"
