#!/bin/bash
set -euo pipefail
cd /home/ubuntu/apps/frontier-society
grep -E 'rss_ingest|Error' frontier-api.log | tail -n 20 || true
set -a
. ./.env.production
set +a
export PATH="$PWD/.node/bin:$PATH"
export DATABASE_URL="file:$PWD/data/prod.db"
node -e 'const {PrismaClient}=require("@prisma/client"); const p=new PrismaClient(); Promise.all([p.newsSourceItem.count(), p.newsSource.findMany({include:{_count:{select:{items:true}}}})]).then(([n,s])=>{console.log(JSON.stringify({archive:n, bySource:s.map(x=>({name:x.name, items:x._count.items}))},null,2));}).finally(()=>p.$disconnect());'
