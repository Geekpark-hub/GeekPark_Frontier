import mammoth from 'mammoth';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// pdf-parse CJS
const pdfParse = require('pdf-parse');

const CONFIDENTIAL_HINT =
  '「前沿社内参」仅限前沿社企业家会员群内部阅读，请勿外传或转发扩散。';

function decodeFileName(name = '') {
  const raw = String(name || '');
  // multer 在部分环境下会把 UTF-8 文件名按 latin1 读入
  if (/[\u0080-\u00ff]/.test(raw) && !/[\u4e00-\u9fff]/.test(raw)) {
    try {
      return Buffer.from(raw, 'latin1').toString('utf8');
    } catch {
      return raw;
    }
  }
  return raw;
}

function stripExt(name = '') {
  return String(name).replace(/\.(docx|pdf)$/i, '').trim();
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeHtml(html) {
  let s = String(html || '');
  s = s.replace(/<\/?(span|font|o:p)[^>]*>/gi, '');
  s = s.replace(/\sstyle="[^"]*"/gi, '');
  s = s.replace(/\sclass="[^"]*"/gi, '');
  // 编辑器可能产出 h1/h3–h6，统一成 h2（阅读页按 h2 认章节）
  s = s.replace(/<\/?h1\b[^>]*>/gi, (tag) => tag.replace(/h1/gi, 'h2'));
  s = s.replace(/<\/?h[3-6]\b[^>]*>/gi, (tag) => tag.replace(/h[3-6]/gi, 'h2'));
  s = s.replace(/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '');
  // PART 标题提升为 h2，方便阅读页排版
  s = s.replace(
    /<p>\s*(?:<(?:strong|b)>)?\s*(PART\s*[\d０-９]+[\s\S]*?)\s*(?:<\/(?:strong|b)>)?\s*<\/p>/gi,
    (_m, title) => `<h2>${String(title).replace(/<\/?(?:strong|b)>/gi, '').trim()}</h2>`
  );
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function textToHtml(text) {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return '';
  return lines.map((line) => {
    if (/^PART\s*\d+/i.test(line) || /^第[一二三四五六七八九十\d]+[部份章]/.test(line)) {
      return `<h2>${escapeHtml(line)}</h2>`;
    }
    if (/^「/.test(line) || /^["“]/.test(line)) {
      return `<blockquote><p>${escapeHtml(line)}</p></blockquote>`;
    }
    return `<p>${escapeHtml(line)}</p>`;
  }).join('\n');
}

function guessTitle({ fileName, html, text }) {
  const plain = String(text || html || '')
    .replace(/<[^>]+>/g, '\n')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const fromBody = plain.find((l) => /内参|闭门|交流/.test(l)) || plain[0] || '';
  if (fromBody) return fromBody.slice(0, 120);

  const fromFile = stripExt(decodeFileName(fileName));
  if (fromFile && /[\u4e00-\u9fffA-Za-z0-9]/.test(fromFile)) return fromFile.slice(0, 120);
  return '未命名内参';
}

function guessGuest(text) {
  const s = String(text || '');
  const m =
    s.match(/本期分享嘉宾[：:]\s*([^\n\r，,。；;]{1,20})/) ||
    s.match(/嘉宾[：:]\s*([^\n\r，,。；;]{1,20})/);
  return m ? m[1].trim() : '';
}

function guessSummary(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return CONFIDENTIAL_HINT;
  if (/请勿外传|仅限/.test(s)) {
    const m = s.match(/[^。]{0,40}(请勿外传|仅限)[^。]{0,40}/);
    if (m) return m[0].slice(0, 160);
  }
  return CONFIDENTIAL_HINT;
}

/**
 * @param {{ buffer: Buffer, originalName: string, mimeType?: string }} file
 * @returns {Promise<{ title: string, guestName: string, summary: string, contentHtml: string, sourceType: string, textPreview: string }>}
 */
export { normalizeHtml };

export async function importBriefFromFile(file) {
  const name = decodeFileName(file.originalName || '');
  const lower = name.toLowerCase();
  const mime = String(file.mimeType || '').toLowerCase();
  const isDocx =
    lower.endsWith('.docx') ||
    mime.includes('wordprocessingml') ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const isPdf = lower.endsWith('.pdf') || mime === 'application/pdf';

  if (!isDocx && !isPdf) {
    const err = new Error('仅支持 .docx 或 .pdf');
    err.status = 400;
    throw err;
  }
  if (!file.buffer?.length) {
    const err = new Error('文件为空');
    err.status = 400;
    throw err;
  }

  let contentHtml = '';
  let text = '';
  let sourceType = 'manual';

  if (isDocx) {
    sourceType = 'docx';
    const result = await mammoth.convertToHtml({ buffer: file.buffer });
    contentHtml = normalizeHtml(result.value || '');
    const raw = await mammoth.extractRawText({ buffer: file.buffer });
    text = String(raw.value || '');
  } else {
    sourceType = 'pdf';
    const parsed = await pdfParse(file.buffer);
    text = String(parsed.text || '');
    contentHtml = normalizeHtml(textToHtml(text));
  }

  if (!contentHtml || contentHtml.replace(/<[^>]+>/g, '').trim().length < 20) {
    const err = new Error('未能抽出有效正文，请检查文件是否为可选中文本（扫描件需先 OCR）');
    err.status = 400;
    throw err;
  }

  return {
    title: guessTitle({ fileName: name, html: contentHtml, text }),
    guestName: guessGuest(text),
    summary: guessSummary(text),
    contentHtml,
    sourceType,
    textPreview: text.slice(0, 400),
  };
}
