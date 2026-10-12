<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>活跃分析</h2>
        <p class="muted">会员关键行为：打开、浏览、投票、报名、提交需求；含设备与 IP（近 {{ days }} 天）</p>
      </div>
      <el-select v-model="days" style="width: 120px" @change="reload">
        <el-option :value="7" label="近 7 天" />
        <el-option :value="30" label="近 30 天" />
        <el-option :value="90" label="近 90 天" />
      </el-select>
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
        <el-table-column prop="lastIp" label="IP" width="140" />
      </el-table>
    </div>

    <el-drawer v-model="drawer" size="520px" :title="detailTitle">
      <div v-loading="loadingDetail">
        <div class="detail-meta" v-if="detail?.member">
          <p>{{ detail.member.name }} · {{ detail.member.company || '—' }}</p>
          <p class="muted">周期内 {{ detail.total }} 条事件</p>
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
              <span v-if="ev.path">{{ ev.path }}</span>
              <span v-if="ev.targetId"> · {{ ev.targetId }}</span>
            </div>
            <div class="ev-sub muted">{{ ev.device }} · {{ ev.ip || '无 IP' }}</div>
          </el-timeline-item>
        </el-timeline>
        <p v-else class="muted">暂无明细</p>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

const EVENT_LABELS = {
  app_open: '打开小程序',
  page_view: '浏览页面',
  poll_view: '查看投票',
  poll_vote: '提交投票',
  event_view: '查看活动',
  event_register: '活动报名',
  request_submit: '提交需求',
  open_source: '打开原文',
};

const days = ref(30);
const overview = reactive({});
const members = ref([]);
const drawer = ref(false);
const detail = ref(null);
const loadingOverview = ref(false);
const loadingMembers = ref(false);
const loadingDetail = ref(false);

const detailTitle = computed(() => {
  const m = detail.value?.member;
  return m ? `${m.name} 的活跃明细` : '活跃明细';
});

function eventLabel(key) {
  return EVENT_LABELS[key] || key || '—';
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadOverview() {
  loadingOverview.value = true;
  try {
    const res = await api.get('/admin/analytics/overview', { params: { days: days.value } });
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
    const res = await api.get('/admin/analytics/members', { params: { days: days.value, limit: 80 } });
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
      params: { days: days.value, limit: 100 },
    });
  } catch (e) {
    ElMessage.error(e.message || '加载明细失败');
  } finally {
    loadingDetail.value = false;
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
@media (max-width: 900px) {
  .stats {
    grid-template-columns: 1fr;
  }
}
</style>
