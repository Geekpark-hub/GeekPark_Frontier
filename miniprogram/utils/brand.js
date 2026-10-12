/** 官网同源品牌素材（本地 assets，免远程域名） */
const BRAND = {
  logo: '/assets/brand/logo.jpg',
  exploring: '/assets/brand/exploring.png',
  atmosphere: '/assets/brand/atmosphere.jpg',
  scenes: [
    '/assets/brand/scene-1.jpg',
    '/assets/brand/scene-2.jpg',
    '/assets/brand/scene-3.jpg',
    '/assets/brand/scene-4.jpg',
  ],
};

function eventFallbackCover(index = 0) {
  const list = BRAND.scenes;
  return list[Math.abs(Number(index) || 0) % list.length];
}

module.exports = {
  BRAND,
  eventFallbackCover,
};
