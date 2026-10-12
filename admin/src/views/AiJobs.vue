<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>AI 与定时任务</h2>
        <p class="muted">抓取在服务端后台执行；完成后右上角会自动通知，相关页也会自动刷新</p>
      </div>
      <div class="toolbar-actions">
        <el-button :loading="runningMaint" @click="runMaint">运行维护任务</el-button>
        <el-button type="primary" :loading="runningAi || aiRunning" @click="runAi">运行 AI 抓取</el-button>
      </div>
    </div>

    <el-alert
      v-if="runHint"
      :title="runHint"
      :type="runHintType"
      :closable="false"
      show-icon
      style="margin-bottom: 16px"
    />

    <el-row :gutter="16" class="stats">
      <el-col :span="8">
        <div class="stat">
          <div class="label">搜索</div>
          <div class="value">{{ status.search?.provider || '-' }} / {{ status.search?.mode || '-' }}</div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat">
          <div class="label">大模型</div>
          <div class="value">{{ status.llm?.mode || '-' }} / {{ shortModel }}</div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat">
          <div class="label">待审自动动态</div>
          <div class="value">{{ status.pendingAuto ?? pendingAuto ?? 0 }}</div>
        </div>
      </el-col>
    </el-row>

    <el-table :data="logs" stripe empty-text="暂无任务日志" style="margin-top: 18px">
      <el-table-column prop="type" label="类型" width="120" />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column prop="summary" label="摘要" min-width="280" />
      <el-table-column label="时间" width="180">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';
import { startAiFeedJob } from '../utils/aiJob';
import { useAiJobMonitorState } from '../stores/aiJobMonitor';

const status = reactive({});
const logs = ref([]);
const runningAi = ref(false);
const runningMaint = ref(false);
const { currentRun, pendingAuto, isRunning } = useAiJobMonitorState();
const aiRunning = isRunning;

const shortModel = computed(() => {
  const m = status.llm?.model || '';
  return m.includes('/') ? m.split('/').pop() : m || '-';
});

const runHint = computed(() => {
  const run = currentRun.value || status.currentRun;
  if (!run) return '';
  if (run.status === 'running') return run.summary || '抓取进行中…';
  if (run.status === 'error') return `最近一次失败：${run.summary || run.error || ''}`;
  if (run.status === 'ok') return `最近一次完成：${run.summary || ''}`;
  return '';
});

const runHintType = computed(() => {
  const s = (currentRun.value || status.currentRun)?.status;
  if (s === 'running') return 'info';
  if (s === 'error') return 'error';
  if (s === 'ok') return 'success';
  return 'info';
});

function formatDateTime(v) {
  return v ? new Date(v).toLocaleString() : '-';
}

async function load() {
  const res = await api.get('/admin/ai/status');
  Object.assign(status, res);
  logs.value = res.recentJobs || [];
}

async function runAi() {
  runningAi.value = true;
  try {
    await startAiFeedJob({ limitPerMember: 2 });
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    runningAi.value = false;
  }
}

async function runMaint() {
  runningMaint.value = true;
  try {
    const res = await api.post('/admin/jobs/maintenance');
    ElMessage.success(res.result?.summary || '完成');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    runningMaint.value = false;
  }
}

async function onAiDone() {
  await load();
}

watch(currentRun, (run) => {
  if (run) status.currentRun = run;
});

onMounted(async () => {
  await load();
  window.addEventListener('ai-feed-done', onAiDone);
});

onBeforeUnmount(() => {
  window.removeEventListener('ai-feed-done', onAiDone);
});
</script>

<style scoped>
.stats {
  margin-top: 4px;
}
.stat {
  background: #f7f9fa;
  border: 1px solid rgba(20, 32, 43, 0.06);
  border-radius: 12px;
  padding: 16px 18px;
}
.label {
  color: var(--muted, #6d7883);
  font-size: 12px;
  margin-bottom: 8px;
}
.value {
  font-size: 16px;
  font-weight: 600;
  word-break: break-all;
}
</style>
