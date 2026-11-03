<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>活动与报名</h2>
        <p class="muted">发布活动并审核会员报名；可勾选展示到动态信息流；「分享」生成落地页短链与小程序码</p>
      </div>
      <div class="toolbar-actions">
        <el-select v-model="status" clearable placeholder="全部状态" style="width: 140px" @change="resetAndLoad">
          <el-option label="草稿" value="draft" />
          <el-option label="已发布" value="published" />
          <el-option label="已结束" value="closed" />
        </el-select>
        <el-button type="primary" @click="openCreate">创建活动</el-button>
      </div>
    </div>
    <el-table :data="list" stripe empty-text="暂无活动" v-loading="loading">
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
      <el-table-column label="信息流" width="140">
        <template #default="{ row }">
          <el-select
            :model-value="feedModeOf(row)"
            size="small"
            :disabled="row.status !== 'published'"
            style="width: 122px"
            @change="(v) => setFeedMode(row, v)"
          >
            <el-option label="不展示" value="off" />
            <el-option label="跟随日期" value="timeline" />
            <el-option label="置顶" value="pin" />
          </el-select>
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
      <el-table-column label="操作" width="360" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.status !== 'published'" link type="success" @click="setStatus(row, 'published')">发布</el-button>
          <el-button v-if="row.status === 'published'" link type="warning" @click="endEvent(row)">结束活动</el-button>
          <el-button link @click="openShare(row)">分享</el-button>
          <el-button link @click="openRegs(row)">报名</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <ListPager v-model:page="page" :page-size="pageSize" :total="total" @update:page="onPage" />

    <el-dialog v-model="visible" :title="form.id ? '编辑活动' : '创建活动'" width="760px" append-to-body align-center destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="活动名称" required><el-input v-model="form.title" placeholder="如：前沿社季度闭门分享" /></el-form-item>

        <el-form-item label="封面图片">
          <div class="cover-box">
            <el-upload
              class="cover-upload"
              drag
              :show-file-list="false"
              :http-request="uploadCover"
              accept="image/*"
              :disabled="uploading"
            >
              <div class="cover-stage" :class="{ 'has-image': !!form.coverUrl && !coverBroken, uploading }">
                <img
                  v-if="form.coverUrl && !coverBroken"
                  class="cover-preview"
                  :src="form.coverUrl"
                  alt="封面预览"
                  @load="coverBroken = false"
                  @error="coverBroken = true"
                />
                <div v-else class="cover-empty-inner">
                  <span class="cover-empty-title">{{
                    form.coverUrl && coverBroken ? '图片加载失败，点击重试' : '点击或拖拽上传封面'
                  }}</span>
                  <span class="cover-empty-sub">建议 1500×844 px（16:9），JPG / PNG</span>
                </div>
                <div v-if="uploading" class="cover-loading">
                  <span class="cover-spinner" />
                  <span>上传中…</span>
                </div>
                <span v-else-if="form.coverUrl && !coverBroken" class="cover-badge">点击更换</span>
              </div>
            </el-upload>
            <p class="cover-hint">建议尺寸：1500×844 px（16:9），宽度 ≥1500px，JPG / PNG</p>
            <div class="cover-meta">
              <el-button
                v-if="form.coverUrl"
                link
                type="danger"
                :disabled="uploading"
                @click.stop="form.coverUrl = ''; coverBroken = false"
              >
                清除封面
              </el-button>
              <el-button link type="primary" @click="showUrlInput = !showUrlInput">
                {{ showUrlInput ? '收起链接' : '粘贴图片链接' }}
              </el-button>
            </div>
            <el-input v-if="showUrlInput" v-model="form.coverUrl" placeholder="粘贴图片 URL" clearable />
          </div>
        </el-form-item>

        <el-form-item label="活动介绍">
          <el-input v-model="form.description" type="textarea" :rows="4" placeholder="活动背景、主题与适合谁参加" />
        </el-form-item>
        <el-form-item label="地点"><el-input v-model="form.location" placeholder="城市 / 场馆 / 线上链接说明" /></el-form-item>
        <el-form-item label="地图坐标">
          <div class="coord-row">
            <el-input v-model="form.locationLat" placeholder="纬度 lat，如 40.0205" clearable />
            <el-input v-model="form.locationLng" placeholder="经度 lng，如 116.4678" clearable />
          </div>
          <div class="form-tip">填写后小程序点「地点」可打开地图；可在腾讯/高德地图搜场馆复制坐标。</div>
        </el-form-item>
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
          <el-date-picker
            v-model="form.startAt"
            type="datetime"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DD HH:mm:ss"
            :default-time="defaultTimeStart"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="结束时间">
          <el-date-picker
            v-model="form.endAt"
            type="datetime"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DD HH:mm:ss"
            :default-time="defaultTimeEnd"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="报名截止时间">
          <el-date-picker
            v-model="form.registerDeadline"
            type="datetime"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DD HH:mm:ss"
            :default-time="defaultTimeDeadline"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="草稿" value="draft" />
            <el-option label="已发布" value="published" />
            <el-option label="已结束" value="closed" />
          </el-select>
        </el-form-item>
        <el-form-item label="信息流展示">
          <el-radio-group v-model="form.feedMode">
            <el-radio-button value="off">不展示</el-radio-button>
            <el-radio-button value="timeline">跟随日期</el-radio-button>
            <el-radio-button value="pin">置顶</el-radio-button>
          </el-radio-group>
          <p class="feed-switch-tip">
            跟随日期：按活动开始日插入动态时间线；置顶：固定在投票卡片之后
          </p>
        </el-form-item>
        <el-form-item v-if="form.feedMode !== 'off'" label="信息流封面">
          <el-switch v-model="form.showCoverInFeed" active-text="展示封面图" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-drawer
      v-model="regVisible"
      :title="regEventTitle ? `报名管理 · ${regEventTitle}` : '报名管理'"
      size="860px"
      append-to-body
      destroy-on-close
    >
      <el-table :data="regs" stripe>
        <el-table-column prop="name" label="姓名" width="100" />
        <el-table-column label="会员" width="140">
          <template #default="{ row }">{{ row.member?.name }} / {{ row.member?.company }}</template>
        </el-table-column>
        <el-table-column label="意向参加" width="80">
          <template #default="{ row }">{{ row.willAttend ? '是' : '否' }}</template>
        </el-table-column>
        <el-table-column prop="companions" label="同行" />
        <el-table-column prop="specialNeeds" label="特殊需求" />
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-select v-model="row.status" size="small" @change="(v) => updateReg(row, { status: v })">
              <el-option label="待审核" value="pending" />
              <el-option label="已通过" value="approved" />
              <el-option label="候补" value="waitlist" />
              <el-option label="已取消" value="cancelled" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="是否参加" width="120">
          <template #default="{ row }">
            <el-select
              :model-value="row.attended === true ? 'yes' : row.attended === false ? 'no' : 'unset'"
              size="small"
              @change="(v) => updateReg(row, { attended: v === 'yes' ? true : v === 'no' ? false : null })"
            >
              <el-option label="未标注" value="unset" />
              <el-option label="已参加" value="yes" />
              <el-option label="未参加" value="no" />
            </el-select>
          </template>
        </el-table-column>
      </el-table>
      <ListPager v-model:page="regPage" :page-size="pageSize" :total="regTotal" @update:page="onRegPage" />
    </el-drawer>

    <el-dialog
      v-model="shareVisible"
      title="分享活动"
      width="640px"
      append-to-body
      align-center
      destroy-on-close
    >
      <p class="muted share-tip">
        打开后进入独立报名落地页。短链固定对应本活动（可发短信 / 邮件 / 网页）；打开时由服务端跳转微信，微信侧约 30 天自动续期，对外链接不变。小程序码可印海报或发群。
      </p>
      <el-form label-position="top">
        <el-form-item label="分享短链">
          <p v-if="shareForm.urlLinkError" class="muted share-tip">{{ shareForm.urlLinkError }}</p>
          <div class="share-row">
            <el-input :model-value="shareForm.urlLink" readonly placeholder="生成中…" />
            <el-button
              type="primary"
              :loading="shareLoading"
              :disabled="!shareForm.urlLink"
              @click="copyText(shareForm.urlLink, '已复制分享短链')"
            >复制</el-button>
          </div>
          <p v-if="shareForm.wxExpiresLabel" class="muted share-tip share-expire">
            微信跳转有效至 {{ shareForm.wxExpiresLabel }}（到期后打开短链会自动续期）
          </p>
        </el-form-item>
        <el-form-item label="小程序路径">
          <div class="share-row">
            <el-input :model-value="shareForm.path" readonly />
            <el-button @click="copyText(shareForm.path, '已复制小程序路径')">复制</el-button>
          </div>
        </el-form-item>
        <el-form-item label="小程序码">
          <div v-if="shareForm.qrcodeDataUrl" class="share-qr-panel">
            <div class="share-qr-stage">
              <div class="share-qr-preview" :class="shareForm.hyaline ? 'is-hyaline' : 'is-bordered'">
                <img :src="shareForm.qrcodeDataUrl" alt="活动小程序码" />
              </div>
              <span class="share-qr-badge">{{ shareForm.hyaline ? '官方圆形' : '含白边' }}</span>
            </div>

            <div class="share-qr-controls">
              <div class="share-qr-section">
                <div class="share-qr-section-title">1. 导出样式</div>
                <div class="share-qr-modes" role="radiogroup" aria-label="导出样式">
                  <button
                    type="button"
                    class="share-qr-mode"
                    :class="{ active: shareForm.hyaline }"
                    :disabled="shareLoading"
                    @click="pickQrStyle(true)"
                  >
                    <span class="share-qr-mode-title">官方圆形</span>
                    <span class="share-qr-mode-desc">微信官方透明底，适合深色海报</span>
                  </button>
                  <button
                    type="button"
                    class="share-qr-mode"
                    :class="{ active: !shareForm.hyaline }"
                    :disabled="shareLoading"
                    @click="pickQrStyle(false)"
                  >
                    <span class="share-qr-mode-title">含白边</span>
                    <span class="share-qr-mode-desc">官方白底方图，适合白底物料</span>
                  </button>
                </div>
              </div>

              <div class="share-qr-section">
                <div class="share-qr-section-title">2. 下载尺寸</div>
                <div class="share-qr-sizes" role="radiogroup" aria-label="下载尺寸">
                  <button
                    v-for="size in qrSizeOptions"
                    :key="size"
                    type="button"
                    class="share-qr-size"
                    :class="{ active: shareForm.qrWidth === size }"
                    :disabled="shareLoading"
                    @click="pickQrWidth(size)"
                  >
                    {{ size }}px
                  </button>
                </div>
              </div>

              <el-button
                type="primary"
                class="share-qr-download"
                :loading="shareLoading"
                @click="downloadQr()"
              >
                下载 {{ shareForm.hyaline ? '官方圆形' : '含白边' }} · {{ shareForm.qrWidth }}px
              </el-button>
            </div>
          </div>
          <p v-else class="muted">{{ shareForm.qrcodeError || '生成短链时一并拉取；未正式发布时将尝试生成体验版小程序码' }}</p>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="shareVisible = false">关闭</el-button>
        <el-button :loading="shareLoading" @click="refreshWxJump">刷新微信跳转</el-button>
        <el-button
          type="primary"
          :loading="shareLoading"
          :disabled="!shareForm.urlLink"
          @click="copyText(shareForm.urlLink, '已复制分享短链')"
        >复制短链</el-button>
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
import {
  beijingPickerToUtc,
  defaultEventPickerTimes,
  formatBeijingDateTime,
  utcToBeijingPicker,
} from '../utils/datetime';
import { useListRefresh } from '../utils/useListRefresh';

const list = ref([]);
const loading = ref(false);
const page = ref(1);
const pageSize = DEFAULT_PAGE_SIZE;
const total = ref(0);
const status = ref('');
const regs = ref([]);
const regPage = ref(1);
const regTotal = ref(0);
const regEventId = ref('');
const regEventTitle = ref('');
const visible = ref(false);
const regVisible = ref(false);
const saving = ref(false);
const uploading = ref(false);
const showUrlInput = ref(false);
const coverBroken = ref(false);
const shareVisible = ref(false);
const shareLoading = ref(false);
const qrSizeOptions = [430, 860, 1280];
const shareForm = reactive({
  id: '',
  title: '',
  urlLink: '',
  urlLinkError: '',
  wxExpiresLabel: '',
  path: '',
  qrcodeDataUrl: '',
  qrcodeError: '',
  qrWidth: 430,
  hyaline: true,
});
const form = reactive(emptyForm());
const defaultTimeStart = new Date(2000, 0, 1, 14, 0, 0);
const defaultTimeEnd = new Date(2000, 0, 1, 17, 0, 0);
const defaultTimeDeadline = new Date(2000, 0, 1, 18, 0, 0);
const statusText = {
  draft: '草稿',
  published: '已发布',
  closed: '已结束',
};

function emptyForm() {
  const times = defaultEventPickerTimes();
  return {
    id: '',
    title: '',
    coverUrl: '',
    description: '',
    location: '',
    locationLat: '',
    locationLng: '',
    agenda: '',
    guests: '',
    startAt: times.startAt,
    endAt: times.endAt,
    registerDeadline: times.registerDeadline,
    status: 'draft',
    showInFeed: false,
    showCoverInFeed: false,
    feedPin: false,
    feedMode: 'off',
  };
}

function feedModeOf(row) {
  if (!row?.showInFeed) return 'off';
  return row.feedPin ? 'pin' : 'timeline';
}

function applyFeedMode(target, mode) {
  const m = mode === 'pin' || mode === 'timeline' ? mode : 'off';
  target.feedMode = m;
  target.showInFeed = m !== 'off';
  target.feedPin = m === 'pin';
}

function formatDateTime(v) {
  return formatBeijingDateTime(v);
}

async function load() {
  loading.value = true;
  try {
    const params = { ...pageParams(page.value, pageSize) };
    if (status.value) params.status = status.value;
    const res = await api.get('/admin/events', { params });
    list.value = res.events || [];
    total.value = res.total || 0;
  } finally {
    loading.value = false;
  }
}

function resetAndLoad() {
  page.value = 1;
  load();
}

function openCreate() {
  Object.assign(form, emptyForm());
  showUrlInput.value = false;
  coverBroken.value = false;
  visible.value = true;
}

function openEdit(row) {
  Object.assign(form, {
    ...emptyForm(),
    ...row,
    locationLat: row.locationLat != null && row.locationLat !== '' ? String(row.locationLat) : '',
    locationLng: row.locationLng != null && row.locationLng !== '' ? String(row.locationLng) : '',
    showCoverInFeed: row.showCoverInFeed !== false,
    startAt: utcToBeijingPicker(row.startAt),
    endAt: utcToBeijingPicker(row.endAt),
    registerDeadline: utcToBeijingPicker(row.registerDeadline),
  });
  applyFeedMode(form, feedModeOf(row));
  showUrlInput.value = false;
  coverBroken.value = false;
  visible.value = true;
}

async function uploadCover(option) {
  uploading.value = true;
  try {
    const data = new FormData();
    data.append('file', option.file);
    const token = localStorage.getItem('admin_token');
    const res = await api.post('/admin/upload/image', data, {
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
      },
      timeout: 60000,
      skipGlobalLoading: true,
    });
    form.coverUrl = res.url;
    coverBroken.value = false;
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
    applyFeedMode(form, form.feedMode);
    const payload = {
      ...form,
      startAt: beijingPickerToUtc(form.startAt),
      endAt: beijingPickerToUtc(form.endAt),
      registerDeadline: beijingPickerToUtc(form.registerDeadline),
    };
    delete payload.id;
    delete payload.feedMode;
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

async function endEvent(row) {
  try {
    await ElMessageBox.confirm(
      `确认结束「${row.title}」？结束后将关闭报名，并从信息流移除。`,
      '结束活动',
      { type: 'warning', confirmButtonText: '结束活动', cancelButtonText: '取消' },
    );
    await api.put(`/admin/events/${row.id}`, { status: 'closed', showInFeed: false, feedPin: false });
    ElMessage.success('活动已结束');
    await load();
  } catch (e) {
    if (e === 'cancel' || e === 'close') return;
    ElMessage.error(e?.message || '操作失败');
  }
}

async function setFeedMode(row, mode) {
  try {
    const next = { showInFeed: false, feedPin: false };
    applyFeedMode(next, mode);
    await api.put(`/admin/events/${row.id}`, {
      showInFeed: next.showInFeed,
      feedPin: next.feedPin,
    });
    row.showInFeed = next.showInFeed;
    row.feedPin = next.feedPin;
    const tip =
      mode === 'pin' ? '已置顶到信息流' : mode === 'timeline' ? '已按日期插入信息流' : '已从信息流移除';
    ElMessage.success(tip);
  } catch (e) {
    ElMessage.error(e?.message || '更新失败');
  }
}

async function openRegs(row) {
  regEventId.value = row.id;
  regEventTitle.value = row.title || '';
  regPage.value = 1;
  await loadRegs();
  regVisible.value = true;
}

async function loadRegs() {
  if (!regEventId.value) return;
  const res = await api.get(`/admin/events/${regEventId.value}/registrations`, {
    params: pageParams(regPage.value, pageSize),
  });
  regs.value = res.registrations || [];
  regTotal.value = res.total || 0;
}

function onRegPage(p) {
  regPage.value = p;
  loadRegs();
}

async function updateReg(row, payload) {
  const body = typeof payload === 'string' ? { status: payload } : payload;
  await api.put(`/admin/registrations/${row.id}`, body);
  if (body.attended !== undefined) row.attended = body.attended;
  if (body.status !== undefined) row.status = body.status;
  ElMessage.success('报名已更新');
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确认删除「${row.title}」？`, '提示');
    await api.delete(`/admin/events/${row.id}`);
    ElMessage.success('已删除');
    await load();
  } catch (e) {
    if (e === 'cancel' || e === 'close') return;
    ElMessage.error(e?.message || '删除失败');
  }
}

async function copyText(text, okMsg = '已复制') {
  const v = String(text || '').trim();
  if (!v) return;
  try {
    await navigator.clipboard.writeText(v);
    ElMessage.success(okMsg);
  } catch {
    ElMessage.info(v);
  }
}

function wxExpiresLabelOf(v) {
  if (!v) return '';
  const label = formatBeijingDateTime(v);
  return label === '-' ? '' : label;
}

async function openShare(row) {
  shareForm.id = row.id;
  shareForm.title = row.title || '';
  shareForm.path = `/pages/events/share?id=${row.id}`;
  shareForm.urlLink = '';
  shareForm.urlLinkError = '';
  shareForm.wxExpiresLabel = '';
  shareForm.qrcodeDataUrl = '';
  shareForm.qrcodeError = '';
  shareForm.qrWidth = 430;
  shareForm.hyaline = true;
  shareVisible.value = true;
  await genShareLink({ quiet: true, autoCopy: false });
}

async function refreshQr() {
  if (!shareForm.id || !shareVisible.value) return;
  await genShareLink({ quiet: true, autoCopy: false, qrToast: true });
}

async function pickQrWidth(width) {
  if (shareLoading.value || Number(width) === shareForm.qrWidth) return;
  shareForm.qrWidth = Number(width);
  await refreshQr();
}

async function pickQrStyle(hyaline) {
  if (shareLoading.value || Boolean(hyaline) === shareForm.hyaline) return;
  shareForm.hyaline = Boolean(hyaline);
  await refreshQr();
}

async function refreshWxJump() {
  await genShareLink({ quiet: false, autoCopy: false, forceRefresh: true });
  if (shareForm.urlLink) {
    ElMessage.success('已刷新微信跳转；对外短链不变');
  }
}

async function genShareLink({
  quiet = false,
  autoCopy = true,
  forceRefresh = false,
  qrToast = false,
} = {}) {
  if (!shareForm.id) return;
  shareLoading.value = true;
  try {
    const res = await api.post(`/admin/events/${shareForm.id}/share-link`, {
      width: shareForm.qrWidth,
      hyaline: shareForm.hyaline,
      forceRefresh,
    });
    shareForm.urlLink = res.urlLink || '';
    shareForm.urlLinkError = res.urlLinkError || '';
    shareForm.wxExpiresLabel = wxExpiresLabelOf(res.wxExpiresAt);
    shareForm.path = res.path || shareForm.path;
    shareForm.qrcodeDataUrl = res.qrcodeDataUrl || '';
    shareForm.qrcodeError = res.qrcodeError || '';
    if (res.qrcodeWidth) shareForm.qrWidth = res.qrcodeWidth;
    if (typeof res.qrcodeHyaline === 'boolean') shareForm.hyaline = res.qrcodeHyaline;
    if (quiet) {
      if (qrToast && shareForm.qrcodeDataUrl) {
        ElMessage.success(
          `已生成 ${shareForm.qrWidth}px ${shareForm.hyaline ? '官方圆形' : '含白边'}小程序码`,
        );
      } else if (qrToast && shareForm.qrcodeError) {
        ElMessage.warning(shareForm.qrcodeError);
      }
      if (!shareForm.urlLink && shareForm.urlLinkError) {
        ElMessage.warning(shareForm.urlLinkError);
      }
      return;
    }
    if (autoCopy && shareForm.urlLink) {
      await copyText(shareForm.urlLink, '已复制分享短链，可发给别人');
    } else if (!shareForm.urlLink && shareForm.qrcodeDataUrl) {
      ElMessage.success('短链暂不可用，已生成体验版小程序码');
    } else if (shareForm.urlLinkError) {
      ElMessage.warning(shareForm.urlLinkError);
    }
  } catch (e) {
    ElMessage.error(e?.message || '生成失败（需已发布小程序且开通 URL Link）');
  } finally {
    shareLoading.value = false;
  }
}

function downloadQr() {
  const dataUrl = shareForm.qrcodeDataUrl;
  if (!dataUrl) return;
  // 原样下载微信返回结果，不做本地裁剪
  const mimeMatch = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);/);
  const mime = mimeMatch?.[1] || 'image/png';
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
  const width = shareForm.qrWidth || 430;
  const safeName = String(shareForm.title || 'share').slice(0, 40);
  const suffix = shareForm.hyaline ? '官方圆形' : '含白边';
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${safeName}-小程序码-${width}-${suffix}.${ext}`;
  a.click();
}

function onPage(p) {
  page.value = p;
  load();
}

useListRefresh(load);
</script>

<style scoped>
.coord-row {
  display: flex;
  gap: 10px;
  width: 100%;
}
.coord-row .el-input {
  flex: 1;
}
.form-tip {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: #8a8378;
}
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
.cover-upload {
  width: 100%;
}
.cover-upload :deep(.el-upload),
.cover-upload :deep(.el-upload-dragger) {
  width: 100%;
  height: auto !important;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 12px;
  overflow: hidden;
}
.cover-stage {
  position: relative;
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
  border: 1px dashed rgba(20, 32, 43, 0.18);
  background: linear-gradient(160deg, #f4f7f8 0%, #eef2f5 100%);
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.cover-stage:not(.has-image) {
  aspect-ratio: 16 / 9; /* 仅无图占位 */
}
.cover-stage:hover {
  border-color: rgba(20, 70, 60, 0.45);
  box-shadow: 0 8px 24px rgba(20, 32, 43, 0.06);
}
.cover-stage.has-image {
  border-style: solid;
  border-color: rgba(20, 32, 43, 0.08);
  aspect-ratio: auto;
}
.cover-preview {
  display: block;
  width: 100%;
  height: auto;
  vertical-align: top;
}
.cover-empty-inner {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #6d7883;
}
.cover-empty-title {
  font-size: 15px;
  font-weight: 600;
  color: #24303a;
}
.cover-empty-sub {
  font-size: 12px;
}
.cover-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #fff;
  background: rgba(20, 32, 43, 0.48);
  font-size: 14px;
  font-weight: 600;
}
.cover-badge {
  position: absolute;
  right: 12px;
  bottom: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(20, 32, 43, 0.72);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  pointer-events: none;
}
.cover-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
.cover-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.cover-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.share-tip {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.5;
}
.share-expire {
  margin: 8px 0 0;
}
.share-row {
  display: flex;
  gap: 8px;
  width: 100%;
}
.share-qr-panel {
  display: grid;
  grid-template-columns: 176px minmax(0, 1fr);
  gap: 16px 20px;
  align-items: start;
  padding: 0;
  background: transparent;
}
.share-qr-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.share-qr-preview {
  width: 168px;
  height: 168px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  overflow: visible;
}
.share-qr-preview img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
}
.share-qr-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 76px;
  padding: 4px 10px;
  border-radius: 999px;
  background: #14202b;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.share-qr-controls {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.share-qr-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.share-qr-section-title {
  font-size: 12px;
  font-weight: 700;
  color: #3a4652;
  letter-spacing: 0.04em;
}
.share-qr-modes,
.share-qr-sizes {
  display: grid;
  gap: 8px;
}
.share-qr-modes {
  grid-template-columns: 1fr 1fr;
}
.share-qr-sizes {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.share-qr-mode,
.share-qr-size {
  margin: 0;
  border: 1.5px solid rgba(20, 32, 43, 0.12);
  background: #fff;
  color: #14202b;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}
.share-qr-mode {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 10px;
  min-height: 72px;
}
.share-qr-size {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 6px;
  border-radius: 10px;
  text-align: center;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.2;
}
.share-qr-mode:hover,
.share-qr-size:hover {
  border-color: rgba(15, 110, 120, 0.45);
}
.share-qr-mode.active,
.share-qr-size.active {
  border-color: #0f6e78;
  background: #d8eef0;
  box-shadow: inset 0 0 0 1px rgba(15, 110, 120, 0.2);
  color: #0b565e;
}
.share-qr-mode-title {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.2;
}
.share-qr-mode-desc {
  font-size: 12px;
  color: #6d7883;
  line-height: 1.35;
}
.share-qr-size:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.share-qr-download {
  width: 100%;
  height: 40px;
  font-weight: 600;
}
@media (max-width: 640px) {
  .share-qr-panel {
    grid-template-columns: 1fr;
  }
  .share-qr-modes,
  .share-qr-sizes {
    grid-template-columns: 1fr;
  }
}
.feed-switch {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.feed-switch-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
</style>
