<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>会员管理</h2>
        <p class="muted">管理前沿社会员档案（不含后台用户）。录入手机号后，用户授权即可绑定进入小程序。</p>
      </div>
      <div class="toolbar-actions">
        <el-button type="primary" @click="openCreate">添加会员</el-button>
      </div>
    </div>
    <el-table :data="list" stripe empty-text="暂无会员">
      <el-table-column prop="name" label="姓名" width="110" />
      <el-table-column prop="company" label="公司" min-width="120" />
      <el-table-column prop="title" label="职位" min-width="120" />
      <el-table-column prop="phone" label="手机号" width="130" />
      <el-table-column label="微信绑定" width="100">
        <template #default="{ row }">
          <span class="status-chip" :class="{ 'is-active': !!row.openid }">
            {{ row.openid ? '已绑定' : '未绑定' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <span class="status-chip" :class="`is-${row.status}`">{{ statusText[row.status] || row.status }}</span>
        </template>
      </el-table-column>
      <el-table-column label="到期" width="120">
        <template #default="{ row }">{{ formatDate(row.expiresAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button
            v-if="row.openid && me.isSuperAdmin"
            link
            @click="unbind(row)"
          >解绑微信</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="visible"
      :title="form.id ? '编辑会员' : '添加会员'"
      width="560px"
      append-to-body
      align-center
      destroy-on-close
      class="app-dialog"
    >
      <el-form label-position="top">
        <el-form-item label="姓名" required><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="手机号（登录身份）" required>
          <el-input v-model="form.phone" maxlength="11" placeholder="11 位手机号" />
        </el-form-item>
        <el-form-item label="公司"><el-input v-model="form.company" /></el-form-item>
        <el-form-item label="职位"><el-input v-model="form.title" /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="活跃中" value="active" />
            <el-option label="待更新" value="pending" />
            <el-option label="已过期" value="expired" />
          </el-select>
        </el-form-item>
        <el-form-item label="到期日">
          <el-date-picker v-model="form.expiresAt" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="LinkedIn"><el-input v-model="form.linkedin" placeholder="用于辅助 AI 检索公开信息" /></el-form-item>
        <el-form-item label="公众号"><el-input v-model="form.wechatMp" /></el-form-item>
        <el-form-item label="X / Twitter"><el-input v-model="form.xAccount" /></el-form-item>
        <el-form-item label="YouTube"><el-input v-model="form.youtube" /></el-form-item>
        <el-form-item label="Bilibili"><el-input v-model="form.bilibili" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';

const list = ref([]);
const me = reactive({ isSuperAdmin: false });
const visible = ref(false);
const saving = ref(false);
const form = reactive(emptyForm());
const statusText = {
  active: '活跃中',
  pending: '待更新',
  expired: '已过期',
};

function emptyForm() {
  return {
    id: '',
    name: '',
    company: '',
    title: '',
    phone: '',
    status: 'active',
    expiresAt: '',
    linkedin: '',
    wechatMp: '',
    xAccount: '',
    youtube: '',
    bilibili: '',
  };
}

function formatDate(v) {
  return v ? String(v).slice(0, 10) : '-';
}

async function load() {
  const res = await api.get('/admin/members', { params: { role: 'member' } });
  list.value = res.members || [];
  me.isSuperAdmin = Boolean(res.me?.isSuperAdmin);
}

function openCreate() {
  Object.assign(form, emptyForm());
  visible.value = true;
}

function openEdit(row) {
  Object.assign(form, {
    ...emptyForm(),
    ...row,
    expiresAt: row.expiresAt ? String(row.expiresAt).slice(0, 10) : '',
  });
  visible.value = true;
}

async function save() {
  if (!form.name?.trim()) {
    ElMessage.warning('请填写姓名');
    return;
  }
  if (!/^1\d{10}$/.test(String(form.phone || '').trim())) {
    ElMessage.warning('请填写正确的 11 位手机号');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      name: form.name.trim(),
      phone: String(form.phone).trim(),
      company: form.company,
      title: form.title,
      status: form.status,
      expiresAt: form.expiresAt,
      linkedin: form.linkedin,
      wechatMp: form.wechatMp,
      xAccount: form.xAccount,
      youtube: form.youtube,
      bilibili: form.bilibili,
    };
    // 会员页不改角色；仅超管在新建时显式锁定为普通会员
    if (me.isSuperAdmin && !form.id) {
      payload.isAdmin = false;
      payload.isSuperAdmin = false;
    }
    if (form.id) await api.put(`/admin/members/${form.id}`, payload);
    else await api.post('/admin/members', payload);
    ElMessage.success('已保存');
    visible.value = false;
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function unbind(row) {
  await ElMessageBox.confirm(`确认解绑「${row.name}」的微信？解绑后需重新用手机号登录绑定。`, '解绑微信');
  try {
    await api.post(`/admin/members/${row.id}/unbind-wechat`);
    ElMessage.success('已解绑');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function remove(row) {
  await ElMessageBox.confirm(`确认删除会员「${row.name}」？`, '提示');
  try {
    await api.delete(`/admin/members/${row.id}`);
    ElMessage.success('已删除');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

onMounted(load);
</script>
