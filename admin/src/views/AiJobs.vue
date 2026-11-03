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
      <el-col :span="6">
        <div class="stat">
          <div class="label">搜索</div>
          <div class="value">{{ status.search?.provider || '-' }} / {{ status.search?.mode || '-' }}</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat">
          <div class="label">大模型</div>
          <div class="value">{{ status.llm?.mode || '-' }} / {{ shortModel }}</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat">
          <div class="label">RSS 信息源</div>
          <div class="value">
            <router-link class="link" to="/sources">管理 {{ status.rss?.feeds || 0 }} 路</router-link>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat">
          <div class="label">待审自动动态</div>
          <div class="value">{{ status.pendingAuto ?? pendingAuto ?? 0 }}</div>
        </div>
      </el-col>
    </el-row>

    <el-table
      :data="logs"
      stripe
      empty-text="暂无任务日志"
      style="margin-top: 18px"
      highlight-current-row
      class="job-table"
      v-loading="loading"
      @row-click="openDetail"
    >
      <el-table-column prop="type" label="类型" width="120">
        <template #default="{ row }">{{ typeLabel(row.type) }}</template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column prop="summary" label="摘要" min-width="280" show-overflow-tooltip />
      <el-table-column label="时间" width="180">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="90" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click.stop="openDetail(row)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>
    <ListPager v-model:page="page" :page-size="pageSize" :total="total" @update:page="onPage" />

    <el-drawer
      v-model="drawer"
      size="520px"
      :title="drawerTitle"
      append-to-body
      destroy-on-close
      class="job-drawer"
    >
      <div v-if="active" class="drawer-body">
        <div class="meta">
          <p><span class="k">类型</span>{{ typeLabel(active.type) }}（{{ active.type }}）</p>
          <p><span class="k">状态</span>{{ active.status || '-' }}</p>
          <p><span class="k">时间</span>{{ formatDateTime(active.createdAt) }}</p>
        </div>

        <h4>摘要</h4>
        <p class="summary">{{ active.summary || '—' }}</p>

        <template v-if="active.type === 'ai_feed'">
          <h4>抓取指标</h4>
          <div class="metric-grid">
            <div v-for="item in aiMetrics" :key="item.label" class="metric">
              <div class="metric-label">{{ item.label }}</div>
              <div class="metric-value">{{ item.value }}</div>
            </div>
          </div>

          <h4>服务状态</h4>
          <p class="line">搜索：{{ detail?.searchStatus?.provider || '-' }} / {{ detail?.searchStatus?.mode || '-' }}</p>
          <p class="line">大模型：{{ detail?.llmStatus?.mode || '-' }} / {{ detailModel }}</p>
          <p class="line">RSS：{{ rssLine }}</p>
          <p v-if="detail?.startedAt || detail?.finishedAt" class="line muted">
            {{ formatDateTime(detail.startedAt) }} → {{ formatDateTime(detail.finishedAt) }}
          </p>

          <template v-if="rejectReasonItems.length">
            <h4>拒绝原因分布</h4>
            <div class="tags">
              <span v-for="item in rejectReasonItems" :key="item.label" class="tag">
                {{ item.label }} · {{ item.count }}
              </span>
            </div>
          </template>

          <template v-if="rejectSamples.length">
            <h4>拒绝明细（最多 {{ rejectSamples.length }} 条）</h4>
            <ul class="sample-list">
              <li v-for="(row, idx) in rejectSamples" :key="`rj-${idx}`">
                <div class="sample-title">{{ row.title || '（无标题）' }}</div>
                <div class="sample-meta muted">
                  {{ row.member || '—' }}{{ row.company ? ` / ${row.company}` : '' }}
                  · {{ row.reason }}
                </div>
                <a v-if="row.url" class="sample-link" :href="row.url" target="_blank" rel="noreferrer">
                  {{ row.url }}
                </a>
              </li>
            </ul>
          </template>
          <p v-else-if="(detail?.rejected || 0) > 0" class="muted">
            本次日志未记录拒绝明细（旧任务）；重新运行抓取后可查看具体原因。
          </p>

          <template v-if="skipSamples.length">
            <h4>去重跳过明细</h4>
            <ul class="sample-list">
              <li v-for="(row, idx) in skipSamples" :key="`sk-${idx}`">
                <div class="sample-title">{{ row.title || '（无标题）' }}</div>
                <div class="sample-meta muted">
                  {{ row.member || '—' }} · {{ row.reason }}
                </div>
                <a v-if="row.url" class="sample-link" :href="row.url" target="_blank" rel="noreferrer">
                  {{ row.url }}
                </a>
              </li>
            </ul>
          </template>

          <template v-if="deadLinkSamples.length">
            <h4>失效链接明细</h4>
            <ul class="sample-list">
              <li v-for="(row, idx) in deadLinkSamples" :key="`dl-${idx}`">
                <div class="sample-title">{{ row.title || '（无标题）' }}</div>
                <div class="sample-meta muted">
                  {{ row.member || '—' }} · {{ row.reason }}
                </div>
                <a v-if="row.url" class="sample-link" :href="row.url" target="_blank" rel="noreferrer">
                  {{ row.url }}
                </a>
              </li>
            </ul>
          </template>

          <template v-if="errors.length">
            <h4>错误（{{ errors.length }}）</h4>
            <ul class="err-list">
              <li v-for="(err, idx) in errors" :key="idx">
                <strong v-if="err.name || err.memberId">{{ err.name || err.memberId }}：</strong>
                {{ err.error || err.message || JSON.stringify(err) }}
              </li>
            </ul>
          </template>
        </template>

        <template v-else-if="active.type === 'maintenance'">
          <h4>维护指标</h4>
          <p class="muted" style="margin: 0 0 12px">
            「状态改为已过期」只改库；「到期订阅消息」才是发微信。未推送=没绑微信等，失败=接口报错可重试。
          </p>
          <div class="metric-grid">
            <div class="metric">
              <div class="metric-label">状态改为已过期</div>
              <div class="metric-value">{{ detail?.expiredMembers ?? 0 }}</div>
            </div>
            <div class="metric">
              <div class="metric-label">到期消息·成功</div>
              <div class="metric-value">
                {{
                  Math.max(
                    0,
                    (detail?.notices?.noticed || 0) -
                      (detail?.notices?.failed || 0) -
                      (detail?.notices?.skipped || 0)
                  )
                }}
              </div>
            </div>
            <div class="metric">
              <div class="metric-label">到期消息·未推送</div>
              <div class="metric-value">{{ detail?.notices?.skipped ?? 0 }}</div>
            </div>
            <div class="metric">
              <div class="metric-label">到期消息·失败</div>
              <div class="metric-value">{{ detail?.notices?.failed ?? 0 }}</div>
            </div>
            <div class="metric">
              <div class="metric-label">活动提醒·成功</div>
              <div class="metric-value">
                {{
                  Math.max(
                    0,
                    (detail?.eventRemind?.noticed || 0) -
                      (detail?.eventRemind?.failed || 0) -
                      (detail?.eventRemind?.skipped || 0)
                  )
                }}
              </div>
            </div>
            <div class="metric">
              <div class="metric-label">活动提醒·未推送/失败</div>
              <div class="metric-value">
                {{ (detail?.eventRemind?.skipped || 0) + (detail?.eventRemind?.failed || 0) }}
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="detail && Object.keys(detail).length">
          <h4>原始详情</h4>
          <pre class="raw">{{ prettyDetail }}</pre>
        </template>
        <p v-else class="muted">暂无结构化详情</p>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onActivated, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';
import ListPager from '../components/ListPager.vue';
import { DEFAULT_PAGE_SIZE, pageParams } from '../utils/listPage';
import { startAiFeedJob } from '../utils/aiJob';
import { useAiJobMonitorState } from '../stores/aiJobMonitor';
import { formatBeijingDateTime } from '../utils/datetime';

const status = reactive({});
const logs = ref([]);
const loading = ref(false);
const page = ref(1);
const pageSize = DEFAULT_PAGE_SIZE;
const total = ref(0);
const runningAi = ref(false);
const runningMaint = ref(false);
const drawer = ref(false);
const active = ref(null);
const { currentRun, pendingAuto, isRunning } = useAiJobMonitorState();
const aiRunning = isRunning;

const TYPE_LABELS = {
  ai_feed: 'AI 抓取',
  maintenance: '维护任务',
};

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

const drawerTitle = computed(() => {
  if (!active.value) return '任务详情';
  return `${typeLabel(active.value.type)}详情`;
});

const detail = computed(() => parseDetail(active.value?.detail));

const aiMetrics = computed(() => {
  const d = detail.value || {};
  return [
    { label: '扫描人数', value: d.scanned ?? 0 },
    { label: '新增待审', value: d.created ?? 0 },
    { label: '去重跳过', value: d.skipped ?? 0 },
    { label: 'AI/垃圾拒绝', value: d.rejected ?? 0 },
    { label: '失效链接', value: d.deadLinks ?? 0 },
    { label: '错误数', value: Array.isArray(d.errors) ? d.errors.length : 0 },
  ];
});

const errors = computed(() => (Array.isArray(detail.value?.errors) ? detail.value.errors : []));

const rejectSamples = computed(() =>
  Array.isArray(detail.value?.rejectSamples) ? detail.value.rejectSamples : []
);
const skipSamples = computed(() =>
  Array.isArray(detail.value?.skipSamples) ? detail.value.skipSamples : []
);
const deadLinkSamples = computed(() =>
  Array.isArray(detail.value?.deadLinkSamples) ? detail.value.deadLinkSamples : []
);
const rejectReasonItems = computed(() => {
  const map = detail.value?.rejectByReason || {};
  return Object.entries(map)
    .map(([label, count]) => ({ label, count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count);
});

const detailModel = computed(() => {
  const m = detail.value?.llmStatus?.model || '';
  return m.includes('/') ? m.split('/').pop() : m || '-';
});

const rssLine = computed(() => {
  const rss = detail.value?.rssStatus;
  if (!rss) return '-';
  const feeds = rss.feeds ?? rss.total;
  const ok = rss.ok ?? rss.ready;
  if (feeds != null && ok != null) return `${ok}/${feeds}`;
  if (feeds != null) return String(feeds);
  return JSON.stringify(rss);
});

const prettyDetail = computed(() => {
  try {
    return JSON.stringify(detail.value, null, 2);
  } catch {
    return String(active.value?.detail || '');
  }
});

function typeLabel(type) {
  return TYPE_LABELS[type] || type || '-';
}

function parseDetail(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatDateTime(v) {
  return formatBeijingDateTime(v);
}

function openDetail(row) {
  active.value = row;
  drawer.value = true;
}

async function load() {
  loading.value = true;
  try {
    const res = await api.get('/admin/ai/status', { params: pageParams(page.value, pageSize) });
    Object.assign(status, res);
    logs.value = res.recentJobs || [];
    total.value = res.total || 0;
  } finally {
    loading.value = false;
  }
}

async function runAi() {
  runningAi.value = true;
  try {
    await startAiFeedJob({ limitPerMember: 10 });
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

function onPage(p) {
  page.value = p;
  load();
}

let jobsActivatedOnce = false;

onMounted(async () => {
  await load();
  window.addEventListener('ai-feed-done', onAiDone);
});

onActivated(() => {
  if (!jobsActivatedOnce) {
    jobsActivatedOnce = true;
    return;
  }
  load();
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
.link {
  color: var(--teal, #0f6e78);
  text-decoration: none;
}
.link:hover {
  text-decoration: underline;
}
.job-table :deep(.el-table__row) {
  cursor: pointer;
}
.drawer-body h4 {
  margin: 18px 0 10px;
  font-size: 14px;
}
.meta p,
.line {
  margin: 0 0 8px;
  line-height: 1.5;
}
.k {
  display: inline-block;
  width: 48px;
  color: var(--muted, #6d7883);
}
.summary {
  margin: 0;
  line-height: 1.55;
  word-break: break-word;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.metric {
  background: #f7f9fa;
  border: 1px solid rgba(20, 32, 43, 0.06);
  border-radius: 10px;
  padding: 12px;
}
.metric-label {
  color: var(--muted, #6d7883);
  font-size: 12px;
  margin-bottom: 6px;
}
.metric-value {
  font-size: 20px;
  font-weight: 650;
}
.err-list {
  margin: 0;
  padding-left: 18px;
  line-height: 1.55;
  word-break: break-word;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tag {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  background: #eef5f6;
  color: #0f6e78;
  font-size: 12px;
}
.sample-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.sample-list li {
  padding: 10px 0;
  border-bottom: 1px solid rgba(20, 32, 43, 0.06);
}
.sample-list li:last-child {
  border-bottom: 0;
}
.sample-title {
  font-weight: 600;
  line-height: 1.4;
  word-break: break-word;
}
.sample-meta {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;
}
.sample-link {
  display: inline-block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--teal, #0f6e78);
  word-break: break-all;
  text-decoration: none;
}
.sample-link:hover {
  text-decoration: underline;
}
.raw {
  margin: 0;
  padding: 12px;
  background: #f7f9fa;
  border-radius: 10px;
  font-size: 12px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.muted {
  color: var(--muted, #6d7883);
}
</style>
