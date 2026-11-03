#!/usr/bin/env node
/**
 * 粗测管理后台首屏关键资源耗时（从当前机器）
 */
import https from 'https';

function get(url) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({
            url,
            status: res.statusCode,
            bytes: buf.length,
            ms: Date.now() - t0,
          });
        });
      })
      .on('error', reject);
  });
}

const htmlUrl = 'https://frontier-api.geekpark.net/';
const html = await get(htmlUrl);
console.log('HTML', html);

const assetRe = /(?:src|href)="(https:\/\/frontier\.geekpark\.net\/frontier\/admin\/assets\/[^"]+)"/g;
const assets = [];
let m;
const body = await new Promise((resolve, reject) => {
  https
    .get(htmlUrl, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    })
    .on('error', reject);
});
while ((m = assetRe.exec(body))) assets.push(m[1]);

console.log('critical assets', assets.length);
const results = [];
for (const u of assets) {
  // eslint-disable-next-line no-await-in-loop
  results.push(await get(u));
}
let total = html.ms;
for (const r of results) {
  console.log(`${r.ms}ms  ${(r.bytes / 1024).toFixed(1)}KB  ${r.url.split('/').pop()}`);
  total += r.ms;
}
const sumBytes = results.reduce((s, r) => s + r.bytes, 0) + html.bytes;
console.log(`serial_sum≈${total}ms  critical_bytes≈${(sumBytes / 1024).toFixed(1)}KB`);
console.log('(浏览器会并行下载；登录页随后再按需拉 Login/按钮等小块)');
