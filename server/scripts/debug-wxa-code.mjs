/**
 * 本地调试小程序码接口（不写库）
 * 用法：node scripts/debug-wxa-code.mjs pages/events/share id=xxx
 */
import 'dotenv/config';
import { generateWxaCode } from '../src/wx.js';

const page = process.argv[2] || 'pages/events/share';
const scene = process.argv[3] || 'id=test123';

try {
  const qr = await generateWxaCode({
    path: `${page}?${scene.replace(/^id=/, 'id=')}`,
    scene,
    width: 430,
    envVersion: 'trial',
  });
  console.log('OK env=', qr.envVersion, 'bytes=', qr.buffer.length);
} catch (e) {
  console.error('FAIL', e.message);
  console.error('detail', JSON.stringify(e.detail, null, 2));
  process.exit(1);
}
