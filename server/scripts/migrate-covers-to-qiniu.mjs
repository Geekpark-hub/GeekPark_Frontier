import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { getQiniuStatus, uploadBufferToQiniu } from '../src/services/qiniu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, '../uploads');
const prisma = new PrismaClient();

function mimeFromExt(ext) {
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

function localPathFromCoverUrl(coverUrl) {
  const raw = String(coverUrl || '').trim();
  if (!raw) return null;
  // /uploads/xxx or http(s)://host/uploads/xxx
  const m = raw.match(/\/uploads\/([^/?#]+)$/i);
  if (!m) return null;
  return path.join(uploadDir, m[1]);
}

async function main() {
  const status = getQiniuStatus();
  if (!status.ready) {
    throw new Error('七牛未就绪，请检查 .env');
  }
  console.log('[qiniu]', status);

  const events = await prisma.event.findMany({
    select: { id: true, title: true, coverUrl: true },
  });

  let migrated = 0;
  let skipped = 0;

  for (const event of events) {
    const cover = String(event.coverUrl || '').trim();
    if (!cover) {
      console.log(`- skip empty: ${event.title}`);
      skipped += 1;
      continue;
    }
    if (/^https?:\/\//i.test(cover) && !/\/uploads\//i.test(cover)) {
      console.log(`- already CDN: ${event.title} -> ${cover}`);
      skipped += 1;
      continue;
    }

    const filePath = localPathFromCoverUrl(cover);
    if (!filePath || !fs.existsSync(filePath)) {
      console.warn(`! missing file for ${event.title}: ${cover}`);
      skipped += 1;
      continue;
    }

    const buf = fs.readFileSync(filePath);
    // 跳过明显无效的占位图
    if (buf.length < 200) {
      console.warn(`! too small, skip: ${event.title} (${buf.length} bytes)`);
      skipped += 1;
      continue;
    }

    const originalName = path.basename(filePath);
    const result = await uploadBufferToQiniu({
      buffer: buf,
      originalName,
      mimeType: mimeFromExt(path.extname(originalName)),
    });

    await prisma.event.update({
      where: { id: event.id },
      data: { coverUrl: result.url },
    });

    console.log(`✓ ${event.title}`);
    console.log(`  ${cover} -> ${result.url}`);
    migrated += 1;
  }

  console.log(`\ndone. migrated=${migrated} skipped=${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
