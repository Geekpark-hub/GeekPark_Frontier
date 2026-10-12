import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:3000';

const login = await (
  await fetch(`${BASE}/auth/admin-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '17611294568' }),
  })
).json();

if (!login.token) {
  console.error('login failed', login);
  process.exit(1);
}

// 1x1 png
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const tmp = path.join(__dirname, 'tmp-cover.png');
fs.writeFileSync(tmp, png);

const form = new FormData();
form.append('file', new Blob([png], { type: 'image/png' }), 'cover.png');

const res = await fetch(`${BASE}/admin/upload/image`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${login.token}` },
  body: form,
});
const data = await res.json();
console.log(res.status, data);

if (data.url) {
  const img = await fetch(`${BASE}${data.url}`);
  console.log('static', img.status, img.headers.get('content-type'));
}

fs.unlinkSync(tmp);
