import https from 'https';

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

const appid = process.env.WX_APPID;
const secret = process.env.WX_SECRET;
if (!appid || !secret) {
  console.error('missing WX_APPID/WX_SECRET');
  process.exit(1);
}
const tj = await getJson(
  `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`
);
if (!tj.access_token) {
  console.log(JSON.stringify(tj));
  process.exit(1);
}
const j = await getJson(
  `https://api.weixin.qq.com/wxaapi/newtmpl/gettemplate?access_token=${tj.access_token}`
);
const want = new Set([
  'gZOoiCjD-ktnDLGeetPz2uu3_FfTuYDtGwuQntts-y4',
  'LGKkrn--DO4u2vxyU4vVx1-zI1yJ0pRyuTcEoWp34S0',
  'GA0JfTFGL3MSejosP8zDc1wuTcC9XAWHb2nyZT6vI3o',
]);
const list = (j.data || []).filter((t) => want.has(t.priTmplId));
for (const t of list) {
  console.log('====', t.title, t.priTmplId);
  console.log(t.content);
  console.log('example:', t.example);
}
if (!list.length) {
  console.log('full:', JSON.stringify(j, null, 2));
}
