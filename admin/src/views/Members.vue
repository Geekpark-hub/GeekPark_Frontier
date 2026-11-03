<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>会员管理</h2>
        <p class="muted">会员打开小程序会先选用微信昵称进入；请在「微信进入」按昵称人工绑定到对应档案。</p>
      </div>
      <div class="toolbar-actions">
        <el-input
          v-model="keyword"
          clearable
          placeholder="搜索姓名 / 公司 / 职位 / 用户码"
          style="width: 260px"
          @input="onSearchInput"
          @clear="resetAndLoad"
          @keyup.enter="resetAndLoad"
        />
        <el-button type="primary" @click="openCreate">添加会员</el-button>
      </div>
    </div>
    <el-table :data="list" stripe :empty-text="keyword.trim() ? '没有匹配的会员' : '暂无会员'" v-loading="loading">
      <el-table-column prop="name" label="姓名" width="100" />
      <el-table-column prop="company" label="公司" min-width="110" />
      <el-table-column prop="title" label="职位" min-width="90" />
      <el-table-column label="用户码" width="140">
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
      <el-table-column label="生日" width="100">
        <template #default="{ row }">{{ row.birthday ? formatBeijingDate(row.birthday) : '—' }}</template>
      </el-table-column>
      <el-table-column label="手机号" min-width="130">
        <template #default="{ row }">
          <div v-if="maskPhone(row.phone) || phonesExtraList(row).length" class="phone-cell">
            <span v-if="maskPhone(row.phone)">{{ maskPhone(row.phone) }}</span>
            <span v-else>—</span>
            <span
              v-for="p in phonesExtraList(row)"
              :key="p"
              class="phone-extra"
            >备 {{ maskPhone(p) }}</span>
          </div>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="微信" width="80">
        <template #default="{ row }">
          <span class="status-chip" :class="{ 'is-active': !!row.openid }">
            {{ row.openid ? '已绑' : '未绑' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <span class="status-chip" :class="`is-${row.status}`">{{ statusText[row.status] || row.status }}</span>
        </template>
      </el-table-column>
      <el-table-column label="加入" width="100">
        <template #default="{ row }">{{ row.joinedAt ? formatBeijingDate(row.joinedAt) : '—' }}</template>
      </el-table-column>
      <el-table-column label="到期" width="100">
        <template #default="{ row }">{{ formatExpires(row.expiresAt) }}</template>
      </el-table-column>
      <el-table-column label="推送余量" width="168">
        <template #default="{ row }">
          <el-tooltip
            placement="top"
            :content="quotaTip(row)"
          >
            <span class="quota-cell" :class="{ 'is-low': isQuotaLow(row) }">
              {{ formatQuota(row.subscribeQuota) }}
            </span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="260" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link @click="openRegs(row)">活动</el-button>
          <el-button link @click="regenInvite(row)">换码</el-button>
          <el-button v-if="row.openid" link @click="unbind(row)">解绑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <ListPager v-model:page="page" :page-size="pageSize" :total="total" @update:page="onPage" />

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
        <el-form-item v-if="form.id && form.inviteCode" label="用户码">
          <div class="invite-edit">
            <el-input :model-value="maskInviteCode(form.inviteCode)" readonly />
            <el-button @click="copyText(form.inviteCode)">复制全文</el-button>
          </div>
          <p class="muted expires-hint">格式：拼音首字母+1703；换码在列表操作</p>
        </el-form-item>
        <el-form-item label="手机号（选填）">
          <el-input v-model="form.phone" maxlength="11" placeholder="主号，可选" />
        </el-form-item>
        <el-form-item label="其他手机号">
          <el-input
            v-model="form.phonesExtraText"
            type="textarea"
            :rows="2"
            placeholder="备号，每行一个；解绑换绑授权的新号会自动记入"
          />
        </el-form-item>
        <el-form-item label="公司"><el-input v-model="form.company" /></el-form-item>
        <el-form-item label="职位"><el-input v-model="form.title" /></el-form-item>
        <el-form-item label="生日">
          <el-date-picker
            v-model="form.birthday"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选填"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="活跃中" value="active" />
            <el-option label="待更新" value="pending" />
            <el-option label="已过期" value="expired" />
          </el-select>
        </el-form-item>
        <el-form-item label="加入时间">
          <el-date-picker
            v-model="form.joinedAt"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选填，档案加入日"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="到期日" required>
          <div class="expires-row">
            <el-date-picker
              v-model="form.expiresAt"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="必填"
              style="flex: 1; width: 100%"
            />
            <el-button @click="setPermanent">永久</el-button>
          </div>
          <p class="muted expires-hint">永久会员统一设为 2999-12-31</p>
        </el-form-item>
        <el-form-item label="检索关键词">
          <el-input
            v-model="form.rssKeywords"
            type="textarea"
            :rows="2"
            placeholder="分号分隔：中英文名、公司、产品别名，用于公共 RSS 匹配"
          />
        </el-form-item>
        <el-form-item label="Google News RSS（中文）">
          <el-input
            v-model="form.googleNewsRssZh"
            type="textarea"
            :rows="3"
            placeholder="https://news.google.com/rss/search?..."
          />
          <p class="muted field-hint">每行一条，可填多条（也可用逗号/分号分隔）</p>
        </el-form-item>
        <el-form-item label="Google News RSS（英文）">
          <el-input
            v-model="form.googleNewsRssEn"
            type="textarea"
            :rows="3"
            placeholder="https://news.google.com/rss/search?..."
          />
          <p class="muted field-hint">每行一条，可填多条（也可用逗号/分号分隔）</p>
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

    <el-drawer
      v-model="regVisible"
      :title="regMember ? `活动报名 · ${regMember.name}` : '活动报名'"
      size="520px"
      append-to-body
    >
      <el-table :data="regs" stripe empty-text="暂无报名记录" v-loading="regLoading">
        <el-table-column label="活动" min-width="140">
          <template #default="{ row }">{{ row.event?.title || '—' }}</template>
        </el-table-column>
        <el-table-column label="活动时间" width="110">
          <template #default="{ row }">{{ row.event?.startAt ? formatBeijingDate(row.event.startAt) : '—' }}</template>
        </el-table-column>
        <el-table-column label="报名状态" width="90">
          <template #default="{ row }">{{ regStatusText[row.status] || row.status }}</template>
        </el-table-column>
        <el-table-column label="是否参加" width="120">
          <template #default="{ row }">
            <el-select
              :model-value="attendedValue(row.attended)"
              size="small"
              style="width: 100%"
              @change="(v) => setAttended(row, v)"
            >
              <el-option label="未标注" value="unset" />
              <el-option label="已参加" value="yes" />
              <el-option label="未参加" value="no" />
            </el-select>
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';
import ListPager from '../components/ListPager.vue';
import { DEFAULT_PAGE_SIZE, pageParams } from '../utils/listPage';
import { formatBeijingDate, utcToBeijingDatePicker } from '../utils/datetime';
import { maskInviteCode, maskPhone } from '../utils/mask';
import { useListRefresh } from '../utils/useListRefresh';

const list = ref([]);
const loading = ref(false);
const keyword = ref('');
const page = ref(1);
const pageSize = DEFAULT_PAGE_SIZE;
const total = ref(0);
const me = reactive({ isSuperAdmin: false });
const visible = ref(false);
const saving = ref(false);
const form = reactive(emptyForm());
const statusText = {
  active: '活跃中',
  pending: '待更新',
  expired: '已过期',
};
const regStatusText = {
  pending: '待审核',
  approved: '已通过',
  waitlist: '候补',
  cancelled: '已取消',
};

const regVisible = ref(false);
const regLoading = ref(false);
const regMember = ref(null);
const regs = ref([]);

function emptyForm() {
  return {
    id: '',
    name: '',
    company: '',
    title: '',
    phone: '',
    phonesExtraText: '',
    inviteCode: '',
    status: 'active',
    birthday: '',
    joinedAt: '',
    expiresAt: '',
    linkedin: '',
    wechatMp: '',
    xAccount: '',
    youtube: '',
    bilibili: '',
    rssKeywords: '',
    googleNewsRssZh: '',
    googleNewsRssEn: '',
  };
}

const PERMANENT_EXPIRES = '2999-12-31';

function isPermanentExpires(v) {
  if (!v) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime()) && d.getFullYear() >= 2999;
}

function formatExpires(v) {
  if (!v) return '—';
  if (isPermanentExpires(v)) return '永久';
  return formatBeijingDate(v);
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

function setPermanent() {
  form.expiresAt = PERMANENT_EXPIRES;
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

let searchTimer = null;

function resetAndLoad() {
  page.value = 1;
  load();
}

function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(resetAndLoad, 250);
}

async function load() {
  loading.value = true;
  try {
    const params = { role: 'member', ...pageParams(page.value, pageSize) };
    const q = keyword.value.trim();
    if (q) params.q = q;
    const res = await api.get('/admin/members', { params });
    list.value = res.members || [];
    total.value = res.total || 0;
    me.isSuperAdmin = Boolean(res.me?.isSuperAdmin);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  Object.assign(form, emptyForm());
  visible.value = true;
}

function phonesExtraList(row) {
  try {
    const arr = JSON.parse(row?.phonesExtra || '[]');
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parsePhonesExtraText(text) {
  return String(text || '')
    .split(/[\s,，;；]+/)
    .map((s) => s.replace(/\D/g, '').slice(-11))
    .filter((s) => /^1\d{10}$/.test(s));
}

function openEdit(row) {
  Object.assign(form, {
    ...emptyForm(),
    ...row,
    phone: row.phone || '',
    phonesExtraText: phonesExtraList(row).join('\n'),
    inviteCode: row.inviteCode || '',
    birthday: utcToBeijingDatePicker(row.birthday),
    joinedAt: utcToBeijingDatePicker(row.joinedAt),
    expiresAt: utcToBeijingDatePicker(row.expiresAt),
  });
  visible.value = true;
}

async function openRegs(row) {
  regMember.value = row;
  regVisible.value = true;
  regLoading.value = true;
  try {
    const res = await api.get(`/admin/members/${row.id}/registrations`);
    regs.value = res.registrations || [];
  } catch (e) {
    regs.value = [];
    ElMessage.error(e?.message || '加载报名失败');
  } finally {
    regLoading.value = false;
  }
}

function attendedValue(v) {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  return 'unset';
}

async function setAttended(row, v) {
  const attended = v === 'yes' ? true : v === 'no' ? false : null;
  try {
    await api.put(`/admin/registrations/${row.id}`, { attended });
    row.attended = attended;
    ElMessage.success('已更新参加状态');
  } catch (e) {
    ElMessage.error(e?.message || '更新失败');
  }
}

async function save() {
  if (!form.name?.trim()) {
    ElMessage.warning('请填写姓名');
    return;
  }
  const phone = String(form.phone || '').trim();
  if (phone && !/^1\d{10}$/.test(phone)) {
    ElMessage.warning('手机号格式不正确（可不填）');
    return;
  }
  const phonesExtra = parsePhonesExtraText(form.phonesExtraText);
  if (String(form.phonesExtraText || '').trim() && !phonesExtra.length) {
    ElMessage.warning('其他手机号格式不正确');
    return;
  }
  if (!form.expiresAt) {
    ElMessage.warning('请填写到期日；永久会员可点「永久」');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      name: form.name.trim(),
      phone,
      phonesExtra,
      company: form.company,
      title: form.title,
      status: form.status,
      birthday: form.birthday || null,
      joinedAt: form.joinedAt || null,
      expiresAt: form.expiresAt,
      linkedin: form.linkedin,
      wechatMp: form.wechatMp,
      xAccount: form.xAccount,
      youtube: form.youtube,
      bilibili: form.bilibili,
      rssKeywords: form.rssKeywords,
      googleNewsRssZh: form.googleNewsRssZh,
      googleNewsRssEn: form.googleNewsRssEn,
    };
    if (me.isSuperAdmin && !form.id) {
      payload.isAdmin = false;
      payload.isSuperAdmin = false;
    }
    if (form.id) await api.put(`/admin/members/${form.id}`, payload);
    else {
      const res = await api.post('/admin/members', payload);
      const code = res?.member?.inviteCode;
      ElMessage.success(code ? `已保存，用户码 ${code}` : '已保存');
      visible.value = false;
      await load();
      return;
    }
    ElMessage.success('已保存');
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
    await ElMessageBox.confirm(`确认删除会员「${row.name}」？`, '提示');
    await api.delete(`/admin/members/${row.id}`);
    ElMessage.success('已删除');
    if (list.value.length <= 1 && page.value > 1) page.value -= 1;
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
.expires-row {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
}
.expires-hint,
.field-hint {
  margin: 6px 0 0;
  font-size: 12px;
}
.invite-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}
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
.invite-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  letter-spacing: 0.04em;
  color: #14202b;
}
.invite-edit {
  display: flex;
  gap: 8px;
  width: 100%;
}
.phone-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.35;
  font-size: 12px;
}
.phone-extra {
  color: #909399;
}
</style>
