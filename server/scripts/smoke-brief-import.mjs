import fs from 'fs';
import { importBriefFromFile } from '../src/services/briefImport.js';

const p = process.argv[2] || 'e:/【前沿社内参】10.22杭州闭门交流-群核科技.docx';
const buf = fs.readFileSync(p);
const r = await importBriefFromFile({
  buffer: buf,
  originalName: p.split(/[/\\]/).pop(),
  mimeType:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
console.log(
  JSON.stringify(
    {
      title: r.title,
      guestName: r.guestName,
      summary: r.summary.slice(0, 100),
      sourceType: r.sourceType,
      htmlLen: r.contentHtml.length,
      preview: r.textPreview.slice(0, 160),
    },
    null,
    2
  )
);
