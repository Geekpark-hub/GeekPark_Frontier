import { prisma } from '../prisma.js';

const FEED_HERO_KEY = 'feedHero';

const DEFAULT_FEED_HERO = {
  enabled: true,
  url: '',
};

function parseFeedHero(raw) {
  try {
    const data = JSON.parse(String(raw || '{}'));
    return {
      enabled: data.enabled !== false && data.enabled !== 0 && data.enabled !== '0',
      url: String(data.url || '').trim(),
    };
  } catch {
    return { ...DEFAULT_FEED_HERO };
  }
}

export async function getFeedHeroSetting() {
  const row = await prisma.appSetting.findUnique({ where: { key: FEED_HERO_KEY } });
  if (!row) return { ...DEFAULT_FEED_HERO };
  return parseFeedHero(row.value);
}

export async function setFeedHeroSetting({ enabled, url } = {}) {
  const prev = await getFeedHeroSetting();
  const next = {
    enabled: enabled === undefined ? prev.enabled : Boolean(enabled),
    url: url === undefined ? prev.url : String(url || '').trim(),
  };
  await prisma.appSetting.upsert({
    where: { key: FEED_HERO_KEY },
    create: { key: FEED_HERO_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  return next;
}
