<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>社群投票</h2>
        <p class="muted">进行中投票会置顶信息流，直到后台点「结束」；「分享」生成落地页短链与小程序码</p>
      </div>
      <div class="toolbar-actions">
        <el-select v-model="status" clearable placeholder="全部状态" style="width: 140px" @change="resetAndLoad">
          <el-option label="草稿" value="draft" />
          <el-option label="进行中" value="published" />
          <el-option label="已结束" value="ended" />
        </el-select>
        <el-button type="primary" @click="openCreate">创建投票</el-button>
      </div>
    </div>
    <el-table :data="list" stripe empty-text="暂无投票" v-loading="loading">
      <el-table-column prop="title" label="标题" min-width="220" />
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <span class="status-chip" :class="`is-${row.status}`">{{ statusText[row.status] || row.status }}</span>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="90">
        <template #default="{ row }">{{ row.multiSelect ? '多选' : '单选' }}</template>
      </el-table-column>
      <el-table-column label="截止" width="170">
        <template #default="{ row }">{{ formatDateTime(row.endAt) }}</template>
      </el-table-column>
      <el-table-column label="票数" width="80">
        <template #default="{ row }">{{ row._count?.votes || 0 }}</template>
      </el-table-column>
      <el-table-column label="操作" width="320" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.status !== 'published'" link type="success" @click="setStatus(row, 'published')">发布</el-button>
          <el-button v-if="row.status === 'published'" link type="warning" @click="setStatus(row, 'ended')">结束</el-button>
          <el-button link @click="openShare(row)">分享</el-button>
          <el-button link @click="showResults(row)">结果</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <ListPager v-model:page="page" :page-size="pageSize" :total="total" @update:page="onPage" />

    <el-dialog
      v-model="visible"
      :title="form.id ? '编辑投票' : '创建投票'"
      width="640px"
      append-to-body
      align-center
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item label="标题" required><el-input v-model="form.title" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="form.description" type="textarea" :rows="3" /></el-form-item>
        <div class="switch-row">
          <el-form-item label="多选"><el-switch v-model="form.multiSelect" /></el-form-item>
          <el-form-item label="向会员公开投票人">
            <el-switch v-model="form.showVoters" />
            <span class="field-tip">关闭时小程序不展示谁投了什么；后台「结果」始终可看</span>
          </el-form-item>
        </div>
        <el-form-item label="开始时间">
          <el-date-picker v-model="form.startAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]" style="width: 100%" />
        </el-form-item>
        <el-form-item label="结束时间">
          <el-date-picker v-model="form.endAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]" style="width: 100%" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="草稿" value="draft" />
            <el-option label="已发布" value="published" />
            <el-option label="已结束" value="ended" />
          </el-select>
        </el-form-item>
        <el-form-item label="选项">
          <div v-for="(opt, idx) in form.options" :key="idx" class="option-row">
            <el-input v-model="form.options[idx]" />
            <el-button @click="form.options.splice(idx, 1)">删</el-button>
          </div>
          <el-button @click="form.options.push('')">添加选项</el-button>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resultVisible" title="投票结果" width="720px" append-to-body align-center>
      <div v-if="results">
        <p class="result-summary">
          已投票 {{ results.votedCount }} 人 · 未投票 {{ results.unvotedCount }} 人 · 总票数 {{ results.totalVotes }}
        </p>
        <h4 class="result-block-title">选项统计</h4>
        <el-table :data="results.options" size="small">
          <el-table-column prop="text" label="选项" />
          <el-table-column prop="count" label="票数" width="80" />
          <el-table-column prop="ratio" label="比例%" width="90" />
        </el-table>

        <h4 class="result-block-title">投票明细（谁投了什么）</h4>
        <el-table v-if="voters.length" :data="voters" size="small">
          <el-table-column prop="name" label="会员" width="120" />
          <el-table-column prop="company" label="公司" min-width="140" />
          <el-table-column prop="optionText" label="所选选项" width="140" />
          <el-table-column label="投票时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
        </el-table>
        <p v-else class="muted">暂无投票记录</p>
      </div>
    </el-dialog>

    <el-dialog
      v-model="shareVisible"
      title="分享投票"
      width="560px"
      append-to-body
      align-center
      destroy-on-close
    >
      <p class="muted share-tip">
        打开后进入独立投票落地页。短链固定对应本投票（可发短信 / 邮件 / 网页）；打开时由服务端跳转微信，微信侧约 30 天自动续期，对外链接不变。小程序码可印海报或发群。
      </p>
      <el-form label-position="top">
        <el-form-item label="分享短链">
          <p v-if="shareForm.urlLinkError" class="muted share-tip">{{ shareForm.urlLinkError }}</p>
          <div class="share-row">
            <el-input :model-value="shareForm.urlLink" readonly placeholder="生成中…" />
            <el-button
              type="primary"
              :loading="shareLoading"
              :disabled="!shareForm.urlLink"
              @click="copyText(shareForm.urlLink, '已复制分享短链')"
            >复制</el-button>
          </div>
          <p v-if="shareForm.wxExpiresLabel" class="muted share-tip share-expire">
            微信跳转有效至 {{ shareForm.wxExpiresLabel }}（到期后打开短链会自动续期）
          </p>
        </el-form-item>
        <el-form-item label="小程序路径">
          <div class="share-row">
            <el-input :model-value="shareForm.path" readonly />
            <el-button @click="copyText(shareForm.path, '已复制小程序路径')">复制</el-button>
          </div>
        </el-form-item>
        <el-form-item label="小程序码">
          <div v-if="shareForm.qrcodeDataUrl" class="share-qr">
            <img :src="shareForm.qrcodeDataUrl" alt="投票小程序码" />
            <el-button link type="primary" @click="downloadQr(shareForm.qrcodeDataUrl, shareForm.title || '投票')">
              下载小程序码
            </el-button>
          </div>
          <p v-else class="muted">{{ shareForm.qrcodeError || '生成短链时一并拉取；未正式发布时将尝试生成体验版小程序码' }}</p>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="shareVisible = false">关闭</el-button>
        <el-button :loading="shareLoading" @click="refreshWxJump">刷新微信跳转</el-button>
        <el-button
          type="primary"
          :loading="shareLoading"
          :disabled="!shareForm.urlLink"
          @click="copyText(shareForm.urlLink, '已复制分享短链')"
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
import { DEFAULT_PAGE_SIZE, pageParams } from '../utils/listPage';
import {
  beijingPickerToUtc,
  formatBeijingDateTime,
  utcToBeijingPicker,
} from '../utils/datetime';
import { useListRefresh } from '../utils/useListRefresh';

const list = ref([]);
const loading = ref(false);
const page = ref(1);
const pageSize = DEFAULT_PAGE_SIZE;
const total = ref(0);
const status = ref('');
const visible = ref(false);
const resultVisible = ref(false);
const results = ref(null);
const voters = ref([]);
const saving = ref(false);
const shareVisible = ref(false);
const shareLoading = ref(false);
const shareForm = reactive({
  id: '',
  title: '',
  urlLink: '',
  urlLinkError: '',
  wxExpiresLabel: '',
  path: '',
  qrcodeDataUrl: '',
  qrcodeError: '',
});
const form = reactive(emptyForm());
const statusText = {
  draft: '草稿',
  published: '进行中',
  ended: '已结束',
};

function emptyForm() {
  const now = new Date();
  const end = new Date(now.getTime() + 7 * 86400000);
  return {
    id: '',
    title: '',
    description: '',
    multiSelect: false,
    showVoters: false,
    startAt: utcToBeijingPicker(now),
    endAt: utcToBeijingPicker(end),
    status: 'draft',
    options: ['同意', '不同意', '暂缓'],
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
    const res = await api.get('/admin/polls', { params });
    list.value = res.polls || [];
    total.value = res.total || 0;
  } finally {
    loading.value = false;
  }
}

function resetAndLoad() {
  page.value = 1;
  load();
}

function openCreate() {
  Object.assign(form, emptyForm());
  visible.value = true;
}

function openEdit(row) {
  Object.assign(form, {
    id: row.id,
    title: row.title,
    description: row.description,
    multiSelect: row.multiSelect,
    showVoters: row.showVoters,
    startAt: utcToBeijingPicker(row.startAt),
    endAt: utcToBeijingPicker(row.endAt),
    status: row.status,
    options: (row.options || []).map((o) => o.text),
  });
  visible.value = true;
}

async function save() {
  saving.value = true;
  try {
    const payload = {
      title: form.title,
      description: form.description,
      multiSelect: form.multiSelect,
      showVoters: form.showVoters,
      startAt: beijingPickerToUtc(form.startAt),
      endAt: beijingPickerToUtc(form.endAt),
      status: form.status,
      options: form.options.filter(Boolean),
    };
    if (form.id) await api.put(`/admin/polls/${form.id}`, payload);
    else await api.post('/admin/polls', payload);
    ElMessage.success('已保存');
    visible.value = false;
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function setStatus(row, status) {
  await api.put(`/admin/polls/${row.id}`, { status });
  ElMessage.success('已更新');
  await load();
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

function wxExpiresLabelOf(v) {
  if (!v) return '';
  const label = formatBeijingDateTime(v);
  return label === '-' ? '' : label;
}

async function openShare(row) {
  shareForm.id = row.id;
  shareForm.title = row.title || '';
  shareForm.path = `/pages/poll/share?id=${row.id}`;
  shareForm.urlLink = '';
  shareForm.urlLinkError = '';
  shareForm.wxExpiresLabel = '';
  shareForm.qrcodeDataUrl = '';
  shareForm.qrcodeError = '';
  shareVisible.value = true;
  await genShareLink({ quiet: true, autoCopy: false });
}

async function refreshWxJump() {
  await genShareLink({ quiet: false, autoCopy: false, forceRefresh: true });
  if (shareForm.urlLink) {
    ElMessage.success('已刷新微信跳转；对外短链不变');
  }
}

async function genShareLink({ quiet = false, autoCopy = true, forceRefresh = false } = {}) {
  if (!shareForm.id) return;
  shareLoading.value = true;
  try {
    const res = await api.post(`/admin/polls/${shareForm.id}/share-link`, { forceRefresh });
    shareForm.urlLink = res.urlLink || '';
    shareForm.urlLinkError = res.urlLinkError || '';
    shareForm.wxExpiresLabel = wxExpiresLabelOf(res.wxExpiresAt);
    shareForm.path = res.path || shareForm.path;
    shareForm.qrcodeDataUrl = res.qrcodeDataUrl || '';
    shareForm.qrcodeError = res.qrcodeError || '';
    if (quiet) {
      if (!shareForm.urlLink && shareForm.urlLinkError) {
        ElMessage.warning(shareForm.urlLinkError);
      } else if (!shareForm.urlLink && shareForm.qrcodeDataUrl) {
        ElMessage.success('短链暂不可用，已生成体验版小程序码');
      }
      return;
    }
    if (autoCopy && shareForm.urlLink) {
      await copyText(shareForm.urlLink, '已复制分享短链，可发给别人');
    } else if (!shareForm.urlLink && shareForm.qrcodeDataUrl) {
      ElMessage.success('短链暂不可用，已生成体验版小程序码');
    } else if (shareForm.urlLinkError) {
      ElMessage.warning(shareForm.urlLinkError);
    }
  } catch (e) {
    ElMessage.error(e?.message || '生成失败（需已发布小程序且开通 URL Link）');
  } finally {
    shareLoading.value = false;
  }
}

function downloadQr(dataUrl, name) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${String(name || 'share').slice(0, 40)}-小程序码.png`;
  a.click();
}

async function showResults(row) {
  const res = await api.get(`/admin/polls/${row.id}/results`);
  results.value = res.results;
  voters.value = res.voters || [];
  resultVisible.value = true;
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确认删除「${row.title}」？`, '提示');
    await api.delete(`/admin/polls/${row.id}`);
    ElMessage.success('已删除');
    await load();
  } catch (e) {
    if (e === 'cancel' || e === 'close') return;
    ElMessage.error(e?.message || '删除失败');
  }
}

function onPage(p) {
  page.value = p;
  load();
}

useListRefresh(load);
</script>

<style scoped>
.switch-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.option-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  width: 100%;
}

.field-tip {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
}

.result-summary {
  margin: 0 0 16px;
  color: var(--ink-soft);
}

.result-block-title {
  margin: 20px 0 10px;
  font-size: 14px;
  font-weight: 600;
}

.share-tip {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.5;
}

.share-expire {
  margin: 8px 0 0;
}

.share-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.share-qr {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.share-qr img {
  width: 180px;
  height: 180px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: #fff;
}
</style>
