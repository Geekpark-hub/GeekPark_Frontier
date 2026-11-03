<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>会员需求</h2>
        <p class="muted">跟进资源连接请求；状态与备注仅后台可见</p>
      </div>
      <div class="toolbar-actions">
        <el-select v-model="status" clearable placeholder="全部状态" style="width: 140px" @change="resetAndLoad">
          <el-option label="已提交" value="submitted" />
          <el-option label="处理中" value="processing" />
          <el-option label="已完成" value="done" />
        </el-select>
      </div>
    </div>

    <el-table :data="list" stripe empty-text="暂无需求" class="req-table" v-loading="loading">
      <el-table-column label="会员" width="150">
        <template #default="{ row }">
          <div class="member-cell">
            <span class="member-name">{{ row.member?.name || '—' }}</span>
            <span class="member-co">{{ row.member?.company || '—' }}</span>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="需求" min-width="280">
        <template #default="{ row }">
          <div class="req-main">
            <div class="content-cell" :title="row.content">{{ row.content || '—' }}</div>
            <div v-if="metaLine(row)" class="meta-line">{{ metaLine(row) }}</div>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-select
            v-model="row.status"
            size="small"
            class="status-select"
            :class="`is-${row.status || 'submitted'}`"
            @change="(v) => update(row, { status: v })"
          >
            <el-option label="已提交" value="submitted" />
            <el-option label="处理中" value="processing" />
            <el-option label="已完成" value="done" />
          </el-select>
        </template>
      </el-table-column>

      <el-table-column label="内部备注" min-width="220">
        <template #default="{ row }">
          <el-input
            v-model="row.adminNote"
            size="small"
            class="note-input"
            placeholder="写备注…"
            @blur="update(row, { adminNote: row.adminNote })"
          />
        </template>
      </el-table-column>

      <el-table-column label="提交于" width="158" align="right">
        <template #default="{ row }">
          <span class="soft mono">{{ formatCreated(row.createdAt) }}</span>
        </template>
      </el-table-column>
    </el-table>
    <ListPager v-model:page="page" :page-size="pageSize" :total="total" @update:page="onPage" />
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

const list = ref([]);
const loading = ref(false);
const page = ref(1);
const pageSize = DEFAULT_PAGE_SIZE;
const total = ref(0);
const status = ref('');

function dash(v) {
  const s = String(v || '').trim();
  return s || '';
}

/** Free-text time; legacy epoch / ISO still readable. */
function formatRequestTime(row) {
  const raw = String(row?.startAt || row?.endAt || '').trim();
  if (!raw) return '';
  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw);
    const ms = raw.length <= 10 ? n * 1000 : n;
    const label = formatBeijingDateTime(ms);
    return label === '-' ? raw : label;
  }
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate) && /[-T:]/.test(raw)) {
    const label = formatBeijingDateTime(asDate);
    return label === '-' ? raw : label;
  }
  return raw;
}

function metaLine(row) {
  const parts = [formatRequestTime(row), dash(row.location), dash(row.connectWith)].filter(Boolean);
  return parts.join(' · ');
}

function formatCreated(v) {
  const label = formatBeijingDateTime(v);
  return label === '-' ? '—' : label;
}

async function load() {
  loading.value = true;
  try {
    const params = { ...pageParams(page.value, pageSize) };
    if (status.value) params.status = status.value;
    const res = await api.get('/admin/requests', { params });
    list.value = res.requests || [];
    total.value = res.total || 0;
  } finally {
    loading.value = false;
  }
}

function resetAndLoad() {
  page.value = 1;
  load();
}

async function update(row, payload) {
  try {
    await api.put(`/admin/requests/${row.id}`, payload);
    ElMessage.success('已更新');
    if (payload.status !== undefined && status.value && payload.status !== status.value) {
      await load();
    }
  } catch (e) {
    ElMessage.error(e.message);
  }
}

function onPage(p) {
  page.value = p;
  load();
}

useListRefresh(load);
</script>

<style scoped>
.req-table :deep(.el-table__cell) {
  vertical-align: middle;
  padding-top: 16px;
  padding-bottom: 16px;
}

.req-table :deep(.el-table__cell .cell) {
  overflow: visible;
  text-overflow: clip;
}

.member-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  line-height: 1.35;
}

.member-name {
  font-weight: 600;
  color: var(--ink, #14202b);
}

.member-co {
  font-size: 12px;
  color: var(--muted, #6d7883);
}

.req-main {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.content-cell {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  white-space: pre-wrap;
  line-height: 1.55;
  color: var(--ink, #14202b);
}

.meta-line {
  font-size: 12px;
  color: var(--muted, #6d7883);
  line-height: 1.4;
  letter-spacing: 0.01em;
}

.soft {
  color: var(--muted, #6d7883);
  line-height: 1.45;
}

.mono {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.status-select {
  width: 104px;
}

.status-select :deep(.el-select__wrapper) {
  box-shadow: none !important;
  background: #eef1f4;
  min-height: 30px;
}

.status-select.is-submitted :deep(.el-select__wrapper) {
  background: #eef1f4;
  color: #3a4652;
}

.status-select.is-processing :deep(.el-select__wrapper) {
  background: #e8f3f4;
  color: #0f6e78;
}

.status-select.is-done :deep(.el-select__wrapper) {
  background: #eaf3ea;
  color: #2f6b3a;
}

.status-select :deep(.el-select__placeholder),
.status-select :deep(.el-select__selected-item) {
  font-size: 13px;
  font-weight: 500;
}

.note-input :deep(.el-input__wrapper) {
  box-shadow: none !important;
  background: transparent;
  padding-left: 0;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.note-input :deep(.el-input__wrapper:hover),
.note-input :deep(.el-input__wrapper.is-focus) {
  background: #f6f8fa;
  box-shadow: 0 0 0 1px rgba(20, 32, 43, 0.1) inset !important;
  padding-left: 10px;
}

.note-input :deep(.el-input__inner) {
  color: var(--ink, #14202b);
}

.note-input :deep(.el-input__inner::placeholder) {
  color: #a0a8b0;
}
</style>
