import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { requireAdmin } from '../middleware/auth.js';
import { adminAuditMiddleware } from '../services/adminAudit.js';
import { getQiniuStatus, uploadBufferToQiniu } from '../services/qiniu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, '../../uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype || '')) {
      cb(new Error('仅支持上传图片'));
      return;
    }
    cb(null, true);
  },
});

function saveLocalFallback(file) {
  const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
  const safe = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? ext : '.jpg';
  const filename = `cover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safe}`;
  const full = path.join(uploadDir, filename);
  fs.writeFileSync(full, file.buffer);
  return { url: `/uploads/${filename}`, filename };
}

const router = Router();

router.post('/image', requireAdmin, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || '上传失败' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '请选择图片文件' });
    }

    const qiniu = getQiniuStatus();
    if (qiniu.ready) {
      try {
        const result = await uploadBufferToQiniu({
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
        });
        return res.json({
          url: result.url,
          key: result.key,
          storage: 'qiniu',
        });
      } catch (e) {
        console.error('[qiniu] upload failed', e.message || e, e.detail || '');
        return res.status(502).json({
          error: e.message || '七牛上传失败，请检查密钥/空间/区域配置',
        });
      }
    }

    // 未配置七牛时回退本地 /uploads（仅开发）
    const local = saveLocalFallback(req.file);
    res.json({ ...local, storage: 'local' });
  });
});

export default router;
export { uploadDir };
