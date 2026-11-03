<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>微信进入</h2>
        <p class="muted">默认只显示已填微信昵称的进入；仅打开未授权的记录可勾选「含空昵称」查看。绑定会员后对方即可使用「我的」等完整功能。</p>
      </div>
      <div class="toolbar-actions">
        <el-select v-model="status" style="width: 130px" @change="resetAndLoad">
          <el-option label="待绑定" value="pending" />
          <el-option label="已绑定" value="bound" />
          <el-option label="已忽略" value="ignored" />
          <el-option label="全部" value="all" />
        </el-select>
        <el-checkbox v-model="includeEmptyNick" @change="resetAndLoad">含空昵称</el-checkbox>
        <el-input
          v-model="keyword"
          clearable
          placeholder="搜索昵称 / openid"
          style="width: 220px"
          @clear="resetAndLoad"
          @keyup.enter="resetAndLoad"
        />
        <el-button @click="resetAndLoad">刷新</el-button>
      </div>
    </div>

    <el-table :data="list" stripe :empty-text="emptyText" v-loading="loading">
      <el-table-column label="微信昵称" min-width="120">
        <template #default="{ row }">
          <span>{{ row.wxNickname || '（未填写）' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="手机号" width="120">
        <template #default="{ row }">{{ row.phone || '—' }}</template>
      </el-table-column>
      <el-table-column label="OpenID" width="160">
        <template #default="{ row }">
          <code class="mono">{{ row.openidMasked }}</code>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <span class="status-chip" :class="`is-${row.status}`">{{ statusText[row.status] || row.status }}</span>
        </template>
      </el-table-column>
      <el-table-column label="已绑会员" min-width="140">
        <template #default="{ row }">
          <span v-if="row.boundMember">{{ row.boundMember.name }}</span>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="首次进入" width="160">
        <template #default="{ row }">{{ formatBeijingDateTime(row.firstSeenAt) }}</template>
      </el-table-column>
      <el-table-column label="最近进入" width="160">
        <template #default="{ row }">{{ formatBeijingDateTime(row.lastSeenAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="280" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.status !== 'bound'"
            link
            type="primary"
            @click="openBind(row)"
          >绑定会员</el-button>
          <el-button
            v-if="row.status === 'bound'"
            link
            type="primary"
            @click="openBind(row)"
          >更换绑定</el-button>
          <el-button
            v-if="row.status === 'bound'"
            link
            @click="unbind(row)"
          >解绑</el-button>
          <el-button
            v-if="row.status === 'pending'"
            link
            @click="ignore(row)"
          >忽略</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <ListPager v-model:page="page" :page-size="pageSize" :total="total" @update:page="onPage" />

    <el-dialog
      v-model="bindVisible"
      :title="current?.status === 'bound' ? '更换绑定' : '绑定到会员'"
      width="480px"
      append-to-body
      align-center
      destroy-on-close
    >
      <p class="muted bind-tip">
        <template v-if="current?.status === 'bound'">
          将「{{ current?.wxNickname || current?.openidMasked || '该微信' }}」改绑到其他会员；原会员微信会自动解绑。
        </template>
        <template v-else>
          将「{{ current?.wxNickname || current?.openidMasked || '该微信' }}」绑定到下方会员档案。
        </template>
      </p>
      <el-select
        v-model="memberId"
        filterable
        remote
        clearable
        placeholder="搜索会员（未绑微信优先）"
        style="width: 100%"
        :remote-method="searchMembers"
        :loading="memberLoading"
      >
        <el-option
          v-for="m in memberOptions"
          :key="m.id"
          :label="memberLabel(m)"
          :value="m.id"
        />
      </el-select>
      <template #footer>
        <el-button @click="bindVisible = false">取消</el-button>
        <el-button type="primary" :loading="binding" @click="confirmBind">
          {{ current?.status === 'bound' ? '确认更换' : '确认绑定' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';
import ListPager from '../components/ListPager.vue';
import { formatBeijingDateTime } from '../utils/datetime';
import { DEFAULT_PAGE_SIZE, pageParams } from '../utils/listPage';
import { useListRefresh } from '../utils/useListRefresh';

const statusText = {
  pending: '待绑定',
  bound: '已绑定',
  ignored: '已忽略',
};

const status = ref('pending');
const includeEmptyNick = ref(false);
const keyword = ref('');
const list = ref([]);
const loading = ref(false);
const total = ref(0);
const page = ref(1);
const pageSize = DEFAULT_PAGE_SIZE;

const bindVisible = ref(false);
const current = ref(null);
const memberId = ref('');
const memberOptions = ref([]);
const memberLoading = ref(false);
const binding = ref(false);

const emptyText = computed(() => {
  if (keyword.value.trim()) return '没有匹配的记录';
  if (status.value === 'pending' && !includeEmptyNick.value) {
    return '暂无已填昵称的待绑定；可勾选「含空昵称」查看仅打开记录';
  }
  if (status.value === 'pending') return '暂无待绑定的微信进入';
  return '暂无记录';
});

function memberLabel(m) {
  const bits = [m.name, m.company].filter(Boolean);
  const tag = m.openid ? '已绑' : '未绑';
  return `${bits.join(' · ')}（${tag}）`;
}

async function load() {
  loading.value = true;
  try {
    const res = await api.get('/admin/wx-entries', {
      params: {
        ...pageParams(page.value, pageSize),
        status: status.value,
        q: keyword.value.trim() || undefined,
        includeEmptyNick: includeEmptyNick.value ? '1' : undefined,
      },
    });
    list.value = res.entries || [];
    total.value = res.total || 0;
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

async function searchMembers(q) {
  memberLoading.value = true;
  try {
    const res = await api.get('/admin/members', {
      params: { page: 1, pageSize: 30, q: q || undefined },
    });
    const rows = res.members || [];
    // 未绑优先
    memberOptions.value = [...rows].sort((a, b) => Number(!!a.openid) - Number(!!b.openid));
  } finally {
    memberLoading.value = false;
  }
}

function openBind(row) {
  current.value = row;
  memberId.value = '';
  memberOptions.value = [];
  bindVisible.value = true;
  searchMembers('');
}

async function confirmBind() {
  if (!current.value?.id) return;
  if (!memberId.value) {
    ElMessage.warning('请选择会员');
    return;
  }
  binding.value = true;
  try {
    await api.post(`/admin/wx-entries/${current.value.id}/bind`, { memberId: memberId.value });
    ElMessage.success(current.value.status === 'bound' ? '已更换绑定' : '已绑定');
    bindVisible.value = false;
    load();
  } catch (e) {
    ElMessage.error(e.message || '绑定失败');
  } finally {
    binding.value = false;
  }
}

async function unbind(row) {
  const label = row.wxNickname || row.openidMasked || '该微信';
  const memberName = row.boundMember?.name || '对应会员';
  try {
    await ElMessageBox.confirm(
      `解绑「${label}」与「${memberName}」？记录将回到待绑定，对方需重新被绑定后才能使用「我的」。`,
      '解绑确认',
      { type: 'warning' }
    );
    await api.post(`/admin/wx-entries/${row.id}/unbind`);
    ElMessage.success('已解绑');
    load();
  } catch (e) {
    if (e !== 'cancel' && e?.message) ElMessage.error(e.message);
  }
}

async function ignore(row) {
  try {
    await ElMessageBox.confirm(`忽略「${row.wxNickname || row.openidMasked}」？可在「已忽略」中查看。`, '提示');
    await api.post(`/admin/wx-entries/${row.id}/ignore`);
    ElMessage.success('已忽略');
    load();
  } catch (e) {
    if (e !== 'cancel' && e?.message) ElMessage.error(e.message);
  }
}

async function remove(row) {
  const label = row.wxNickname || row.openidMasked || '该记录';
  const tip =
    row.status === 'bound'
      ? `删除「${label}」？将同时解绑对应会员的微信，对方下次进入会重新出现在待绑定。`
      : `删除「${label}」？删除后不可恢复。`;
  try {
    await ElMessageBox.confirm(tip, '删除确认', { type: 'warning' });
    await api.delete(`/admin/wx-entries/${row.id}`);
    ElMessage.success('已删除');
    load();
  } catch (e) {
    if (e !== 'cancel' && e?.message) ElMessage.error(e.message);
  }
}

useListRefresh(load);
</script>

<style scoped>
.mono {
  font-size: 12px;
  color: #64748b;
}
.bind-tip {
  margin: 0 0 12px;
}
.status-chip.is-pending {
  background: #fff7ed;
  color: #c2410c;
}
.status-chip.is-bound {
  background: #ecfdf5;
  color: #047857;
}
.status-chip.is-ignored {
  background: #f1f5f9;
  color: #64748b;
}
</style>
