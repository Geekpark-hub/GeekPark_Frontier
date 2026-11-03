/** 管理后台统一按北京时间（Asia/Shanghai）展示与编辑 */

const TZ = 'Asia/Shanghai';

function partsOf(date, options) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour12: false, ...options }).formatToParts(date);
}

function part(parts, type) {
  return parts.find((p) => p.type === type)?.value || '';
}

/** 列表展示：2026-10-13 10:24:24 */
export function formatBeijingDateTime(input) {
  if (!input) return '-';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '-';
  const parts = partsOf(d, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const hour = part(parts, 'hour') === '24' ? '00' : part(parts, 'hour');
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')} ${hour}:${part(parts, 'minute')}:${part(parts, 'second')}`;
}

/** 仅日期：2026-10-13 */
export function formatBeijingDate(input) {
  if (!input) return '-';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '-';
  const parts = partsOf(d, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
}

/**
 * UTC/ISO → 选择器绑定值（北京墙钟）
 * 配合 el-date-picker value-format="YYYY-MM-DD HH:mm:ss"
 */
export function utcToBeijingPicker(input) {
  if (!input) return '';
  const text = formatBeijingDateTime(input);
  return text === '-' ? '' : text;
}

/**
 * 选择器北京墙钟 → API 用 UTC ISO
 * 接受 "YYYY-MM-DD HH:mm:ss" 或已有 ISO
 */
export function beijingPickerToUtc(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d = new Date(`${normalized}+08:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 日期选择器：YYYY-MM-DD（按北京日历日） */
export function utcToBeijingDatePicker(input) {
  if (!input) return '';
  const text = formatBeijingDate(input);
  return text === '-' ? '' : text;
}

/** 北京日期 YYYY-MM-DD → 存库用当日 00:00+08 的 UTC ISO（或保持日期字符串由后端解析） */
export function beijingDatePickerToUtcDate(input) {
  if (!input) return null;
  const raw = String(input).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return raw; // 到期日后端按日期字符串处理即可
}

export const DATETIME_PICKER_FORMAT = 'YYYY-MM-DD HH:mm:ss';
export const DATETIME_PICKER_MINUTE_FORMAT = 'YYYY-MM-DD HH:mm';
export const DATE_PICKER_FORMAT = 'YYYY-MM-DD';

/**
 * 活动默认时间：约一周后的工作日下午整点（14:00–17:00），报名截止为活动前 2 天 18:00
 * @returns {{ startAt: string, endAt: string, registerDeadline: string }} 北京墙钟
 */
export function defaultEventPickerTimes() {
  let cursor = new Date(Date.now() + 5 * 86400000);
  for (let i = 0; i < 8; i += 1) {
    const ymd = formatBeijingDate(cursor);
    const noon = new Date(`${ymd}T12:00:00+08:00`);
    const dayName = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      weekday: 'short',
    }).format(noon);
    if (dayName !== 'Sat' && dayName !== 'Sun') {
      const deadlineDate = formatBeijingDate(new Date(noon.getTime() - 2 * 86400000));
      return {
        startAt: `${ymd} 14:00:00`,
        endAt: `${ymd} 17:00:00`,
        registerDeadline: `${deadlineDate} 18:00:00`,
      };
    }
    cursor = new Date(cursor.getTime() + 86400000);
  }
  const ymd = formatBeijingDate(new Date(Date.now() + 7 * 86400000));
  const deadlineDate = formatBeijingDate(new Date(Date.now() + 5 * 86400000));
  return {
    startAt: `${ymd} 14:00:00`,
    endAt: `${ymd} 17:00:00`,
    registerDeadline: `${deadlineDate} 18:00:00`,
  };
}
