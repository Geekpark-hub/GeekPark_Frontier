<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>操作记录</h2>
        <p class="muted">记录后台管理操作（含列表浏览）；AI 状态轮询不记入。</p>
      </div>
      <div class="toolbar-actions">
        <el-input
          v-model="keyword"
          clearable
          placeholder="搜索动作/路径/操作人"
          style="width: 220px"
          @keyup.enter="resetAndLoad"
          @clear="resetAndLoad"
        />
        <el-select v-model="method" clearable placeholder="全部方法" style="width: 120px" @change="resetAndLoad">
          <el-option label="GET" value="GET" />
          <el-option label="POST" value="POST" />
          <el-option label="PUT" value="PUT" />
          <el-option label="DELETE" value="DELETE" />
        </el-select>
        <el-button @click="resetAndLoad" :loading="loading">刷新</el-button>
      </div>
    </div>

    <el-table
      :data="list"
      stripe
      empty-text="暂无操作记录"
      v-loading="loading"
      class="audit-table"
      @row-click="openDetail"
    >
      <el-table-column label="时间" width="170">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作人" width="150">
        <template #default="{ row }">
          <div>{{ row.actorName || '—' }}</div>
          <div class="muted tiny">{{ maskPhone(row.actorPhone) }}</div>
        </template>
      </el-table-column>
      <el-table-column prop="action" label="动作" min-width="160" show-overflow-tooltip />
      <el-table-column prop="method" label="方法" width="90" />
      <el-table-column prop="path" label="路径" min-width="180" show-overflow-tooltip />
      <el-table-column label="结果" width="100">
        <template #default="{ row }">
          <span class="status-chip" :class="row.success ? 'is-active' : 'is-expired'">
            {{ row.statusCode }} {{ row.success ? '成功' : '失败' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="IP" width="130" show-overflow-tooltip>
        <template #default="{ row }">{{ maskIp(row.ip) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="80" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click.stop="openDetail(row)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>

    <ListPager v-model:page="page" :page-size="pageSize" :total="total" @update:page="onPage" />

    <el-drawer
      v-model="drawer"
      size="520px"
      title="操作详情"
      append-to-body
      destroy-on-close
    >
      <div v-if="active" class="detail">
        <p><span class="k">时间</span>{{ formatTime(active.createdAt) }}</p>
        <p>
          <span class="k">操作人</span>
          {{ active.actorName || '—' }}
          <template v-if="maskPhone(active.actorPhone)">（{{ maskPhone(active.actorPhone) }}）</template>
        </p>
        <p><span class="k">动作</span>{{ active.action }}</p>
        <p><span class="k">请求</span>{{ active.method }} {{ active.path }}</p>
        <p><span class="k">结果</span>{{ active.statusCode }} · {{ active.success ? '成功' : '失败' }}</p>
        <p><span class="k">IP</span>{{ maskIp(active.ip) || '—' }}</p>
        <p><span class="k">UA</span>{{ maskSensitiveText(active.userAgent || '—') }}</p>
        <p v-if="active.targetId"><span class="k">对象</span>{{ active.targetId }}</p>
        <h4>Query</h4>
        <pre>{{ pretty(active.query) }}</pre>
        <h4>Body</h4>
        <pre>{{ pretty(active.body) }}</pre>
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
import { maskIp, maskPhone, maskSensitiveText } from '../utils/mask';
import { useListRefresh } from '../utils/useListRefresh';

const list = ref([]);
const page = ref(1);
const pageSize = DEFAULT_PAGE_SIZE;
const total = ref(0);
const loading = ref(false);
const keyword = ref('');
const method = ref('');
const drawer = ref(false);
const active = ref(null);

function formatTime(v) {
  return formatBeijingDateTime(v);
}

function pretty(raw) {
  if (!raw) return '{}';
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return maskSensitiveText(JSON.stringify(obj, null, 2));
  } catch {
    return maskSensitiveText(String(raw));
  }
}

async function load() {
  loading.value = true;
  try {
    const params = { ...pageParams(page.value, pageSize) };
    if (keyword.value.trim()) params.q = keyword.value.trim();
    if (method.value) params.method = method.value;
    const res = await api.get('/admin/audit-logs', { params });
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

function onPage(p) {
  page.value = p;
  load();
}

function openDetail(row) {
  active.value = row;
  drawer.value = true;
}

useListRefresh(load);
</script>

<style scoped>
.audit-table :deep(.el-table__row) {
  cursor: pointer;
}
.tiny {
  font-size: 12px;
}
.detail p {
  margin: 0 0 10px;
  line-height: 1.5;
  word-break: break-word;
}
.k {
  display: inline-block;
  width: 56px;
  color: var(--muted, #6d7883);
}
.detail h4 {
  margin: 16px 0 8px;
  font-size: 14px;
}
.detail pre {
  margin: 0;
  padding: 12px;
  background: #f7f9fa;
  border-radius: 10px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
}
.muted {
  color: var(--muted, #6d7883);
}
</style>
