<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>前沿动态</h2>
        <p class="muted">手动发布，或审核 AI 自动抓取的待审内容（默认不会自动上线）</p>
      </div>
      <div class="toolbar-actions">
        <el-select v-model="status" clearable placeholder="全部状态" style="width: 140px" @change="load">
          <el-option label="草稿" value="draft" />
          <el-option label="待审核" value="pending" />
          <el-option label="已发布" value="published" />
        </el-select>
        <el-select v-model="sourceType" clearable placeholder="全部来源" style="width: 140px" @change="load">
          <el-option label="手动" value="manual" />
          <el-option label="自动" value="auto" />
        </el-select>
        <el-button :loading="runningAi || isRunning" @click="runAi">运行 AI 抓取</el-button>
        <el-button type="primary" @click="openCreate">手动添加</el-button>
      </div>
    </div>

    <el-alert
      v-if="aiHint"
      :title="aiHint"
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 16px"
    />

    <el-table :data="list" stripe empty-text="暂无动态">
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

    <el-dialog v-model="visible" :title="form.id ? '编辑动态' : '添加动态'" width="680px" append-to-body align-center destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
        <el-form-item label="详细信息">
          <el-input v-model="form.content" type="textarea" :rows="8" />
        </el-form-item>
        <el-form-item v-if="form.aiReason" label="AI 说明">
          <el-input v-model="form.aiReason" type="textarea" :rows="2" disabled />
        </el-form-item>
        <el-form-item label="发布时间">
          <el-date-picker v-model="form.publishedAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]" style="width: 100%" />
        </el-form-item>
        <el-form-item label="原始链接"><el-input v-model="form.sourceUrl" /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="草稿" value="draft" />
            <el-option label="待审核" value="pending" />
            <el-option label="已发布" value="published" />
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
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';
import { startAiFeedJob } from '../utils/aiJob';
import { useAiJobMonitorState } from '../stores/aiJobMonitor';

const list = ref([]);
const status = ref('pending');
const sourceType = ref('');
const visible = ref(false);
const saving = ref(false);
const runningAi = ref(false);
const aiHint = ref('');
const form = reactive(emptyForm());
const { isRunning } = useAiJobMonitorState();
const statusText = {
  draft: '草稿',
  pending: '待审核',
  published: '已发布',
};

function emptyForm() {
  return {
    id: '',
    title: '',
    content: '',
    publishedAt: new Date().toISOString(),
    sourceUrl: '',
    status: 'draft',
    aiReason: '',
  };
}

function formatDateTime(v) {
  return v ? new Date(v).toLocaleString() : '-';
}

function buildAiHint(res) {
  let text = `AI 当前模式：搜索 ${res.search?.provider}（${res.search?.mode}），模型 ${res.llm?.model || res.llm?.provider}（${res.llm?.mode}）；待审自动动态 ${res.pendingAuto || 0} 条。`;
  if (res.currentRun?.status === 'running') {
    text += ' 正在后台抓取中（可去其他页面，完成后会自动通知并刷新）。';
  } else if (res.search?.mode === 'mock' || res.llm?.mode === 'mock') {
    text += ' 未配齐 Key 时会用 mock；当前已 live 的部分会走真实接口。';
  } else {
    text += ' 抓取在服务端后台执行；完成后右上角自动通知，列表会自动更新。';
  }
  return text;
}

async function loadAiHint() {
  try {
    const res = await api.get('/admin/ai/status');
    aiHint.value = buildAiHint(res);
    if (res.currentRun?.status === 'running') runningAi.value = true;
  } catch {
    aiHint.value = '';
  }
}

async function load() {
  const params = {};
  if (status.value) params.status = status.value;
  if (sourceType.value) params.sourceType = sourceType.value;
  const res = await api.get('/admin/feed', { params });
  list.value = res.posts;
}

function openCreate() {
  Object.assign(form, emptyForm());
  visible.value = true;
}

function openEdit(row) {
  Object.assign(form, { ...emptyForm(), ...row, publishedAt: row.publishedAt });
  visible.value = true;
}

async function save() {
  saving.value = true;
  try {
    const payload = {
      title: form.title,
      content: form.content,
      publishedAt: form.publishedAt,
      sourceUrl: form.sourceUrl,
      status: form.status,
    };
    if (form.id) await api.put(`/admin/feed/${form.id}`, payload);
    else await api.post('/admin/feed', payload);
    ElMessage.success('已保存');
    visible.value = false;
    await load();
    await loadAiHint();
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
  await loadAiHint();
}

async function remove(row) {
  await ElMessageBox.confirm(`确认删除「${row.title}」？`, '提示');
  await api.delete(`/admin/feed/${row.id}`);
  ElMessage.success('已删除');
  await load();
  await loadAiHint();
}

async function runAi() {
  runningAi.value = true;
  try {
    await startAiFeedJob({ limitPerMember: 2 });
    status.value = 'pending';
    sourceType.value = 'auto';
    await loadAiHint();
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
  await loadAiHint();
  runningAi.value = false;
}

onMounted(async () => {
  await load();
  await loadAiHint();
  runningAi.value = isRunning.value;
  window.addEventListener('ai-feed-done', onAiDone);
});

onBeforeUnmount(() => {
  window.removeEventListener('ai-feed-done', onAiDone);
});
</script>
