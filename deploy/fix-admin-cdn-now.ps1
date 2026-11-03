$ErrorActionPreference = "Stop"
$JumpKey = Join-Path $env:USERPROFILE ".ssh\id_rsa"

$html = & curl.exe -s "https://frontier-api.geekpark.net/"
Write-Host "=== public html snippet ==="
($html -split "`n" | Select-String -Pattern "assets/|script|stylesheet" | ForEach-Object { $_.Line.Trim() }) -join "`n" | Write-Host

$js = [regex]::Match($html, 'https://frontier\.geekpark\.net/frontier/admin/assets/index-[^"]+\.js').Value
Write-Host "entry_js=$js"
if ($js) {
  & curl.exe -sI $js | Select-String -Pattern "^HTTP/|^Content-Length"
}

$remote = @'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
echo "=== local index ==="
grep -oE 'https://frontier\.geekpark\.net/frontier/admin/assets/[^"]+' "$REMOTE/admin-dist/index.html" || true
echo "=== local entry files ==="
ls "$REMOTE/admin-dist/assets"/index-*.js 2>/dev/null | head -5
echo "=== health ==="
curl -sf http://127.0.0.1:3100/api/health >/dev/null && echo health_ok
ENTRY=$(grep -oE 'https://frontier\.geekpark\.net/frontier/admin/assets/index-[^"]+\.js' "$REMOTE/admin-dist/index.html" | head -1)
echo "check_cdn=$ENTRY"
curl -sS -o /dev/null -w "cdn_entry=%{http_code}\n" "$ENTRY" || true
# reupload if missing
CODE=$(curl -sS -o /dev/null -w "%{http_code}" "$ENTRY" || echo 000)
if [ "$CODE" != "200" ]; then
  echo "CDN miss, reupload..."
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
for (const f of walk(distDir)) {
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
  curl -sS -o /dev/null -w "cdn_entry_after=%{http_code}\n" "$ENTRY"
fi
echo fix_done
'@

$sh = Join-Path $env:TEMP "fix-admin-cdn-now.sh"
[IO.File]::WriteAllText($sh, ($remote -replace "`r`n","`n" -replace "`r","`n"), (New-Object System.Text.UTF8Encoding $false))
scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 $sh ubuntu@120.92.119.154:/tmp/fix-admin-cdn-now.sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -p 9922 ubuntu@120.92.119.154 "scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/fix-admin-cdn-now.sh ubuntu@192.168.123.14:/tmp/ && ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash /tmp/fix-admin-cdn-now.sh"
