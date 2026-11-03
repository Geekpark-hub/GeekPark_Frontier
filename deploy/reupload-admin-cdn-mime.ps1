$ErrorActionPreference = "Stop"
$JumpKey = Join-Path $env:USERPROFILE ".ssh\id_rsa"
$remote = @'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
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
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.woff2') return 'font/woff2';
  if (ext === '.woff') return 'font/woff';
  if (ext === '.map') return 'application/json';
  return 'application/octet-stream';
}

const files = walk(distDir);
console.log('cdn_upload', files.length);
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
      console.log('ok', key, extra.mimeType);
      resolve();
    });
  });
}

const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const urls = [
  `${domain}/${prefix}index.html`,
  ...[...html.matchAll(/https:\/\/[^"]+\/frontier\/admin\/assets\/[^"]+/g)].map((m) => m[0]),
];
// also refresh all asset files we uploaded
for (const f of files) {
  urls.push(`${domain}/${prefix}${f.rel}`);
}
await new Promise((resolve, reject) => {
  new qiniu.cdn.CdnManager(mac).refreshUrls([...new Set(urls)].slice(0, 100), (e, b) => {
    if (e) return reject(e);
    console.log('cdn_refresh', JSON.stringify(b));
    resolve();
  });
});
NODE
node "$REMOTE/upload-admin-cdn-now.mjs"
rm -f "$REMOTE/upload-admin-cdn-now.mjs"
sleep 2
ENTRY=$(grep -oE 'https://frontier\.geekpark\.net/frontier/admin/assets/index-[^"]+\.js' "$REMOTE/admin-dist/index.html" | head -1)
echo "check $ENTRY"
curl -sI "$ENTRY" | tr -d '\r' | grep -iE '^(HTTP/|Content-Type:)'
echo mime_fix_ok
'@
$sh = Join-Path $env:TEMP "reupload-admin-cdn-mime.sh"
[IO.File]::WriteAllText($sh, ($remote -replace "`r`n","`n" -replace "`r","`n"), (New-Object System.Text.UTF8Encoding $false))
scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 $sh ubuntu@120.92.119.154:/tmp/reupload-admin-cdn-mime.sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -p 9922 ubuntu@120.92.119.154 "scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/reupload-admin-cdn-mime.sh ubuntu@192.168.123.14:/tmp/ && ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash /tmp/reupload-admin-cdn-mime.sh"
