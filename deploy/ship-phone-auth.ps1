$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$JumpKey = Join-Path $env:USERPROFILE ".ssh\id_rsa"
$Tgz = Join-Path $PSScriptRoot "frontier-phone-auth.tgz"
$Stage = Join-Path $env:TEMP "frontier-phone-auth-pack"

if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Path (Join-Path $Stage "server-pack\src\routes") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Stage "server-pack\src\services") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Stage "server-pack\prisma") -Force | Out-Null
Copy-Item (Join-Path $Root "server\src\routes\auth.js") (Join-Path $Stage "server-pack\src\routes\auth.js")
Copy-Item (Join-Path $Root "server\src\services\analytics.js") (Join-Path $Stage "server-pack\src\services\analytics.js")
Copy-Item (Join-Path $Root "server\prisma\schema.prisma") (Join-Path $Stage "server-pack\prisma\schema.prisma")

Push-Location $Stage
tar -czf $Tgz server-pack
Pop-Location
Write-Host "packed $Tgz"

scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 $Tgz ubuntu@120.92.119.154:/tmp/frontier-phone-auth.tgz

$remote = @'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
rm -rf /tmp/frontier-phone-auth-extract
mkdir -p /tmp/frontier-phone-auth-extract
tar -xzf /tmp/frontier-phone-auth.tgz -C /tmp/frontier-phone-auth-extract
cp -f /tmp/frontier-phone-auth-extract/server-pack/src/routes/auth.js "$REMOTE/src/routes/auth.js"
cp -f /tmp/frontier-phone-auth-extract/server-pack/src/services/analytics.js "$REMOTE/src/services/analytics.js"
cp -f /tmp/frontier-phone-auth-extract/server-pack/prisma/schema.prisma "$REMOTE/prisma/schema.prisma"

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
await addCol('ALTER TABLE Member ADD COLUMN phoneAuthAskedAt DATETIME', 'phoneAuthAskedAt');
await addCol("ALTER TABLE Member ADD COLUMN phoneAuthResult TEXT NOT NULL DEFAULT ''", 'phoneAuthResult');
await p.$disconnect();
NODE

npx prisma generate

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
grep -n "phone-profile\|needPhoneAuth\|phoneAuthAsked" src/routes/auth.js | head -15
echo ship_ok
'@

$sh = Join-Path $env:TEMP "apply-phone-auth.sh"
[IO.File]::WriteAllText($sh, ($remote -replace "`r`n","`n" -replace "`r","`n"), (New-Object System.Text.UTF8Encoding $false))
scp -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -P 9922 $sh ubuntu@120.92.119.154:/tmp/apply-phone-auth.sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=no -i $JumpKey -p 9922 ubuntu@120.92.119.154 "scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/frontier-phone-auth.tgz /tmp/apply-phone-auth.sh ubuntu@192.168.123.14:/tmp/ && ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash /tmp/apply-phone-auth.sh"
