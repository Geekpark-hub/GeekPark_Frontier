/** Tab 矢量描边：按路径长度 0→1 连续绘制（类 SVG stroke-dashoffset） */

const COLOR_OFF = '#a8a096';
const COLOR_ON = '#14202b';

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function segLen(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * 路径尽量贴近原 tab PNG：
 * feed=竖条+三横线 / event=日历 / mine=证件卡
 */
const ICONS = {
  feed: {
    strokes: [
      { type: 'line', points: [[5.2, 4], [5.2, 20]] },
      { type: 'line', points: [[9.5, 6], [19.8, 6]] },
      { type: 'line', points: [[9.5, 12], [17.5, 12]] },
      { type: 'line', points: [[9.5, 18], [15.2, 18]] },
    ],
  },
  event: {
    strokes: [
      { type: 'roundRect', x: 3.5, y: 5, w: 17, h: 14.5, r: 2.5 },
      { type: 'line', points: [[3.5, 10], [20.5, 10]] },
      { type: 'line', points: [[8, 3.2], [8, 7]] },
      { type: 'line', points: [[16, 3.2], [16, 7]] },
      { type: 'line', points: [[10.2, 15.2], [13.8, 15.2]] },
    ],
  },
  mine: {
    strokes: [
      { type: 'roundRect', x: 3.5, y: 4, w: 17, h: 16, r: 2.6 },
      { type: 'circle', c: [9, 12], r: 3 },
      { type: 'line', points: [[13.5, 10], [18.5, 10]] },
      { type: 'line', points: [[13.5, 14], [17, 14]] },
    ],
  },
};

function strokeLength(stroke) {
  if (stroke.type === 'line') {
    let n = 0;
    for (let i = 1; i < stroke.points.length; i++) n += segLen(stroke.points[i - 1], stroke.points[i]);
    return n;
  }
  if (stroke.type === 'circle') return Math.PI * 2 * stroke.r;
  if (stroke.type === 'roundRect') {
    const { w, h, r } = stroke;
    return 2 * (w + h) - 8 * r + 2 * Math.PI * r;
  }
  return 0;
}

function totalLength(icon) {
  return icon.strokes.reduce((s, st) => s + strokeLength(st), 0);
}

function traceLine(ctx, points, drawLen) {
  if (drawLen <= 0 || points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  let left = drawLen;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = segLen(a, b);
    if (left >= len) {
      ctx.lineTo(b[0], b[1]);
      left -= len;
    } else {
      const t = left / len;
      ctx.lineTo(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      break;
    }
  }
  ctx.stroke();
}

function traceCircle(ctx, c, r, drawLen) {
  if (drawLen <= 0) return;
  const full = Math.PI * 2 * r;
  const angle = (Math.min(drawLen, full) / full) * Math.PI * 2;
  ctx.beginPath();
  ctx.arc(c[0], c[1], r, -Math.PI / 2, -Math.PI / 2 + angle, false);
  ctx.stroke();
}

function traceRoundRect(ctx, x, y, w, h, r, drawLen) {
  if (drawLen <= 0) return;
  const rr = Math.min(r, w / 2, h / 2);
  const parts = [];
  const pushLine = (a, b) => parts.push({ kind: 'line', a, b, len: segLen(a, b) });
  const pushArc = (cx, cy, start, end) => {
    parts.push({ kind: 'arc', cx, cy, start, end, len: Math.abs(end - start) * rr });
  };

  const midTop = [x + w / 2, y];
  pushLine(midTop, [x + w - rr, y]);
  pushArc(x + w - rr, y + rr, -Math.PI / 2, 0);
  pushLine([x + w, y + rr], [x + w, y + h - rr]);
  pushArc(x + w - rr, y + h - rr, 0, Math.PI / 2);
  pushLine([x + w - rr, y + h], [x + rr, y + h]);
  pushArc(x + rr, y + h - rr, Math.PI / 2, Math.PI);
  pushLine([x, y + h - rr], [x, y + rr]);
  pushArc(x + rr, y + rr, Math.PI, (Math.PI * 3) / 2);
  pushLine([x + rr, y], midTop);

  ctx.beginPath();
  let started = false;
  let left = drawLen;
  for (const p of parts) {
    if (left <= 0) break;
    if (p.kind === 'line') {
      const t = Math.min(1, left / p.len);
      const x2 = p.a[0] + (p.b[0] - p.a[0]) * t;
      const y2 = p.a[1] + (p.b[1] - p.a[1]) * t;
      if (!started) {
        ctx.moveTo(p.a[0], p.a[1]);
        started = true;
      }
      ctx.lineTo(x2, y2);
      left -= p.len * t;
      if (t < 1) break;
    } else {
      const span = p.end - p.start;
      const t = Math.min(1, left / p.len);
      const end = p.start + span * t;
      if (!started) {
        ctx.moveTo(p.cx + Math.cos(p.start) * rr, p.cy + Math.sin(p.start) * rr);
        started = true;
      }
      ctx.arc(p.cx, p.cy, rr, p.start, end, span < 0);
      left -= p.len * t;
      if (t < 1) break;
    }
  }
  ctx.stroke();
}

function drawIcon(ctx, key, progress, color, size) {
  const icon = ICONS[key];
  if (!icon) return;
  const p = Math.max(0, Math.min(1, progress));
  const scale = size / 24;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let budget = totalLength(icon) * p;
  for (const stroke of icon.strokes) {
    const len = strokeLength(stroke);
    const drawLen = Math.max(0, Math.min(len, budget));
    if (stroke.type === 'line') traceLine(ctx, stroke.points, drawLen);
    else if (stroke.type === 'circle') traceCircle(ctx, stroke.c, stroke.r, drawLen);
    else if (stroke.type === 'roundRect') {
      traceRoundRect(ctx, stroke.x, stroke.y, stroke.w, stroke.h, stroke.r, drawLen);
    }
    budget -= len;
    if (budget <= 0 && p < 1) break;
  }
  ctx.restore();
}

module.exports = {
  COLOR_OFF,
  COLOR_ON,
  easeOutCubic,
  drawIcon,
};
