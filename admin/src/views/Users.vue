<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>用户管理</h2>
        <p class="muted">管理后台登录账号与菜单权限；小程序入会用用户码，绑一次微信即可。</p>
      </div>
      <div class="toolbar-actions">
        <el-button type="primary" @click="openCreate">添加用户</el-button>
      </div>
    </div>

    <el-table :data="list" stripe empty-text="暂无后台用户" v-loading="loading">
      <el-table-column prop="name" label="姓名" width="110" />
      <el-table-column prop="company" label="组织" min-width="110" />
      <el-table-column prop="title" label="职位" min-width="100" />
      <el-table-column label="用户码" width="150">
        <template #default="{ row }">
          <div class="invite-cell">
            <code class="invite-code">{{ maskInviteCode(row.inviteCode) || '—' }}</code>
            <el-button
              v-if="row.inviteCode"
              link
              type="primary"
              @click="copyInvite(row)"
            >复制</el-button>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="手机号" width="120">
        <template #default="{ row }">{{ maskPhone(row.phone) || '—' }}</template>
      </el-table-column>
      <el-table-column label="微信绑定" width="100">
        <template #default="{ row }">
          <span class="status-chip" :class="{ 'is-active': !!row.openid }">
            {{ row.openid ? '已绑定' : '未绑定' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="推送余量" width="168">
        <template #default="{ row }">
          <el-tooltip placement="top" :content="quotaTip(row)">
            <span class="quota-cell" :class="{ 'is-low': isQuotaLow(row) }">
              {{ formatQuota(row.subscribeQuota) }}
            </span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="菜单权限" min-width="200">
        <template #default="{ row }">
          <span class="menus-text">{{ menusLabel(row.adminMenus) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link @click="regenInvite(row)">换码</el-button>
          <el-button v-if="row.openid" link @click="unbind(row)">解绑微信</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <ListPager v-model:page="page" :page-size="pageSize" :total="total" @update:page="onPage" />

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
        <el-form-item v-if="form.id && form.inviteCode" label="小程序用户码">
          <div class="invite-edit">
            <el-input :model-value="maskInviteCode(form.inviteCode)" readonly />
            <el-button @click="copyText(form.inviteCode)">复制全文</el-button>
          </div>
          <p class="muted hint">界面已脱敏；复制全文发给管理员，进小程序核验一次即可</p>
        </el-form-item>
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
import { ADMIN_MENUS, ASSIGNABLE_MENUS } from '../menus';
import { maskInviteCode, maskPhone } from '../utils/mask';
import { useListRefresh } from '../utils/useListRefresh';

const list = ref([]);
const loading = ref(false);
const page = ref(1);
const pageSize = DEFAULT_PAGE_SIZE;
const total = ref(0);
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
    inviteCode: '',
    adminMenus: ASSIGNABLE_MENUS.map((m) => m.key),
  };
}

function menusLabel(keys) {
  if (!Array.isArray(keys) || !keys.length) return '全部（未配置）';
  const map = Object.fromEntries(ADMIN_MENUS.map((m) => [m.key, m.label]));
  return keys.map((k) => map[k] || k).join('、');
}

/** 剩余推送机会：到期 / 报名 / 提醒 */
function formatQuota(q) {
  if (!q || !q.byKind) return '—';
  const k = q.byKind;
  return `到${k.expiry ?? 0}·报${k.register ?? 0}·提${k.eventRemind ?? 0}`;
}

function isQuotaLow(row) {
  const min = row?.subscribeQuota?.minRemaining;
  return typeof min === 'number' && min < 2;
}

function quotaTip(row) {
  const q = row?.subscribeQuota;
  if (!q) return '暂无授权/推送记录（估算：授权次数 − 成功发送）';
  const k = q.byKind || {};
  return `剩余机会（授权−已发）最少 ${q.minRemaining ?? 0}：到期 ${k.expiry ?? 0}，报名 ${k.register ?? 0}，活动提醒 ${k.eventRemind ?? 0}`;
}

async function copyText(text) {
  const v = String(text || '').trim();
  if (!v) return;
  try {
    await navigator.clipboard.writeText(v);
    ElMessage.success('已复制用户码');
  } catch {
    ElMessage.info(v);
  }
}

function copyInvite(row) {
  copyText(row.inviteCode);
}

async function load() {
  loading.value = true;
  try {
    const res = await api.get('/admin/members', { params: { role: 'admin', ...pageParams(page.value, pageSize) } });
    list.value = res.members || [];
    total.value = res.total || 0;
  } finally {
    loading.value = false;
  }
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
    inviteCode: row.inviteCode || '',
    adminMenus: menus,
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
    if (form.id) {
      await api.put(`/admin/members/${form.id}`, payload);
      ElMessage.success('已保存');
    } else {
      const res = await api.post('/admin/members', payload);
      const code = res?.member?.inviteCode;
      ElMessage.success(code ? `已保存，小程序用户码 ${code}` : '已保存');
    }
    visible.value = false;
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function regenInvite(row) {
  try {
    await ElMessageBox.confirm(
      `确认重置「${row.name}」的用户码？旧码将立即失效。`,
      '重置用户码'
    );
    const res = await api.post(`/admin/members/${row.id}/invite-code`);
    const code = res?.member?.inviteCode;
    ElMessage.success(code ? `新用户码 ${code}` : '已重置');
    await load();
  } catch (e) {
    if (e === 'cancel' || e === 'close') return;
    ElMessage.error(e?.message || '重置失败');
  }
}

async function unbind(row) {
  await ElMessageBox.confirm(
    `确认解绑「${row.name}」的微信？解绑后需重新用用户码登录绑定。`,
    '解绑微信'
  );
  try {
    await api.post(`/admin/members/${row.id}/unbind-wechat`);
    ElMessage.success('已解绑');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确认删除用户「${row.name}」？删除后将无法登录后台。`, '提示');
    await api.delete(`/admin/members/${row.id}`);
    ElMessage.success('已删除');
    await load();
  } catch (e) {
    if (e === 'cancel' || e === 'close') return;
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
.quota-cell {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: #606266;
  cursor: default;
}
.quota-cell.is-low {
  color: #c45656;
  font-weight: 600;
}
.invite-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}
.invite-code {
  font-size: 12px;
  letter-spacing: 0.02em;
}
.invite-edit {
  display: flex;
  gap: 8px;
  width: 100%;
}
.hint {
  margin: 6px 0 0;
  font-size: 12px;
}
.menus-text {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
}
.menu-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}
.status-chip.is-active {
  color: var(--el-color-success);
}
</style>
