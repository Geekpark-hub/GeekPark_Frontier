<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>活动与报名</h2>
        <p class="muted">发布活动并审核会员报名；封面可本地上传</p>
      </div>
      <div class="toolbar-actions">
        <el-button type="primary" @click="openCreate">创建活动</el-button>
      </div>
    </div>
    <el-table :data="list" stripe empty-text="暂无活动">
      <el-table-column label="封面" width="88">
        <template #default="{ row }">
          <img v-if="row.coverUrl" class="thumb" :src="row.coverUrl" alt="" />
          <span v-else class="muted">无</span>
        </template>
      </el-table-column>
      <el-table-column prop="title" label="活动名称" min-width="180" />
      <el-table-column prop="location" label="地点" width="120" />
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <span class="status-chip" :class="`is-${row.status}`">{{ statusText[row.status] || row.status }}</span>
        </template>
      </el-table-column>
      <el-table-column label="开始时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.startAt) }}</template>
      </el-table-column>
      <el-table-column label="报名截止" width="170">
        <template #default="{ row }">{{ formatDateTime(row.registerDeadline) }}</template>
      </el-table-column>
      <el-table-column label="报名数" width="90">
        <template #default="{ row }">{{ row._count?.registrations || 0 }}</template>
      </el-table-column>
      <el-table-column label="操作" width="260" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.status !== 'published'" link type="success" @click="setStatus(row, 'published')">发布</el-button>
          <el-button link @click="openRegs(row)">报名</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="visible" :title="form.id ? '编辑活动' : '创建活动'" width="760px" append-to-body align-center destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="活动名称" required><el-input v-model="form.title" placeholder="如：前沿社季度闭门分享" /></el-form-item>

        <el-form-item label="封面图片">
          <div class="cover-box">
            <img v-if="form.coverUrl" class="cover-preview" :src="form.coverUrl" alt="封面预览" />
            <div v-else class="cover-empty">尚未上传封面</div>
            <div class="cover-actions">
              <el-upload
                :show-file-list="false"
                :http-request="uploadCover"
                accept="image/*"
                :disabled="uploading"
              >
                <el-button :loading="uploading">上传封面</el-button>
              </el-upload>
              <el-button v-if="form.coverUrl" link type="danger" @click="form.coverUrl = ''">清除</el-button>
            </div>
            <el-input v-model="form.coverUrl" placeholder="也可粘贴图片 URL" clearable />
          </div>
        </el-form-item>

        <el-form-item label="活动介绍">
          <el-input v-model="form.description" type="textarea" :rows="4" placeholder="活动背景、主题与适合谁参加" />
        </el-form-item>
        <el-form-item label="地点"><el-input v-model="form.location" placeholder="城市 / 场馆 / 线上链接说明" /></el-form-item>
        <el-form-item label="活动议程">
          <el-input
            v-model="form.agenda"
            type="textarea"
            :rows="4"
            placeholder="建议每行一条，例如：&#10;14:00 签到&#10;14:30 主题分享&#10;16:00 圆桌讨论"
          />
        </el-form-item>
        <el-form-item label="嘉宾信息（如有）">
          <el-input
            v-model="form.guests"
            type="textarea"
            :rows="3"
            placeholder="建议每行一位，例如：&#10;张鹏 · 极客公园 CEO&#10;某某 · XX 公司创始人"
          />
        </el-form-item>
        <el-form-item label="开始时间">
          <el-date-picker v-model="form.startAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]" style="width: 100%" />
        </el-form-item>
        <el-form-item label="结束时间">
          <el-date-picker v-model="form.endAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]" style="width: 100%" />
        </el-form-item>
        <el-form-item label="报名截止时间">
          <el-date-picker v-model="form.registerDeadline" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]" style="width: 100%" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="草稿" value="draft" />
            <el-option label="已发布" value="published" />
            <el-option label="关闭报名" value="closed" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="regVisible" title="报名管理" width="800px" append-to-body align-center>
      <el-table :data="regs" stripe>
        <el-table-column prop="name" label="姓名" width="100" />
        <el-table-column label="会员" width="140">
          <template #default="{ row }">{{ row.member?.name }} / {{ row.member?.company }}</template>
        </el-table-column>
        <el-table-column label="参加" width="80">
          <template #default="{ row }">{{ row.willAttend ? '是' : '否' }}</template>
        </el-table-column>
        <el-table-column prop="companions" label="同行" />
        <el-table-column prop="specialNeeds" label="特殊需求" />
        <el-table-column label="状态" width="150">
          <template #default="{ row }">
            <el-select v-model="row.status" size="small" @change="(v) => updateReg(row, v)">
              <el-option label="待审核" value="pending" />
              <el-option label="已通过" value="approved" />
              <el-option label="候补" value="waitlist" />
              <el-option label="已取消" value="cancelled" />
            </el-select>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import axios from 'axios';
import api from '../api';

const list = ref([]);
const regs = ref([]);
const visible = ref(false);
const regVisible = ref(false);
const saving = ref(false);
const uploading = ref(false);
const form = reactive(emptyForm());
const statusText = {
  draft: '草稿',
  published: '已发布',
  closed: '已关闭',
};

function emptyForm() {
  const start = new Date(Date.now() + 7 * 86400000);
  const end = new Date(start.getTime() + 3 * 3600000);
  return {
    id: '',
    title: '',
    coverUrl: '',
    description: '',
    location: '',
    agenda: '',
    guests: '',
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    registerDeadline: new Date(start.getTime() - 2 * 86400000).toISOString(),
    status: 'draft',
  };
}

function formatDateTime(v) {
  return v ? new Date(v).toLocaleString() : '-';
}

async function load() {
  const res = await api.get('/admin/events');
  list.value = res.events;
}

function openCreate() {
  Object.assign(form, emptyForm());
  visible.value = true;
}

function openEdit(row) {
  Object.assign(form, { ...emptyForm(), ...row });
  visible.value = true;
}

async function uploadCover(option) {
  uploading.value = true;
  try {
    const data = new FormData();
    data.append('file', option.file);
    const token = localStorage.getItem('admin_token');
    const res = await axios.post('/admin/upload/image', data, {
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
      },
      timeout: 60000,
    });
    form.coverUrl = res.data.url;
    ElMessage.success('封面已上传');
    option.onSuccess?.(res.data);
  } catch (e) {
    const msg = e.response?.data?.error || e.message || '上传失败';
    ElMessage.error(msg);
    option.onError?.(e);
  } finally {
    uploading.value = false;
  }
}

async function save() {
  if (!form.title?.trim()) {
    ElMessage.warning('请填写活动名称');
    return;
  }
  saving.value = true;
  try {
    const payload = { ...form };
    delete payload.id;
    if (form.id) await api.put(`/admin/events/${form.id}`, payload);
    else await api.post('/admin/events', payload);
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
  await api.put(`/admin/events/${row.id}`, { status });
  ElMessage.success('已更新');
  await load();
}

async function openRegs(row) {
  const res = await api.get(`/admin/events/${row.id}/registrations`);
  regs.value = res.registrations;
  regVisible.value = true;
}

async function updateReg(row, status) {
  await api.put(`/admin/registrations/${row.id}`, { status });
  ElMessage.success('报名状态已更新');
}

async function remove(row) {
  await ElMessageBox.confirm(`确认删除「${row.title}」？`, '提示');
  await api.delete(`/admin/events/${row.id}`);
  ElMessage.success('已删除');
  await load();
}

onMounted(load);
</script>

<style scoped>
.thumb {
  width: 56px;
  height: 40px;
  object-fit: cover;
  border-radius: 6px;
  background: #eef2f5;
  display: block;
}
.cover-box {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cover-preview {
  width: 100%;
  max-height: 220px;
  object-fit: cover;
  border-radius: 12px;
  background: #eef2f5;
}
.cover-empty {
  height: 140px;
  border-radius: 12px;
  border: 1px dashed rgba(20, 32, 43, 0.16);
  display: grid;
  place-items: center;
  color: #6d7883;
  background: #f7f9fa;
}
.cover-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
