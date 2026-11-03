import qiniu from 'qiniu';
import path from 'path';

function trim(v) {
  return String(v || '').trim();
}

export function getQiniuStatus() {
  const ready = Boolean(
    trim(process.env.QINIU_ACCESS_KEY) &&
      trim(process.env.QINIU_SECRET_KEY) &&
      trim(process.env.QINIU_BUCKET) &&
      trim(process.env.QINIU_DOMAIN),
  );
  return {
    ready,
    bucket: trim(process.env.QINIU_BUCKET) || null,
    domain: normalizeDomain(process.env.QINIU_DOMAIN) || null,
    zone: trim(process.env.QINIU_ZONE) || 'z0',
  };
}

function normalizeDomain(domain) {
  const raw = trim(domain).replace(/\/$/, '');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function resolveZone(zoneId) {
  const id = trim(zoneId || 'z0').toLowerCase();
  const map = {
    z0: qiniu.zone.Zone_z0,
    'cn-east-1': qiniu.zone.Zone_z0,
    'cn-east-2': qiniu.zone.Zone_cn_east_2,
    z1: qiniu.zone.Zone_z1,
    'cn-north-1': qiniu.zone.Zone_z1,
    z2: qiniu.zone.Zone_z2,
    'cn-south-1': qiniu.zone.Zone_z2,
    na0: qiniu.zone.Zone_na0,
    as0: qiniu.zone.Zone_as0,
  };
  return map[id] || qiniu.zone.Zone_z0;
}

function buildKey(originalName) {
  const prefix = trim(process.env.QINIU_PREFIX) || 'frontier/';
  const safePrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const ext = path.extname(originalName || '').toLowerCase() || '.jpg';
  const imageExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const docExt = ['.docx', '.pdf'];
  let safeExt = '.jpg';
  let kind = 'cover';
  if (imageExt.includes(ext)) {
    safeExt = ext;
    kind = 'cover';
  } else if (docExt.includes(ext)) {
    safeExt = ext;
    kind = 'brief';
  }
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${safePrefix}${kind}-${stamp}-${rand}${safeExt}`;
}

/**
 * 上传 Buffer 到七牛，返回可公网访问的 CDN URL。
 */
export function uploadBufferToQiniu({ buffer, originalName, mimeType }) {
  const status = getQiniuStatus();
  if (!status.ready) {
    const err = new Error('七牛未配置完整（需要 ACCESS_KEY / SECRET_KEY / BUCKET / DOMAIN）');
    err.status = 500;
    return Promise.reject(err);
  }

  const accessKey = trim(process.env.QINIU_ACCESS_KEY);
  const secretKey = trim(process.env.QINIU_SECRET_KEY);
  const bucket = trim(process.env.QINIU_BUCKET);
  const domain = normalizeDomain(process.env.QINIU_DOMAIN);
  const key = buildKey(originalName);

  const mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
  const putPolicy = new qiniu.rs.PutPolicy({ scope: bucket });
  const uploadToken = putPolicy.uploadToken(mac);

  const config = new qiniu.conf.Config();
  config.zone = resolveZone(process.env.QINIU_ZONE);
  config.useCdnDomain = true;

  const formUploader = new qiniu.form_up.FormUploader(config);
  const putExtra = new qiniu.form_up.PutExtra();
  if (mimeType) putExtra.mimeType = mimeType;

  return new Promise((resolve, reject) => {
    formUploader.put(uploadToken, key, buffer, putExtra, (err, body, info) => {
      if (err) {
        reject(err);
        return;
      }
      if (!info || info.statusCode !== 200) {
        const msg =
          (body && (body.error || body.errmsg)) ||
          `七牛上传失败 (${info ? info.statusCode : 'unknown'})`;
        const e = new Error(msg);
        e.status = 502;
        e.detail = body;
        reject(e);
        return;
      }
      const url = `${domain}/${body.key || key}`;
      resolve({
        url,
        key: body.key || key,
        hash: body.hash || '',
      });
    });
  });
}
