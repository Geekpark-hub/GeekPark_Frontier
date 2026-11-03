/**
 * 用 canvas 画中文表格再塞进 jsPDF，避开 html2canvas 不支持 oklab 的问题。
 */
import { jsPDF } from 'jspdf';

function clip(ctx, text, maxWidth) {
  const s = String(text ?? '');
  if (!s) return '';
  if (ctx.measureText(s).width <= maxWidth) return s;
  let out = s;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function wrap(ctx, text, maxWidth, maxLines) {
  const raw = String(text ?? '');
  if (!raw) return [''];
  const lines = [];
  let cur = '';
  for (const ch of raw) {
    const next = cur + ch;
    if (ctx.measureText(next).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
      if (lines.length >= maxLines) break;
    } else {
      cur = next;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length >= maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = clip(ctx, lines[maxLines - 1], maxWidth);
  }
  return lines.length ? lines : [''];
}

/**
 * @param {{
 *   rangeText: string,
 *   generatedAt: string,
 *   overview: object,
 *   profiles: object[],
 *   eventLabels: Record<string, string>,
 *   formatTime: (v: any) => string,
 * }} opts
 */
export function buildAnalyticsPdf(opts) {
  const {
    rangeText,
    generatedAt,
    overview: ov = {},
    profiles = [],
    eventLabels = {},
    formatTime,
  } = opts;

  const pageW = 1600;
  const marginX = 28;
  const headerH = 96;
  const rowMinH = 34;
  const font = '12px "Microsoft YaHei", "PingFang SC", sans-serif';
  const fontBold = 'bold 12px "Microsoft YaHei", "PingFang SC", sans-serif';
  const titleFont = 'bold 22px "Microsoft YaHei", "PingFang SC", sans-serif';

  const cols = [
    { title: '#', w: 36 },
    { title: '姓名', w: 72 },
    { title: '公司', w: 110 },
    { title: '事件', w: 48 },
    { title: '浏览', w: 48 },
    { title: '打开', w: 48 },
    { title: '报名次', w: 54 },
    { title: '报名数', w: 54 },
    { title: '投票次', w: 54 },
    { title: '投票数', w: 54 },
    { title: '报名活动', w: 220 },
    { title: '投过的票', w: 180 },
    { title: '最近活跃', w: 110 },
    { title: '动作', w: 72 },
  ];

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;

  const rowHeights = profiles.map((p) => {
    const regsLines = wrap(
      measure,
      (p.registeredEvents || []).join('；') || '—',
      cols[10].w - 10,
      3
    ).length;
    const voteLines = wrap(
      measure,
      (p.votedPolls || []).join('；') || '—',
      cols[11].w - 10,
      3
    ).length;
    return Math.max(rowMinH, Math.max(regsLines, voteLines) * 16 + 12);
  });

  const tableH = 28 + rowHeights.reduce((a, b) => a + b, 0);
  const pageH = Math.max(headerH + tableH + 40, 900);
  const canvas = document.createElement('canvas');
  canvas.width = pageW;
  canvas.height = pageH;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pageW, pageH);

  ctx.fillStyle = '#14202b';
  ctx.font = titleFont;
  ctx.fillText('前沿社 · 会员活跃报告', marginX, 36);

  ctx.font = font;
  ctx.fillStyle = '#6d7883';
  ctx.fillText(
    `统计区间：${rangeText || '—'}    生成：${generatedAt || '—'}    共 ${profiles.length} 人（PDF 最多 40 人，完整请用导出表格）`,
    marginX,
    60
  );
  ctx.fillStyle = '#14202b';
  ctx.fillText(
    `近7日活跃 ${ov.activeMembers7d ?? '—'}    周期活跃 ${ov.activeMembers ?? '—'}    事件总数 ${ov.totalEvents ?? '—'}`,
    marginX,
    80
  );

  let y = headerH;
  let x = marginX;
  ctx.font = fontBold;
  ctx.fillStyle = '#f7f5f1';
  ctx.fillRect(marginX, y, pageW - marginX * 2, 28);
  ctx.strokeStyle = '#dddddd';
  ctx.fillStyle = '#14202b';
  for (const col of cols) {
    ctx.strokeRect(x, y, col.w, 28);
    ctx.fillText(col.title, x + 6, y + 19);
    x += col.w;
  }
  y += 28;

  profiles.forEach((p, idx) => {
    const c = p.counts || {};
    const h = rowHeights[idx];
    const values = [
      String(idx + 1),
      p.name || '',
      p.company || '',
      String(c.total ?? 0),
      String(c.pageView ?? 0),
      String(c.appOpen ?? 0),
      String(c.eventRegister ?? 0),
      String((p.registeredEvents || []).length),
      String(c.pollVote ?? 0),
      String((p.votedPolls || []).length),
      (p.registeredEvents || []).join('；') || '—',
      (p.votedPolls || []).join('；') || '—',
      formatTime ? formatTime(p.lastAt) : '',
      eventLabels[p.lastEvent] || p.lastEvent || '—',
    ];

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(marginX, y, pageW - marginX * 2, h);
    ctx.font = font;
    ctx.fillStyle = '#14202b';
    let cx = marginX;
    cols.forEach((col, i) => {
      ctx.strokeStyle = '#dddddd';
      ctx.strokeRect(cx, y, col.w, h);
      if (i === 10 || i === 11) {
        const lines = wrap(ctx, values[i], col.w - 10, 3);
        lines.forEach((line, li) => {
          ctx.fillText(line, cx + 6, y + 16 + li * 16);
        });
      } else {
        ctx.fillText(clip(ctx, values[i], col.w - 10), cx + 6, y + 20);
      }
      cx += col.w;
    });
    y += h;
  });

  if (!profiles.length) {
    ctx.fillStyle = '#6d7883';
    ctx.fillText('暂无会员明细', marginX, y + 24);
  }

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const usableW = pdfW - margin * 2;
  const usableH = pdfH - margin * 2;

  const sliceH = Math.floor((canvas.width / usableW) * usableH);
  let offset = 0;
  let page = 0;
  while (offset < canvas.height) {
    if (page > 0) pdf.addPage();
    const h = Math.min(sliceH, canvas.height - offset);
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = h;
    slice.getContext('2d').drawImage(canvas, 0, offset, canvas.width, h, 0, 0, canvas.width, h);
    const imgH = (h / canvas.width) * usableW;
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, usableW, imgH);
    offset += h;
    page += 1;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  pdf.save(`前沿社活跃报告_${stamp}.pdf`);
}
