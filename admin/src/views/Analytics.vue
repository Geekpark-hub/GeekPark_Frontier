<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>活跃分析</h2>
        <p class="muted">
          会员关键行为埋点（打开、浏览、投票、报名、取消、分享、回顶等）
          <template v-if="overview.rangeLabel"> · {{ overview.rangeLabel }}</template>
        </p>
      </div>
      <div class="toolbar-actions">
        <el-select v-model="preset" style="width: 120px" @change="onPreset">
          <el-option :value="7" label="近 7 天" />
          <el-option :value="30" label="近 30 天" />
          <el-option :value="90" label="近 90 天" />
          <el-option :value="0" label="自定义" />
        </el-select>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始"
          end-placeholder="结束"
          value-format="YYYY-MM-DD"
          style="width: 260px"
          :disabled="preset !== 0"
          @change="reload"
        />
        <el-button type="primary" plain :loading="exportingCsv" @click="exportCsv">导出表格</el-button>
        <el-button plain :loading="exportingPdf" @click="exportPdf">导出 PDF</el-button>
        <el-button @click="reload" :loading="loadingOverview || loadingMembers">刷新</el-button>
      </div>
    </div>

    <div class="stats" v-loading="loadingOverview">
      <div class="stat">
        <div class="stat-num">{{ overview.activeMembers7d ?? '—' }}</div>
        <div class="stat-label">近 7 日活跃会员</div>
      </div>
      <div class="stat">
        <div class="stat-num">{{ overview.activeMembers ?? '—' }}</div>
        <div class="stat-label">周期内活跃会员</div>
      </div>
      <div class="stat">
        <div class="stat-num">{{ overview.totalEvents ?? '—' }}</div>
        <div class="stat-label">事件总数</div>
      </div>
    </div>

    <div class="section">
      <h3>事件分布</h3>
      <div class="tags" v-if="overview.byEvent?.length">
        <el-tag v-for="item in overview.byEvent" :key="item.event" class="tag" effect="plain">
          {{ eventLabel(item.event) }} · {{ item.count }}
        </el-tag>
      </div>
      <p v-else class="muted">暂无数据，会员使用小程序后将自动累计</p>
    </div>

    <div class="section" v-if="overview.byPath?.length">
      <h3>热门路径 Top</h3>
      <div class="tags">
        <el-tag v-for="item in overview.byPath" :key="item.path" class="tag" effect="plain">
          {{ item.path }} · {{ item.count }}
        </el-tag>
      </div>
    </div>

    <div class="section">
      <h3>会员活跃排行</h3>
      <el-table :data="members" stripe empty-text="暂无活跃记录" v-loading="loadingMembers" @row-click="openDetail">
        <el-table-column prop="name" label="会员" width="120" />
        <el-table-column prop="company" label="公司" min-width="140" />
        <el-table-column prop="eventCount" label="事件数" width="90" />
        <el-table-column label="最近活跃" width="170">
          <template #default="{ row }">{{ formatTime(row.lastAt) }}</template>
        </el-table-column>
        <el-table-column prop="lastEvent" label="最近动作" width="120">
          <template #default="{ row }">{{ eventLabel(row.lastEvent) }}</template>
        </el-table-column>
        <el-table-column prop="lastDevice" label="设备" min-width="160" show-overflow-tooltip />
        <el-table-column label="IP" width="140">
          <template #default="{ row }">{{ maskIp(row.lastIp) || '—' }}</template>
        </el-table-column>
      </el-table>
    </div>

    <el-drawer
      v-model="drawer"
      size="520px"
      :title="detailTitle"
      append-to-body
      destroy-on-close
      class="analytics-drawer"
    >
      <div class="drawer-scroll" v-loading="loadingDetail">
        <div class="detail-meta" v-if="detail?.member">
          <p>{{ detail.member.name }} · {{ detail.member.company || '—' }}</p>
          <p class="muted">周期内 {{ detail.total }} 条事件</p>
          <div class="summary-grid" v-if="detail.summary?.counts">
            <div class="summary-item"><b>{{ detail.summary.counts.pageView }}</b>浏览页面</div>
            <div class="summary-item"><b>{{ detail.summary.counts.appOpen }}</b>打开小程序</div>
            <div class="summary-item"><b>{{ detail.summary.counts.eventRegister }}</b>报名次数</div>
            <div class="summary-item"><b>{{ (detail.summary.registeredEvents || []).length }}</b>报名活动数</div>
            <div class="summary-item"><b>{{ detail.summary.counts.pollVote }}</b>投票次数</div>
            <div class="summary-item"><b>{{ (detail.summary.votedPolls || []).length }}</b>投票数</div>
          </div>
          <div class="summary-block" v-if="detail.summary?.registeredEvents?.length">
            <div class="summary-label">报名过的活动</div>
            <p>{{ detail.summary.registeredEvents.join('；') }}</p>
          </div>
          <div class="summary-block" v-if="detail.summary?.votedPolls?.length">
            <div class="summary-label">投过票的投票</div>
            <p>{{ detail.summary.votedPolls.join('；') }}</p>
          </div>
          <div class="summary-block" v-if="detail.summary?.viewedEvents?.length">
            <div class="summary-label">查看过的活动</div>
            <p>{{ detail.summary.viewedEvents.join('；') }}</p>
          </div>
          <div class="summary-block" v-if="detail.summary?.topPaths?.length">
            <div class="summary-label">常访问页面</div>
            <p>{{ detail.summary.topPaths.join('；') }}</p>
          </div>
          <div class="tags">
            <el-tag v-for="item in detail.byEvent || []" :key="item.event" class="tag" effect="plain" size="small">
              {{ eventLabel(item.event) }} · {{ item.count }}
            </el-tag>
          </div>
        </div>
        <el-timeline v-if="detail?.events?.length">
          <el-timeline-item
            v-for="ev in detail.events"
            :key="ev.id"
            :timestamp="formatTime(ev.createdAt)"
            placement="top"
          >
            <div class="ev-title">{{ eventLabel(ev.event) }}</div>
            <div class="ev-sub muted">
              <span v-if="ev.targetTitle">{{ ev.targetTitle }}</span>
              <span v-else-if="ev.path">{{ ev.path }}</span>
              <span v-if="ev.targetId && !ev.targetTitle"> · {{ ev.targetId }}</span>
            </div>
            <div class="ev-sub muted">{{ ev.device }} · {{ ev.ip ? maskIp(ev.ip) : '无 IP' }}</div>
          </el-timeline-item>
        </el-timeline>
        <p v-else-if="!loadingDetail" class="muted">暂无明细</p>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';
import { formatBeijingDateTime } from '../utils/datetime';
import { maskIp } from '../utils/mask';

const EVENT_LABELS = {
  app_open: '打开小程序',
  page_view: '浏览页面',
  poll_view: '查看投票',
  poll_vote: '提交投票',
  poll_share_view: '投票分享页',
  event_view: '查看活动',
  event_register: '活动报名',
  event_cancel_register: '取消报名',
  event_share_view: '活动分享页',
  request_submit: '提交需求',
  open_source: '打开原文',
  feed_back_top: '信息流回顶',
  subscribe_auth: '订阅授权',
  share_click: '分享点击',
  tab_switch: '切换 Tab',
};

const preset = ref(30);
const dateRange = ref(null);
const overview = reactive({});
const members = ref([]);
const drawer = ref(false);
const detail = ref(null);
const loadingOverview = ref(false);
const loadingMembers = ref(false);
const loadingDetail = ref(false);
const exportingCsv = ref(false);
const exportingPdf = ref(false);

const detailTitle = computed(() => {
  const m = detail.value?.member;
  return m ? `${m.name} 的活跃明细` : '活跃明细';
});

function eventLabel(key) {
  return EVENT_LABELS[key] || key || '—';
}

function formatTime(iso) {
  if (!iso) return '—';
  const text = formatBeijingDateTime(iso);
  return text === '-' ? '—' : text.slice(0, 16);
}

function queryParams() {
  if (preset.value === 0 && dateRange.value?.length === 2) {
    return { from: dateRange.value[0], to: dateRange.value[1] };
  }
  return { days: preset.value || 30 };
}

function onPreset() {
  if (preset.value !== 0) {
    dateRange.value = null;
    reload();
  }
}

async function loadOverview() {
  loadingOverview.value = true;
  try {
    const res = await api.get('/admin/analytics/overview', { params: queryParams() });
    Object.keys(overview).forEach((k) => delete overview[k]);
    Object.assign(overview, res.overview || {});
  } catch (e) {
    ElMessage.error(e.message || '加载概览失败');
  } finally {
    loadingOverview.value = false;
  }
}

async function loadMembers() {
  loadingMembers.value = true;
  try {
    const res = await api.get('/admin/analytics/members', {
      params: { ...queryParams(), limit: 80 },
    });
    members.value = res.members || [];
  } catch (e) {
    ElMessage.error(e.message || '加载排行失败');
  } finally {
    loadingMembers.value = false;
  }
}

async function reload() {
  await Promise.all([loadOverview(), loadMembers()]);
}

async function openDetail(row) {
  if (!row?.memberId) return;
  drawer.value = true;
  loadingDetail.value = true;
  detail.value = null;
  try {
    detail.value = await api.get(`/admin/analytics/members/${row.memberId}`, {
      params: { ...queryParams(), limit: 100 },
    });
  } catch (e) {
    ElMessage.error(e.message || '加载明细失败');
  } finally {
    loadingDetail.value = false;
  }
}

async function exportCsv() {
  exportingCsv.value = true;
  try {
    const blob = await api.get('/admin/analytics/export', {
      params: { ...queryParams(), limit: 200, format: 'csv' },
      responseType: 'blob',
      timeout: 60000,
    });
    const fileBlob =
      blob instanceof Blob ? blob : new Blob([blob], { type: 'text/csv;charset=utf-8' });
    const head = await fileBlob.slice(0, 1).text();
    if (head === '{' || String(fileBlob.type || '').includes('json')) {
      const text = await fileBlob.text();
      let msg = '导出失败';
      try {
        msg = JSON.parse(text)?.error || msg;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(fileBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `前沿社活跃明细_${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    ElMessage.success('已导出表格（请用 Excel 打开）');
  } catch (e) {
    ElMessage.error(e.message || '导出失败');
  } finally {
    exportingCsv.value = false;
  }
}

async function exportPdf() {
  if (exportingPdf.value) return;
  exportingPdf.value = true;
  try {
    const res = await api.get('/admin/analytics/export', {
      params: { ...queryParams(), limit: 40, format: 'json' },
      timeout: 60000,
      skipGlobalLoading: true,
    });
    const { buildAnalyticsPdf } = await import('../utils/analyticsPdf.js');
    buildAnalyticsPdf({
      rangeText: res.overview?.rangeLabel || res.range?.label || '',
      generatedAt: formatTime(res.generatedAt),
      overview: res.overview || {},
      profiles: (res.profiles || []).slice(0, 40),
      eventLabels: res.eventLabels || EVENT_LABELS,
      formatTime,
    });
    ElMessage.success('已下载 PDF');
  } catch (e) {
    console.error('[exportPdf]', e);
    ElMessage.error(e.message || '导出 PDF 失败');
  } finally {
    exportingPdf.value = false;
  }
}

onMounted(reload);
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.muted {
  color: #8a8378;
  font-size: 13px;
  margin-top: 4px;
}
.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.stat {
  background: #f7f5f1;
  border-radius: 12px;
  padding: 18px 16px;
}
.stat-num {
  font-size: 28px;
  font-weight: 650;
  color: #14202b;
  line-height: 1.1;
}
.stat-label {
  margin-top: 8px;
  font-size: 13px;
  color: #6d7883;
}
.section {
  margin-bottom: 28px;
}
.section h3 {
  margin: 0 0 12px;
  font-size: 16px;
  color: #14202b;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tag {
  border-color: rgba(20, 32, 43, 0.12);
  color: #14202b;
}
.detail-meta {
  margin-bottom: 20px;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 12px 0 14px;
}
.summary-item {
  background: #f7f5f1;
  border-radius: 10px;
  padding: 10px 8px;
  font-size: 12px;
  color: #6d7883;
}
.summary-item b {
  display: block;
  font-size: 18px;
  color: #14202b;
  line-height: 1.2;
  margin-bottom: 4px;
}
.summary-block {
  margin-bottom: 12px;
}
.summary-label {
  font-size: 12px;
  color: #8a8378;
  margin-bottom: 4px;
}
.summary-block p {
  margin: 0;
  font-size: 13px;
  color: #14202b;
  line-height: 1.45;
  word-break: break-word;
}
.ev-title {
  font-weight: 550;
  color: #14202b;
}
.ev-sub {
  margin-top: 4px;
  font-size: 12px;
  word-break: break-all;
}
:deep(.el-table__row) {
  cursor: pointer;
}
.drawer-scroll {
  min-height: 120px;
  padding-bottom: 28px;
}
@media (max-width: 900px) {
  .stats {
    grid-template-columns: 1fr;
  }
}
</style>

<style>
.analytics-drawer.el-drawer {
  height: 100%;
}
.analytics-drawer .el-drawer__body {
  height: calc(100% - 60px);
  overflow-y: auto;
  padding: 16px 20px 32px;
  box-sizing: border-box;
}
</style>
