<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>社群投票</h2>
        <p class="muted">创建、发布与查看会员投票结果</p>
      </div>
      <div class="toolbar-actions">
        <el-button type="primary" @click="openCreate">创建投票</el-button>
      </div>
    </div>
    <el-table :data="list" stripe empty-text="暂无投票">
      <el-table-column prop="title" label="标题" min-width="220" />
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <span class="status-chip" :class="`is-${row.status}`">{{ statusText[row.status] || row.status }}</span>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="90">
        <template #default="{ row }">{{ row.multiSelect ? '多选' : '单选' }}</template>
      </el-table-column>
      <el-table-column label="截止" width="170">
        <template #default="{ row }">{{ formatDateTime(row.endAt) }}</template>
      </el-table-column>
      <el-table-column label="票数" width="80">
        <template #default="{ row }">{{ row._count?.votes || 0 }}</template>
      </el-table-column>
      <el-table-column label="操作" width="280" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.status !== 'published'" link type="success" @click="setStatus(row, 'published')">发布</el-button>
          <el-button v-if="row.status === 'published'" link type="warning" @click="setStatus(row, 'ended')">结束</el-button>
          <el-button link @click="showResults(row)">结果</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="visible"
      :title="form.id ? '编辑投票' : '创建投票'"
      width="640px"
      append-to-body
      align-center
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item label="标题" required><el-input v-model="form.title" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="form.description" type="textarea" :rows="3" /></el-form-item>
        <div class="switch-row">
          <el-form-item label="多选"><el-switch v-model="form.multiSelect" /></el-form-item>
          <el-form-item label="向会员公开投票人">
            <el-switch v-model="form.showVoters" />
            <span class="field-tip">关闭时小程序不展示谁投了什么；后台「结果」始终可看</span>
          </el-form-item>
        </div>
        <el-form-item label="开始时间">
          <el-date-picker v-model="form.startAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]" style="width: 100%" />
        </el-form-item>
        <el-form-item label="结束时间">
          <el-date-picker v-model="form.endAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]" style="width: 100%" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="草稿" value="draft" />
            <el-option label="已发布" value="published" />
            <el-option label="已结束" value="ended" />
          </el-select>
        </el-form-item>
        <el-form-item label="选项">
          <div v-for="(opt, idx) in form.options" :key="idx" class="option-row">
            <el-input v-model="form.options[idx]" />
            <el-button @click="form.options.splice(idx, 1)">删</el-button>
          </div>
          <el-button @click="form.options.push('')">添加选项</el-button>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resultVisible" title="投票结果" width="720px" append-to-body align-center>
      <div v-if="results">
        <p class="result-summary">
          已投票 {{ results.votedCount }} 人 · 未投票 {{ results.unvotedCount }} 人 · 总票数 {{ results.totalVotes }}
        </p>
        <h4 class="result-block-title">选项统计</h4>
        <el-table :data="results.options" size="small">
          <el-table-column prop="text" label="选项" />
          <el-table-column prop="count" label="票数" width="80" />
          <el-table-column prop="ratio" label="比例%" width="90" />
        </el-table>

        <h4 class="result-block-title">投票明细（谁投了什么）</h4>
        <el-table v-if="voters.length" :data="voters" size="small">
          <el-table-column prop="name" label="会员" width="120" />
          <el-table-column prop="company" label="公司" min-width="140" />
          <el-table-column prop="optionText" label="所选选项" width="140" />
          <el-table-column label="投票时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
        </el-table>
        <p v-else class="muted">暂无投票记录</p>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';

const list = ref([]);
const visible = ref(false);
const resultVisible = ref(false);
const results = ref(null);
const voters = ref([]);
const saving = ref(false);
const form = reactive(emptyForm());
const statusText = {
  draft: '草稿',
  published: '进行中',
  ended: '已结束',
};

function emptyForm() {
  const now = new Date();
  const end = new Date(now.getTime() + 7 * 86400000);
  return {
    id: '',
    title: '',
    description: '',
    multiSelect: false,
    showVoters: false,
    startAt: now.toISOString(),
    endAt: end.toISOString(),
    status: 'draft',
    options: ['同意', '不同意', '暂缓'],
  };
}

function formatDateTime(v) {
  return v ? new Date(v).toLocaleString() : '-';
}

async function load() {
  const res = await api.get('/admin/polls');
  list.value = res.polls;
}

function openCreate() {
  Object.assign(form, emptyForm());
  visible.value = true;
}

function openEdit(row) {
  Object.assign(form, {
    id: row.id,
    title: row.title,
    description: row.description,
    multiSelect: row.multiSelect,
    showVoters: row.showVoters,
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
    options: (row.options || []).map((o) => o.text),
  });
  visible.value = true;
}

async function save() {
  saving.value = true;
  try {
    const payload = {
      title: form.title,
      description: form.description,
      multiSelect: form.multiSelect,
      showVoters: form.showVoters,
      startAt: form.startAt,
      endAt: form.endAt,
      status: form.status,
      options: form.options.filter(Boolean),
    };
    if (form.id) await api.put(`/admin/polls/${form.id}`, payload);
    else await api.post('/admin/polls', payload);
    ElMessage.success('已保存');
    visible.value = false;
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function setStatus(row, status) {
  await api.put(`/admin/polls/${row.id}`, { status });
  ElMessage.success('已更新');
  await load();
}

async function showResults(row) {
  const res = await api.get(`/admin/polls/${row.id}/results`);
  results.value = res.results;
  voters.value = res.voters || [];
  resultVisible.value = true;
}

async function remove(row) {
  await ElMessageBox.confirm(`确认删除「${row.title}」？`, '提示');
  await api.delete(`/admin/polls/${row.id}`);
  ElMessage.success('已删除');
  await load();
}

onMounted(load);
</script>

<style scoped>
.switch-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.option-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  width: 100%;
}

.field-tip {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
}

.result-summary {
  margin: 0 0 16px;
  color: var(--ink-soft);
}

.result-block-title {
  margin: 20px 0 10px;
  font-size: 14px;
  font-weight: 600;
}
</style>
