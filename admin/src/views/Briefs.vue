<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>前沿社内参</h2>
        <p class="muted">上传 Word/PDF 自动转阅读页；会员端关闭转发，阅读带水印。短链仅供运营分发。</p>
      </div>
      <div class="toolbar-actions">
        <el-select v-model="status" clearable placeholder="全部状态" style="width: 140px" @change="resetAndLoad">
          <el-option label="草稿" value="draft" />
          <el-option label="已发布" value="published" />
          <el-option label="已归档" value="archived" />
        </el-select>
        <el-upload
          :show-file-list="false"
          accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          :http-request="importFile"
          :disabled="importing"
        >
          <el-button type="primary" :loading="importing">上传 Word/PDF</el-button>
        </el-upload>
      </div>
    </div>

    <el-table :data="list" stripe empty-text="暂无内参" v-loading="loading">
      <el-table-column prop="title" label="标题" min-width="240" />
      <el-table-column prop="guestName" label="嘉宾" width="120" />
      <el-table-column label="来源" width="90">
        <template #default="{ row }">{{ sourceText[row.sourceType] || row.sourceType }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <span class="status-chip" :class="`is-${row.status}`">{{ statusText[row.status] || row.status }}</span>
        </template>
      </el-table-column>
      <el-table-column label="发布" width="160">
        <template #default="{ row }">{{ row.publishedAt ? formatDateTime(row.publishedAt) : '—' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="280" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button
            v-if="row.status !== 'published'"
            link
            type="success"
            @click="setStatus(row, 'published')"
          >发布</el-button>
          <el-button
            v-if="row.status === 'published'"
            link
            type="warning"
            @click="setStatus(row, 'archived')"
          >归档</el-button>
          <el-button link @click="openShare(row)">分发</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <ListPager v-model:page="page" :page-size="pageSize" :total="total" @update:page="onPage" />

    <el-dialog
      v-model="visible"
      :title="form.id ? '编辑内参' : '新建内参'"
      width="900px"
      append-to-body
      align-center
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item label="标题" required>
          <el-input v-model="form.title" />
        </el-form-item>
        <el-form-item label="嘉宾">
          <el-input v-model="form.guestName" placeholder="选填" />
        </el-form-item>
        <el-form-item label="摘要 / 保密提示">
          <el-input v-model="form.summary" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="正文">
          <BriefHtmlEditor v-model="form.contentHtml" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="草稿" value="draft" />
            <el-option label="已发布" value="published" />
            <el-option label="已归档" value="archived" />
          </el-select>
        </el-form-item>
        <p v-if="form.sourceFileUrl" class="muted">原文存档（仅后台）：{{ form.sourceFileUrl }}</p>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="shareVisible"
      title="分发内参"
      width="560px"
      append-to-body
      align-center
      destroy-on-close
    >
      <p class="muted share-tip">
        短链 / 小程序码仅供运营发到会员群。会员打开后需登录，且页面已关闭转发；非会员看不到正文。
      </p>
      <el-form label-position="top">
        <el-form-item label="分发短链">
          <p v-if="shareForm.urlLinkError" class="muted share-tip">{{ shareForm.urlLinkError }}</p>
          <div class="share-row">
            <el-input :model-value="shareForm.urlLink" readonly placeholder="生成中…" />
            <el-button
              type="primary"
              :loading="shareLoading"
              :disabled="!shareForm.urlLink"
              @click="copyText(shareForm.urlLink, '已复制短链')"
            >复制</el-button>
          </div>
        </el-form-item>
        <el-form-item label="小程序路径">
          <div class="share-row">
            <el-input :model-value="shareForm.path" readonly />
            <el-button @click="copyText(shareForm.path, '已复制路径')">复制</el-button>
          </div>
        </el-form-item>
        <el-form-item label="小程序码">
          <div v-if="shareForm.qrcodeDataUrl" class="share-qr">
            <img :src="shareForm.qrcodeDataUrl" alt="内参小程序码" />
            <el-button link type="primary" @click="downloadQr(shareForm.qrcodeDataUrl, shareForm.title || '内参')">
              下载小程序码
            </el-button>
          </div>
          <p v-else class="muted">{{ shareForm.qrcodeError || '生成中…' }}</p>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="shareVisible = false">关闭</el-button>
        <el-button
          type="primary"
          :loading="shareLoading"
          :disabled="!shareForm.urlLink"
          @click="copyText(shareForm.urlLink, '已复制短链')"
        >复制短链</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';
import ListPager from '../components/ListPager.vue';
import BriefHtmlEditor from '../components/BriefHtmlEditor.vue';
import { DEFAULT_PAGE_SIZE, pageParams } from '../utils/listPage';
import { formatBeijingDateTime } from '../utils/datetime';
import { useListRefresh } from '../utils/useListRefresh';

const list = ref([]);
const loading = ref(false);
const page = ref(1);
const pageSize = DEFAULT_PAGE_SIZE;
const total = ref(0);
const status = ref('');
const visible = ref(false);
const saving = ref(false);
const importing = ref(false);
const shareVisible = ref(false);
const shareLoading = ref(false);
const form = reactive(emptyForm());
const shareForm = reactive({
  id: '',
  title: '',
  urlLink: '',
  urlLinkError: '',
  path: '',
  qrcodeDataUrl: '',
  qrcodeError: '',
});

const statusText = { draft: '草稿', published: '已发布', archived: '已归档' };
const sourceText = { docx: 'Word', pdf: 'PDF', manual: '手写' };

function emptyForm() {
  return {
    id: '',
    title: '',
    guestName: '',
    summary: '「前沿社内参」仅限前沿社企业家会员群内部阅读，请勿外传或转发扩散。',
    contentHtml: '',
    status: 'draft',
    sourceFileUrl: '',
  };
}

function formatDateTime(v) {
  return formatBeijingDateTime(v);
}

async function load() {
  loading.value = true;
  try {
    const params = { ...pageParams(page.value, pageSize) };
    if (status.value) params.status = status.value;
    const res = await api.get('/admin/briefs', { params });
    list.value = res.briefs || [];
    total.value = res.total || 0;
  } finally {
    loading.value = false;
  }
}

function resetAndLoad() {
  page.value = 1;
  load();
}

function onPage(p) {
  page.value = p;
  load();
}

async function importFile(option) {
  importing.value = true;
  try {
    const data = new FormData();
    data.append('file', option.file);
    const res = await api.post('/admin/briefs/import', data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    ElMessage.success('已导入草稿，请校对后发布');
    Object.assign(form, emptyForm(), {
      id: res.brief.id,
      title: res.brief.title,
      guestName: res.brief.guestName || '',
      summary: res.brief.summary || '',
      contentHtml: res.brief.contentHtml || '',
      status: res.brief.status || 'draft',
      sourceFileUrl: res.brief.sourceFileUrl || '',
    });
    visible.value = true;
    await load();
  } catch (e) {
    ElMessage.error(e.message || '导入失败');
  } finally {
    importing.value = false;
  }
}

function openEdit(row) {
  Object.assign(form, emptyForm(), {
    id: row.id,
    title: row.title,
    guestName: row.guestName || '',
    summary: row.summary || '',
    contentHtml: row.contentHtml || '',
    status: row.status,
    sourceFileUrl: row.sourceFileUrl || '',
  });
  visible.value = true;
}

async function save() {
  if (!form.title?.trim()) {
    ElMessage.warning('请填写标题');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      title: form.title.trim(),
      guestName: form.guestName,
      summary: form.summary,
      contentHtml: form.contentHtml,
      status: form.status,
    };
    if (form.id) await api.put(`/admin/briefs/${form.id}`, payload);
    else await api.post('/admin/briefs', payload);
    ElMessage.success('已保存');
    visible.value = false;
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function setStatus(row, next) {
  try {
    await api.put(`/admin/briefs/${row.id}`, { status: next });
    ElMessage.success(next === 'published' ? '已发布' : '已归档');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确认删除内参「${row.title}」？`, '提示');
    await api.delete(`/admin/briefs/${row.id}`);
    ElMessage.success('已删除');
    if (list.value.length <= 1 && page.value > 1) page.value -= 1;
    await load();
  } catch (e) {
    if (e === 'cancel' || e === 'close') return;
    ElMessage.error(e?.message || '删除失败');
  }
}

async function copyText(text, okMsg = '已复制') {
  const v = String(text || '').trim();
  if (!v) return;
  try {
    await navigator.clipboard.writeText(v);
    ElMessage.success(okMsg);
  } catch {
    ElMessage.info(v);
  }
}

function downloadQr(dataUrl, title) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${String(title || '内参').slice(0, 40)}-小程序码.png`;
  a.click();
}

async function openShare(row) {
  shareVisible.value = true;
  shareLoading.value = true;
  Object.assign(shareForm, {
    id: row.id,
    title: row.title,
    urlLink: '',
    urlLinkError: '',
    path: '',
    qrcodeDataUrl: '',
    qrcodeError: '',
  });
  try {
    const res = await api.post(`/admin/briefs/${row.id}/share-link`, {});
    Object.assign(shareForm, {
      urlLink: res.urlLink || '',
      urlLinkError: res.urlLinkError || '',
      path: res.path || '',
      qrcodeDataUrl: res.qrcodeDataUrl || '',
      qrcodeError: res.qrcodeError || '',
    });
  } catch (e) {
    shareForm.urlLinkError = e.message || '生成失败';
    ElMessage.error(e.message || '生成分发链接失败');
  } finally {
    shareLoading.value = false;
  }
}

useListRefresh(load);
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 16px;
}
.toolbar-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.share-row {
  display: flex;
  gap: 8px;
  width: 100%;
}
.share-tip {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.5;
}
.share-qr {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.share-qr img {
  width: 200px;
  height: 200px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}
.status-chip.is-draft {
  color: #909399;
}
.status-chip.is-published {
  color: #67c23a;
}
.status-chip.is-archived {
  color: #e6a23c;
}
</style>
