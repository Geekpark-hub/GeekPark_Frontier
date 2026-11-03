<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>消息中心</h2>
        <p class="muted">微信订阅消息与飞书通知的历史发送日志</p>
      </div>
      <div class="toolbar-actions">
        <el-input
          v-model="keyword"
          clearable
          placeholder="搜索会员/活动/类型"
          style="width: 200px"
          @keyup.enter="resetAndLoad"
          @clear="resetAndLoad"
        />
        <el-select v-model="channel" clearable placeholder="渠道" style="width: 140px" @change="resetAndLoad">
          <el-option label="微信订阅" value="wechat_subscribe" />
          <el-option label="飞书" value="feishu" />
        </el-select>
        <el-select v-model="success" clearable placeholder="结果" style="width: 110px" @change="resetAndLoad">
          <el-option label="成功" value="1" />
          <el-option label="失败" value="0" />
        </el-select>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始"
          end-placeholder="结束"
          value-format="YYYY-MM-DD"
          style="width: 260px"
          @change="resetAndLoad"
        />
        <el-button @click="resetAndLoad" :loading="loading">刷新</el-button>
      </div>
    </div>

    <el-table :data="list" stripe empty-text="暂无消息记录" v-loading="loading" @row-click="openDetail">
      <el-table-column label="时间" width="170">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="渠道" width="110">
        <template #default="{ row }">{{ channelLabel(row.channel) }}</template>
      </el-table-column>
      <el-table-column label="类型" width="140">
        <template #default="{ row }">{{ kindLabel(row.kind) }}</template>
      </el-table-column>
      <el-table-column prop="memberName" label="会员" width="120" show-overflow-tooltip />
      <el-table-column prop="targetTitle" label="对象" min-width="160" show-overflow-tooltip />
      <el-table-column label="结果" width="100">
        <template #default="{ row }">
          <span class="status-chip" :class="row.success ? 'is-active' : 'is-expired'">
            {{ row.success ? '成功' : '失败' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="message" label="说明" min-width="160" show-overflow-tooltip />
      <el-table-column label="操作" width="80" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click.stop="openDetail(row)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>

    <ListPager v-model:page="page" :page-size="pageSize" :total="total" @update:page="onPage" />

    <el-drawer v-model="drawer" size="520px" title="消息详情" append-to-body destroy-on-close>
      <div v-if="active" class="detail">
        <p><span class="k">时间</span>{{ formatTime(active.createdAt) }}</p>
        <p><span class="k">渠道</span>{{ channelLabel(active.channel) }}</p>
        <p><span class="k">类型</span>{{ kindLabel(active.kind) }}</p>
        <p><span class="k">会员</span>{{ active.memberName || '—' }}</p>
        <p><span class="k">对象</span>{{ active.targetTitle || active.targetId || '—' }}</p>
        <p><span class="k">页面</span>{{ active.page || '—' }}</p>
        <p><span class="k">模板</span>{{ active.templateId || '—' }}</p>
        <p><span class="k">结果</span>{{ active.success ? '成功' : '失败' }} · {{ active.mode || '—' }}</p>
        <p><span class="k">说明</span>{{ active.message || '—' }}</p>
        <h4>Detail</h4>
        <pre>{{ pretty(active.detail) }}</pre>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';
import ListPager from '../components/ListPager.vue';
import { DEFAULT_PAGE_SIZE, pageParams } from '../utils/listPage';
import { formatBeijingDateTime } from '../utils/datetime';
import { useListRefresh } from '../utils/useListRefresh';

const KIND_LABELS = {
  expiry: '会员到期',
  register: '报名成功',
  event_remind: '活动开始提醒',
  event_register_feishu: '飞书·新报名',
  event_cancel_feishu: '飞书·取消报名',
};

const list = ref([]);
const loading = ref(false);
const page = ref(1);
const pageSize = DEFAULT_PAGE_SIZE;
const total = ref(0);
const keyword = ref('');
const channel = ref('');
const success = ref('');
const dateRange = ref(null);
const drawer = ref(false);
const active = ref(null);

function channelLabel(c) {
  if (c === 'wechat_subscribe') return '微信订阅';
  if (c === 'feishu') return '飞书';
  return c || '—';
}

function kindLabel(k) {
  return KIND_LABELS[k] || k || '—';
}

function formatTime(iso) {
  if (!iso) return '—';
  const text = formatBeijingDateTime(iso);
  return text === '-' ? '—' : text.slice(0, 16);
}

function pretty(raw) {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(raw || '');
  }
}

async function load() {
  loading.value = true;
  try {
    const params = {
      ...pageParams(page.value, pageSize),
      q: keyword.value || undefined,
      channel: channel.value || undefined,
      success: success.value === '' ? undefined : success.value,
    };
    if (dateRange.value?.length === 2) {
      params.from = dateRange.value[0];
      params.to = dateRange.value[1];
    }
    const res = await api.get('/admin/notify-logs', { params });
    list.value = res.logs || [];
    total.value = res.total || 0;
  } catch (e) {
    ElMessage.error(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function resetAndLoad() {
  page.value = 1;
  load();
}

function onPage() {
  load();
}

function openDetail(row) {
  active.value = row;
  drawer.value = true;
}

useListRefresh(load);
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
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
  margin: 4px 0 0;
}
.status-chip.is-active {
  color: #0f6e78;
}
.status-chip.is-expired {
  color: #a65d3b;
}
.detail .k {
  display: inline-block;
  width: 56px;
  color: #8a8378;
}
.detail pre {
  background: #f7f5f1;
  padding: 12px;
  border-radius: 8px;
  overflow: auto;
  font-size: 12px;
}
</style>
