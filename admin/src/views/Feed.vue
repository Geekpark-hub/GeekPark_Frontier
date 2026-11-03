<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>前沿动态</h2>
        <p class="muted">手动发布，或审核 AI 自动抓取的待审内容（默认不会自动上线）</p>
      </div>
      <div class="toolbar-actions">
        <el-select v-model="status" clearable placeholder="全部状态" style="width: 140px" @change="resetAndLoad">
          <el-option label="全部状态" value="" />
          <el-option label="草稿" value="draft" />
          <el-option label="待审核" value="pending" />
          <el-option label="已发布" value="published" />
          <el-option label="已拒绝" value="rejected" />
        </el-select>
        <el-select v-model="sourceType" clearable placeholder="全部来源" style="width: 140px" @change="resetAndLoad">
          <el-option label="全部来源" value="" />
          <el-option label="手动" value="manual" />
          <el-option label="自动" value="auto" />
        </el-select>
        <el-button
          type="danger"
          plain
          :disabled="!selectedIds.length"
          :loading="batchDeleting"
          @click="batchRemove"
        >
          批量删除{{ selectedIds.length ? ` (${selectedIds.length})` : '' }}
        </el-button>
        <el-button @click="openHero">小程序封面</el-button>
        <el-button :loading="runningAi || isRunning" @click="runAi">运行 AI 抓取</el-button>
        <el-button type="primary" @click="openCreate">手动添加</el-button>
      </div>
    </div>

    <el-table
      :data="list"
      stripe
      empty-text="暂无动态"
      row-key="id"
      v-loading="loading"
      @selection-change="onSelectionChange"
    >
      <el-table-column type="selection" width="48" />
      <el-table-column prop="title" label="标题" min-width="200" />
      <el-table-column label="关联会员" width="140">
        <template #default="{ row }">
          {{ row.relatedMember ? `${row.relatedMember.name}` : '-' }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <span class="status-chip" :class="`is-${row.status}`">{{ statusText[row.status] || row.status }}</span>
        </template>
      </el-table-column>
      <el-table-column label="来源" width="90">
        <template #default="{ row }">{{ row.sourceType === 'auto' ? '自动' : '手动' }}</template>
      </el-table-column>
      <el-table-column label="发布时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.publishedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.status !== 'published'" link type="success" @click="publish(row)">发布</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <ListPager v-model:page="page" :page-size="pageSize" :total="total" @update:page="onPage" />

    <el-dialog v-model="heroVisible" title="小程序动态页封面" width="560px" append-to-body align-center destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="显示封面">
          <div class="hero-switch">
            <el-switch v-model="hero.enabled" active-text="开启" inactive-text="关闭" />
            <span class="muted">关闭后小程序动态页将不展示顶部封面</span>
          </div>
        </el-form-item>
        <el-form-item label="封面图片">
          <div class="cover-box">
            <el-upload
              class="cover-upload"
              drag
              :show-file-list="false"
              :http-request="uploadHero"
              accept="image/*"
              :disabled="heroUploading || !hero.enabled"
            >
              <div
                class="cover-stage"
                :class="{ 'has-image': !!heroPreview && !heroBroken, uploading: heroUploading, disabled: !hero.enabled }"
              >
                <img
                  v-if="heroPreview && !heroBroken"
                  class="cover-preview"
                  :src="heroPreview"
                  alt="封面预览"
                  @load="heroBroken = false"
                  @error="heroBroken = true"
                />
                <div v-else class="cover-empty-inner">
                  <span class="cover-empty-title">{{
                    !hero.enabled
                      ? '已关闭展示'
                      : heroPreview && heroBroken
                        ? '图片加载失败，点击重试'
                        : '点击或拖拽上传封面'
                  }}</span>
                  <span class="cover-empty-sub">建议宽度 ≥1500px；未上传时用小程序默认头图</span>
                </div>
                <div v-if="heroUploading" class="cover-loading">
                  <span class="cover-spinner" />
                  <span>上传中…</span>
                </div>
                <span v-else-if="hero.enabled && heroPreview && !heroBroken" class="cover-badge">点击更换</span>
              </div>
            </el-upload>
            <div class="cover-meta">
              <el-button
                v-if="hero.url"
                link
                type="danger"
                :disabled="heroUploading"
                @click="hero.url = ''; heroBroken = false"
              >
                清除自定义图（恢复默认）
              </el-button>
              <el-button link type="primary" :disabled="!hero.enabled" @click="heroShowUrl = !heroShowUrl">
                {{ heroShowUrl ? '收起链接' : '粘贴图片链接' }}
              </el-button>
            </div>
            <el-input v-if="heroShowUrl" v-model="hero.url" placeholder="粘贴图片 URL" clearable :disabled="!hero.enabled" />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="heroVisible = false">取消</el-button>
        <el-button type="primary" :loading="heroSaving" @click="saveHero">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="visible" :title="form.id ? '编辑动态' : '添加动态'" width="680px" append-to-body align-center destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
        <el-form-item label="关联会员">
          <el-select
            v-model="form.relatedMemberId"
            filterable
            clearable
            placeholder="选择关联会员（可选）"
            style="width: 100%"
          >
            <el-option
              v-for="m in memberOptions"
              :key="m.id"
              :label="memberLabel(m)"
              :value="m.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="详细信息">
          <el-input v-model="form.content" type="textarea" :rows="8" />
        </el-form-item>
        <el-form-item v-if="form.aiReason" label="AI 说明">
          <el-input v-model="form.aiReason" type="textarea" :rows="2" disabled />
        </el-form-item>
        <el-form-item label="发布时间">
          <el-date-picker v-model="form.publishedAt" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" />
        </el-form-item>
        <el-form-item label="原始链接"><el-input v-model="form.sourceUrl" /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="草稿" value="draft" />
            <el-option label="待审核" value="pending" />
            <el-option label="已发布" value="published" />
            <el-option label="已拒绝" value="rejected" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onActivated, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';
import ListPager from '../components/ListPager.vue';
import { DEFAULT_PAGE_SIZE, pageParams } from '../utils/listPage';
import { startAiFeedJob } from '../utils/aiJob';
import { useAiJobMonitorState } from '../stores/aiJobMonitor';
import {
  beijingPickerToUtc,
  formatBeijingDateTime,
  utcToBeijingPicker,
} from '../utils/datetime';

const list = ref([]);
const loading = ref(false);
const page = ref(1);
const pageSize = DEFAULT_PAGE_SIZE;
const total = ref(0);
const memberOptions = ref([]);
const selectedIds = ref([]);
const status = ref(''); // 默认展示全部状态
const sourceType = ref('');
const visible = ref(false);
const saving = ref(false);
const batchDeleting = ref(false);
const runningAi = ref(false);
const heroVisible = ref(false);
const heroSaving = ref(false);
const heroUploading = ref(false);
const heroShowUrl = ref(false);
const heroBroken = ref(false);
const hero = reactive({ enabled: true, url: '' });
const form = reactive(emptyForm());
const { isRunning } = useAiJobMonitorState();
const heroPreview = computed(() => String(hero.url || '').trim());
const statusText = {
  draft: '草稿',
  pending: '待审核',
  published: '已发布',
  rejected: '已拒绝',
};

function emptyForm() {
  return {
    id: '',
    title: '',
    content: '',
    publishedAt: utcToBeijingPicker(new Date()),
    sourceUrl: '',
    status: 'draft',
    aiReason: '',
    relatedMemberId: '',
  };
}

function memberLabel(m) {
  if (!m) return '';
  const company = m.company ? ` / ${m.company}` : '';
  return `${m.name || '未命名'}${company}`;
}

async function loadMembers() {
  try {
    const res = await api.get('/admin/feed/member-options');
    memberOptions.value = res.members || [];
  } catch {
    memberOptions.value = [];
  }
}

function formatDateTime(v) {
  return formatBeijingDateTime(v);
}

function onSelectionChange(rows) {
  selectedIds.value = (rows || []).map((r) => r.id).filter(Boolean);
}

async function load() {
  loading.value = true;
  try {
    const params = { ...pageParams(page.value, pageSize) };
    if (status.value) params.status = status.value;
    if (sourceType.value) params.sourceType = sourceType.value;
    const res = await api.get('/admin/feed', { params });
    list.value = res.posts || [];
    total.value = res.total || 0;
    selectedIds.value = [];
  } finally {
    loading.value = false;
  }
}

function resetAndLoad() {
  page.value = 1;
  load();
}

async function openHero() {
  heroShowUrl.value = false;
  heroBroken.value = false;
  try {
    const res = await api.get('/admin/feed/hero');
    hero.enabled = res.hero?.enabled !== false;
    hero.url = res.hero?.url || '';
  } catch (e) {
    ElMessage.error(e.message || '加载封面设置失败');
    return;
  }
  heroVisible.value = true;
}

async function uploadHero(option) {
  heroUploading.value = true;
  try {
    const data = new FormData();
    data.append('file', option.file);
    const token = localStorage.getItem('admin_token');
    const res = await api.post('/admin/upload/image', data, {
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
      },
      timeout: 60000,
      skipGlobalLoading: true,
    });
    hero.url = res.url;
    heroBroken.value = false;
    ElMessage.success('封面已上传');
    option.onSuccess?.(res);
  } catch (e) {
    ElMessage.error(e.message || '上传失败');
    option.onError?.(e);
  } finally {
    heroUploading.value = false;
  }
}

async function saveHero() {
  heroSaving.value = true;
  try {
    const res = await api.put('/admin/feed/hero', {
      enabled: Boolean(hero.enabled),
      url: String(hero.url || '').trim(),
    });
    hero.enabled = res.hero?.enabled !== false;
    hero.url = res.hero?.url || '';
    ElMessage.success('动态页封面已保存');
    heroVisible.value = false;
  } catch (e) {
    ElMessage.error(e.message || '保存失败');
  } finally {
    heroSaving.value = false;
  }
}

function openCreate() {
  Object.assign(form, emptyForm());
  if (!memberOptions.value.length) loadMembers();
  visible.value = true;
}

function openEdit(row) {
  Object.assign(form, {
    ...emptyForm(),
    ...row,
    publishedAt: utcToBeijingPicker(row.publishedAt),
    relatedMemberId: row.relatedMemberId || row.relatedMember?.id || '',
  });
  if (!memberOptions.value.length) loadMembers();
  visible.value = true;
}

async function save() {
  saving.value = true;
  try {
    const payload = {
      title: form.title,
      content: form.content,
      publishedAt: beijingPickerToUtc(form.publishedAt),
      sourceUrl: form.sourceUrl,
      status: form.status,
      relatedMemberId: form.relatedMemberId || null,
    };
    if (form.id) await api.put(`/admin/feed/${form.id}`, payload);
    else await api.post('/admin/feed', payload);
    ElMessage.success('已保存');
    visible.value = false;
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function publish(row) {
  await api.put(`/admin/feed/${row.id}`, { status: 'published' });
  ElMessage.success('已发布');
  await load();
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确认删除「${row.title}」？`, '提示');
    await api.delete(`/admin/feed/${row.id}`);
    ElMessage.success('已删除');
    if (list.value.length <= 1 && page.value > 1) page.value -= 1;
    await load();
  } catch (e) {
    if (e === 'cancel' || e === 'close') return;
    ElMessage.error(e?.message || '删除失败');
  }
}

async function batchRemove() {
  const ids = [...selectedIds.value];
  if (!ids.length) return;
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${ids.length} 条动态？此操作不可恢复。`, '批量删除');
    batchDeleting.value = true;
    const res = await api.post('/admin/feed/batch-delete', { ids });
    ElMessage.success(`已删除 ${res.deleted ?? ids.length} 条`);
    if (list.value.length <= ids.length && page.value > 1) page.value -= 1;
    await load();
  } catch (e) {
    if (e === 'cancel' || e === 'close') return;
    ElMessage.error(e?.message || '批量删除失败');
  } finally {
    batchDeleting.value = false;
  }
}

async function runAi() {
  runningAi.value = true;
  try {
    await startAiFeedJob({ limitPerMember: 10 });
    status.value = 'pending';
    sourceType.value = 'auto';
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    // 按钮 loading 跟全局任务状态走
    runningAi.value = isRunning.value;
  }
}

async function onAiDone() {
  status.value = 'pending';
  sourceType.value = 'auto';
  await load();
  runningAi.value = false;
}

function onPage(p) {
  page.value = p;
  load();
}

let feedActivatedOnce = false;

onMounted(async () => {
  await Promise.all([load(), loadMembers()]);
  runningAi.value = isRunning.value;
  window.addEventListener('ai-feed-done', onAiDone);
});

onActivated(() => {
  if (!feedActivatedOnce) {
    feedActivatedOnce = true;
    return;
  }
  load();
});

onBeforeUnmount(() => {
  window.removeEventListener('ai-feed-done', onAiDone);
});
</script>

<style scoped>
.hero-switch {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.cover-box {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cover-upload {
  width: 100%;
}
.cover-upload :deep(.el-upload),
.cover-upload :deep(.el-upload-dragger) {
  width: 100%;
  height: auto !important;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 12px;
  overflow: hidden;
}
.cover-stage {
  position: relative;
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
  border: 1px dashed rgba(20, 32, 43, 0.18);
  background: linear-gradient(160deg, #f4f7f8 0%, #eef2f5 100%);
  cursor: pointer;
}
.cover-stage:not(.has-image) {
  aspect-ratio: 16 / 9;
}
.cover-stage.disabled {
  cursor: not-allowed;
  opacity: 0.72;
}
.cover-stage.has-image {
  border-style: solid;
  border-color: rgba(20, 32, 43, 0.08);
  aspect-ratio: auto;
}
.cover-preview {
  display: block;
  width: 100%;
  height: auto;
  vertical-align: top;
}
.cover-empty-inner {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #6d7883;
}
.cover-empty-title {
  font-size: 15px;
  font-weight: 600;
  color: #24303a;
}
.cover-empty-sub {
  font-size: 12px;
}
.cover-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #fff;
  background: rgba(20, 32, 43, 0.48);
  font-size: 14px;
  font-weight: 600;
}
.cover-badge {
  position: absolute;
  right: 12px;
  bottom: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(20, 32, 43, 0.72);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  pointer-events: none;
}
.cover-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
.cover-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
