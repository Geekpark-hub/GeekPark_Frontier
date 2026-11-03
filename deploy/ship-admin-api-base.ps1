$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$JumpKey = Join-Path $env:USERPROFILE ".ssh\id_rsa"
$Tgz = Join-Path $PSScriptRoot "frontier-admin-api-base.tgz"
$Stage = Join-Path $env:TEMP "frontier-admin-api-base-pack"

Write-Host "building admin..."
Push-Location (Join-Path $Root "admin")
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "admin build failed" }
Pop-Location

$entry = Get-ChildItem (Join-Path $Root "admin\dist\assets\index-*.js") | Where-Object { $_.Length -gt 50000 } | Select-Object -First 1
if (-not $entry) { throw "missing index bundle" }
$bundleText = [IO.File]::ReadAllText($entry.FullName)
if ($bundleText -notmatch "frontier-api\.geekpark\.net") { throw "built bundle missing VITE_API_BASE host" }
Write-Host ("bundle ok: " + $entry.Name)

if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Path $Stage -Force | Out-Null
Copy-Item -Recurse (Join-Path $Root "admin\dist") (Join-Path $Stage "admin-dist")
Push-Location $Stage
tar -czf $Tgz admin-dist
Pop-Location
Write-Host "packed $Tgz"

scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 $Tgz ubuntu@120.92.119.154:/tmp/frontier-admin-api-base.tgz
if ($LASTEXITCODE -ne 0) { throw "scp failed" }

$remote = @'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
rm -rf /tmp/frontier-admin-api-base-extract
mkdir -p /tmp/frontier-admin-api-base-extract
tar -xzf /tmp/frontier-admin-api-base.tgz -C /tmp/frontier-admin-api-base-extract
rm -rf "$REMOTE/admin-dist"
cp -a /tmp/frontier-admin-api-base-extract/admin-dist "$REMOTE/admin-dist"
grep -q "frontier-api.geekpark.net" "$REMOTE/admin-dist"/assets/index-*.js

cd "$REMOTE"
set -a; . ./.env.production; set +a

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
const indexFile = path.join(distDir, 'index.html');
for (const key of [prefix.slice(0, -1), prefix]) {
  const token = new qiniu.rs.PutPolicy({ scope: `${bucket}:${key}` }).uploadToken(mac);
  extra.mimeType = 'text/html; charset=utf-8';
  await new Promise((resolve,reject)=>up.putFile(token,key,indexFile,extra,(e,b,i)=>{if(e||!i||i.statusCode!==200)return reject(e||new Error(String(i&&i.statusCode)));console.log('ok',key);resolve();}));
}
const urls = files.map((f) => `${domain}/${prefix}${f.rel}`);
urls.push(`${domain}/frontier/admin/v2/`, `${domain}/frontier/admin/v2`, `${domain}/frontier/admin/v2/index.html`);
await new Promise((resolve,reject)=>new qiniu.cdn.CdnManager(mac).refreshUrls([...new Set(urls)].slice(0, 120), (e,b,i)=>{if(e)return reject(e);console.log('cdn_refresh',JSON.stringify(b));resolve();}));
NODE
node "$REMOTE/upload-admin-cdn-now.mjs"
rm -f "$REMOTE/upload-admin-cdn-now.mjs"
echo ship_admin_api_base_ok
'@

$sh = Join-Path $env:TEMP "apply-admin-api-base.sh"
[IO.File]::WriteAllText($sh, ($remote -replace "`r`n","`n" -replace "`r","`n"), (New-Object System.Text.UTF8Encoding $false))
scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 $sh ubuntu@120.92.119.154:/tmp/apply-admin-api-base.sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -p 9922 ubuntu@120.92.119.154 "scp -o BatchMode=yes /tmp/frontier-admin-api-base.tgz /tmp/apply-admin-api-base.sh ubuntu@192.168.123.14:/tmp/ && ssh -o BatchMode=yes ubuntu@192.168.123.14 bash /tmp/apply-admin-api-base.sh"
