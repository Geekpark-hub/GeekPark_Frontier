/** 会员主号 + 备号（phonesExtra JSON 数组） */

export function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(-11);
}

export function isValidCnMobile(value) {
  return /^1\d{10}$/.test(String(value || ''));
}

export function parsePhonesExtra(raw) {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw || [];
    if (!Array.isArray(arr)) return [];
    const out = [];
    const seen = new Set();
    for (const item of arr) {
      const p = normalizePhone(item);
      if (!isValidCnMobile(p) || seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
    return out;
  } catch {
    return [];
  }
}

export function stringifyPhonesExtra(list) {
  return JSON.stringify(parsePhonesExtra(JSON.stringify(list || [])));
}

/**
 * 把授权/进入手机号并入会员档案：
 * - 无主号且未被占用 → 写主号
 * - 主号已被他人占用 / 已有主号 → 记入备号（不覆盖主号）
 * - 已存在则 noop
 */
export function mergePhoneIntoMember(member, phone) {
  const p = normalizePhone(phone);
  if (!isValidCnMobile(p)) return { kind: 'noop' };

  const primary = normalizePhone(member.phone);
  const extras = parsePhonesExtra(member.phonesExtra).filter((x) => x !== primary);

  if (p === primary || extras.includes(p)) {
    return { kind: 'noop' };
  }

  if (!primary) {
    return {
      kind: 'primary',
      phone: p,
      phonesExtra: stringifyPhonesExtra(extras),
    };
  }

  return {
    kind: 'extra',
    phonesExtra: stringifyPhonesExtra([...extras, p]),
  };
}
