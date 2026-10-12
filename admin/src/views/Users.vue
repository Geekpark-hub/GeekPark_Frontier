<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>用户管理</h2>
        <p class="muted">
          管理后台登录账号与菜单权限。超级管理员不在此列表中。
          {{ me.isSuperAdmin ? '可按菜单勾选授权。' : '仅超级管理员可调整权限。' }}
        </p>
      </div>
      <div class="toolbar-actions">
        <el-button v-if="me.isSuperAdmin" type="primary" @click="openCreate">添加用户</el-button>
      </div>
    </div>

    <el-table :data="list" stripe empty-text="暂无后台用户">
      <el-table-column prop="name" label="姓名" width="120" />
      <el-table-column prop="company" label="组织" min-width="120" />
      <el-table-column prop="title" label="职位" min-width="120" />
      <el-table-column prop="phone" label="手机号" width="130" />
      <el-table-column label="微信绑定" width="100">
        <template #default="{ row }">
          <span class="status-chip" :class="{ 'is-active': !!row.openid }">
            {{ row.openid ? '已绑定' : '未绑定' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="菜单权限" min-width="220">
        <template #default="{ row }">
          <span class="menus-text">{{ menusLabel(row.adminMenus) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button v-if="me.isSuperAdmin" link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button
            v-if="row.openid && me.isSuperAdmin"
            link
            @click="unbind(row)"
          >解绑微信</el-button>
          <el-button
            v-if="me.isSuperAdmin"
            link
            type="danger"
            @click="remove(row)"
          >删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="visible"
      :title="form.id ? '编辑用户' : '添加用户'"
      width="560px"
      append-to-body
      align-center
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item label="姓名" required><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="手机号（后台登录）" required>
          <el-input v-model="form.phone" maxlength="11" placeholder="11 位手机号" />
        </el-form-item>
        <el-form-item label="组织"><el-input v-model="form.company" placeholder="如：前沿社" /></el-form-item>
        <el-form-item label="职位"><el-input v-model="form.title" placeholder="如：运营" /></el-form-item>
        <el-form-item label="菜单权限" required>
          <el-checkbox-group v-model="form.adminMenus" class="menu-checks">
            <el-checkbox
              v-for="m in ASSIGNABLE_MENUS"
              :key="m.key"
              :value="m.key"
            >{{ m.label }}</el-checkbox>
          </el-checkbox-group>
          <p class="tip">勾选后该用户仅能看到并操作对应菜单；「活跃分析」仅超级管理员可见；超级管理员始终拥有全部权限且不出现在本列表。</p>
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
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';
import { ADMIN_MENUS, ASSIGNABLE_MENUS } from '../menus';

const list = ref([]);
const me = reactive({ isSuperAdmin: false });
const visible = ref(false);
const saving = ref(false);
const form = reactive(emptyForm());

function emptyForm() {
  return {
    id: '',
    name: '',
    company: '前沿社',
    title: '运营',
    phone: '',
    adminMenus: ASSIGNABLE_MENUS.filter((m) => m.key !== 'users').map((m) => m.key),
  };
}

function menusLabel(keys) {
  if (!Array.isArray(keys) || !keys.length) return '全部（未配置）';
  const map = Object.fromEntries(ADMIN_MENUS.map((m) => [m.key, m.label]));
  return keys.map((k) => map[k] || k).join('、');
}

async function load() {
  const res = await api.get('/admin/members', { params: { role: 'admin' } });
  list.value = res.members || [];
  me.isSuperAdmin = Boolean(res.me?.isSuperAdmin);
}

function openCreate() {
  Object.assign(form, emptyForm());
  visible.value = true;
}

function openEdit(row) {
  const assignableKeys = new Set(ASSIGNABLE_MENUS.map((m) => m.key));
  const menus = Array.isArray(row.adminMenus) && row.adminMenus.length
    ? row.adminMenus.filter((k) => assignableKeys.has(k))
    : ASSIGNABLE_MENUS.map((m) => m.key);
  Object.assign(form, {
    ...emptyForm(),
    id: row.id,
    name: row.name,
    company: row.company,
    title: row.title,
    phone: row.phone,
    adminMenus: menus,
  });
  visible.value = true;
}

async function save() {
  if (!me.isSuperAdmin) {
    ElMessage.warning('仅超级管理员可操作');
    return;
  }
  if (!form.name?.trim()) {
    ElMessage.warning('请填写姓名');
    return;
  }
  if (!/^1\d{10}$/.test(String(form.phone || '').trim())) {
    ElMessage.warning('请填写正确的 11 位手机号');
    return;
  }
  if (!form.adminMenus?.length) {
    ElMessage.warning('请至少勾选一个菜单权限');
    return;
  }

  saving.value = true;
  try {
    const payload = {
      name: form.name.trim(),
      phone: String(form.phone).trim(),
      company: form.company || '前沿社',
      title: form.title || '运营',
      status: 'active',
      isAdmin: true,
      isSuperAdmin: false,
      adminMenus: form.adminMenus,
    };
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
  await ElMessageBox.confirm(`确认解绑「${row.name}」的微信？`, '解绑微信');
  try {
    await api.post(`/admin/members/${row.id}/unbind-wechat`);
    ElMessage.success('已解绑');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function remove(row) {
  await ElMessageBox.confirm(`确认删除用户「${row.name}」？删除后将无法登录后台。`, '提示');
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

<style scoped>
.menu-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.tip {
  margin: 8px 0 0;
  font-size: 12px;
  color: #6d7883;
  line-height: 1.5;
}
.menus-text {
  font-size: 13px;
  color: #3d4650;
  line-height: 1.4;
}
</style>
