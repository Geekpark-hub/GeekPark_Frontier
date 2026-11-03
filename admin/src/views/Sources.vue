<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>信息源</h2>
        <p class="muted">系统会定期把 RSS 新条目存进本地档案（约保留一个月），再与搜索结果合并去重后交给 AI</p>
      </div>
      <div class="toolbar-actions">
        <el-button @click="load" :loading="loading">刷新</el-button>
        <el-button type="primary" @click="openCreate">添加信息源</el-button>
      </div>
    </div>

    <el-table :data="list" stripe empty-text="暂无信息源" v-loading="loading">
      <el-table-column prop="name" label="名称" width="140" />
      <el-table-column prop="url" label="RSS 地址" min-width="280" show-overflow-tooltip />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <span class="status-chip" :class="row.enabled ? 'is-active' : 'is-pending'">
            {{ row.enabled ? '启用' : '停用' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="库存" width="90">
        <template #default="{ row }">{{ row._count?.items ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="本次探测" width="110">
        <template #default="{ row }">
          <span v-if="probeMap[row.id]?.ok">{{ probeMap[row.id].count }} 条</span>
          <span v-else-if="probeMap[row.id]?.error" class="err">失败</span>
          <span v-else class="muted">-</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="260" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" :loading="probingId === row.id" @click="probe(row)">探测</el-button>
          <el-button link @click="toggle(row)">{{ row.enabled ? '停用' : '启用' }}</el-button>
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <ListPager v-model:page="page" :page-size="pageSize" :total="total" @update:page="onPage" />

    <el-dialog
      v-model="visible"
      :title="form.id ? '编辑信息源' : '添加信息源'"
      width="560px"
      append-to-body
      align-center
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="如：极客公园" />
        </el-form-item>
        <el-form-item label="RSS 地址" required>
          <el-input v-model="form.url" placeholder="https://example.com/rss" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
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
import { reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';
import ListPager from '../components/ListPager.vue';
import { DEFAULT_PAGE_SIZE, pageParams } from '../utils/listPage';
import { useListRefresh } from '../utils/useListRefresh';

const list = ref([]);
const page = ref(1);
const pageSize = DEFAULT_PAGE_SIZE;
const total = ref(0);
const loading = ref(false);
const saving = ref(false);
const visible = ref(false);
const probingId = ref('');
const probeMap = reactive({});

const form = reactive({
  id: '',
  name: '',
  url: '',
  enabled: true,
});

function emptyForm() {
  return { id: '', name: '', url: '', enabled: true };
}

async function load() {
  loading.value = true;
  try {
    const res = await api.get('/admin/ai/sources', { params: pageParams(page.value, pageSize) });
    list.value = res.sources || [];
    total.value = res.total || 0;
  } catch (e) {
    ElMessage.error(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  Object.assign(form, emptyForm());
  visible.value = true;
}

function openEdit(row) {
  Object.assign(form, {
    id: row.id,
    name: row.name,
    url: row.url,
    enabled: row.enabled,
  });
  visible.value = true;
}

async function save() {
  if (!form.name.trim()) {
    ElMessage.warning('请填写名称');
    return;
  }
  if (!/^https?:\/\//i.test(form.url.trim())) {
    ElMessage.warning('请填写合法的 RSS 地址');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      name: form.name.trim(),
      url: form.url.trim(),
      enabled: form.enabled,
    };
    if (form.id) await api.put(`/admin/ai/sources/${form.id}`, payload);
    else await api.post('/admin/ai/sources', payload);
    ElMessage.success('已保存');
    visible.value = false;
    await load();
  } catch (e) {
    ElMessage.error(e.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function toggle(row) {
  try {
    await api.put(`/admin/ai/sources/${row.id}`, { enabled: !row.enabled });
    ElMessage.success(row.enabled ? '已停用' : '已启用');
    await load();
  } catch (e) {
    ElMessage.error(e.message || '操作失败');
  }
}

async function probe(row) {
  probingId.value = row.id;
  try {
    const res = await api.post(`/admin/ai/sources/${row.id}/probe`);
    probeMap[row.id] = {
      ok: Boolean(res.ok),
      count: res.count || 0,
      error: res.error || '',
    };
    if (res.ok) ElMessage.success(`探测成功，约 ${res.count} 条`);
    else ElMessage.warning(res.error || '探测失败');
  } catch (e) {
    probeMap[row.id] = { ok: false, count: 0, error: e.message || '探测失败' };
    ElMessage.error(e.message || '探测失败');
  } finally {
    probingId.value = '';
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确认删除信息源「${row.name}」？`, '提示');
    await api.delete(`/admin/ai/sources/${row.id}`);
    ElMessage.success('已删除');
    delete probeMap[row.id];
    await load();
  } catch (e) {
    if (e === 'cancel' || e === 'close') return;
    ElMessage.error(e?.message || '删除失败');
  }
}

function onPage(p) {
  page.value = p;
  load();
}

useListRefresh(load);
</script>

<style scoped>
.err {
  color: var(--danger, #b42318);
}
.muted {
  color: var(--muted, #6d7883);
}
</style>
