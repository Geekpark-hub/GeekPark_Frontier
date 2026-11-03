function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function plainText(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** 解析段落内加粗 runs，供原生 text 渲染 */
function parseRuns(innerHtml) {
  const src = String(innerHtml || '');
  const runs = [];
  const re = /<(strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m.index > last) {
      const t = plainText(src.slice(last, m.index));
      if (t) runs.push({ bold: false, text: t });
    }
    const t = plainText(m[2]);
    if (t) runs.push({ bold: true, text: t });
    last = m.index + m[0].length;
  }
  if (last < src.length) {
    const t = plainText(src.slice(last));
    if (t) runs.push({ bold: false, text: t });
  }
  if (!runs.length) {
    const t = plainText(src);
    if (t) runs.push({ bold: false, text: t });
  }
  return runs;
}

/** 全角数字 / 杂空白 → 便于识别 PART */
function normalizePartText(text) {
  return String(text || '')
    .replace(/[\uFEFF\u200B\u200C\u200D\u2060]/g, '')
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0))
    .replace(/[Ｐｐ][Ａａ][Ｒｒ][Ｔｔ]/g, 'PART')
    .replace(/［/g, '[')
    .replace(/］/g, ']')
    .replace(/【/g, '[')
    .replace(/】/g, ']')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitPartTitle(text) {
  const raw = normalizePartText(text);
  if (!raw) return null;
  // PART 2 xxx / [PART 2] xxx / PART 2：xxx
  const m = raw.match(/^\[?\s*PART\s*(\d+)\s*\]?\s*[：:\-—–‧・、|｜]?\s*(.*)$/i);
  if (!m) return null;
  const num = m[1];
  let title = String(m[2] || '').trim();
  // 避免标题里再重复 PART 2
  title = title.replace(/^\[?\s*PART\s*\d+\s*\]?\s*[：:\-—–‧・、|｜]?\s*/i, '').trim();
  return {
    label: `PART ${num}`,
    title: title || `PART ${num}`,
  };
}

/**
 * 把导入 HTML 拆成原生可读块（避开 rich-text 排版限制）
 * @returns {{ type: string, text?: string, runs?: object[], label?: string, title?: string }[]}
 */
function parseBriefBlocks(html) {
  let s = String(html || '').trim();
  if (!s) return [];

  // 编辑器可能产出 h1/h3–h6，阅读页统一按章节标题处理
  s = s.replace(/<\/?h1\b[^>]*>/gi, (tag) => tag.replace(/h1/gi, 'h2'));
  s = s.replace(/<\/?h[3-6]\b[^>]*>/gi, (tag) => tag.replace(/h[3-6]/gi, 'h2'));
  s = s.replace(/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '');
  s = s.replace(
    /<p>\s*(?:<(?:strong|b)>)?\s*(PART\s*[\d０-９]+[\s\S]*?)\s*(?:<\/(?:strong|b)>)?\s*<\/p>/gi,
    (_m, title) => `<h2>${String(title).replace(/<\/?(?:strong|b)>/gi, '').trim()}</h2>`
  );

  const blocks = [];
  const re = /<(h2|p|blockquote)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(s))) {
    const tag = m[1].toLowerCase();
    const inner = m[2];
    if (tag === 'h2') {
      const text = plainText(inner);
      if (!text) continue;
      const part = splitPartTitle(text);
      if (part) {
        blocks.push({ type: 'part', label: part.label, title: part.title, text });
      } else {
        blocks.push({ type: 'heading', text, runs: [{ bold: false, text }] });
      }
      continue;
    }
    if (tag === 'blockquote') {
      const text = plainText(inner);
      if (!text) continue;
      blocks.push({ type: 'quote', text, runs: parseRuns(inner.replace(/<\/?p[^>]*>/gi, '')) });
      continue;
    }
    const runs = parseRuns(inner);
    const text = runs.map((r) => r.text).join('');
    if (!text) continue;
    // 误把 PART 落在普通段（中间有加粗也不要挡）
    const part = splitPartTitle(text);
    if (part) {
      blocks.push({ type: 'part', label: part.label, title: part.title, text });
    } else {
      blocks.push({ type: 'p', text, runs });
    }
  }

  if (!blocks.length) {
    const fallback = plainText(s);
    if (fallback) {
      fallback.split(/\n+/).forEach((line) => {
        const t = line.trim();
        if (!t) return;
        const part = splitPartTitle(t);
        if (part) blocks.push({ type: 'part', label: part.label, title: part.title, text: t });
        else blocks.push({ type: 'p', text: t, runs: [{ bold: false, text: t }] });
      });
    }
  }
  return blocks;
}

module.exports = { parseBriefBlocks, plainText, splitPartTitle };
