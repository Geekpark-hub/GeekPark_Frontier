<template>
  <div class="shell">
    <aside class="aside">
      <div class="brand-block">
        <div class="brand-mark">FS</div>
        <div>
          <div class="brand-name">前沿社</div>
          <div class="brand-sub">Admin</div>
        </div>
      </div>

      <nav class="nav">
        <router-link
          v-for="item in nav"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: route.path === item.path }"
        >
          <span class="nav-bar"></span>
          <span class="nav-label">{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="aside-foot">
        <p>仅限授权管理员</p>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div>
          <p class="crumb">管理后台 / {{ currentLabel }}</p>
          <h1>{{ currentLabel }}</h1>
        </div>
        <div class="user">
          <button
            v-if="showAiChip && (aiRunning || pendingAuto > 0)"
            class="ai-chip"
            :class="{ running: aiRunning }"
            type="button"
            @click="goFeedPending"
          >
            <span v-if="aiRunning" class="dot"></span>
            {{ aiRunning ? 'AI 抓取中…' : `待审 ${pendingAuto}` }}
          </button>
          <div class="avatar">{{ initials }}</div>
          <div class="user-meta">
            <strong>{{ member?.name || '管理员' }}</strong>
            <span>{{ roleLabel }}</span>
          </div>
          <button class="logout" type="button" @click="logout">退出</button>
        </div>
      </header>

      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  startAiJobMonitor,
  stopAiJobMonitor,
  useAiJobMonitorState,
} from '../stores/aiJobMonitor';
import { ADMIN_MENUS, canAccessMenu, memberMenus } from '../menus';

const route = useRoute();
const router = useRouter();
const { currentRun, pendingAuto, isRunning } = useAiJobMonitorState();
const aiRunning = isRunning;

const member = computed(() => {
  try {
    return JSON.parse(localStorage.getItem('admin_member') || 'null');
  } catch {
    return null;
  }
});

const nav = computed(() => {
  const allowed = new Set(memberMenus(member.value));
  return ADMIN_MENUS.filter((m) => allowed.has(m.key)).map((m) => ({
    path: m.path,
    label: m.label,
  }));
});

const currentLabel = computed(() => {
  return nav.value.find((n) => n.path === route.path)?.label || '工作台';
});

const roleLabel = computed(() => {
  if (member.value?.isSuperAdmin) return '超级管理员';
  if (member.value?.isAdmin) return '管理员';
  return member.value?.company || '前沿社';
});

const showAiChip = computed(
  () => canAccessMenu(member.value, 'feed') || canAccessMenu(member.value, 'ai')
);

const initials = computed(() => {
  const name = member.value?.name || '管';
  return name.slice(0, 1);
});

function goFeedPending() {
  router.push('/feed');
  window.dispatchEvent(new CustomEvent('ai-feed-done', {
    detail: { run: currentRun.value, pendingAuto: pendingAuto.value },
  }));
}

function onNavigateHint() {
  router.push('/feed');
}

function logout() {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_member');
  router.push('/login');
}

onMounted(() => {
  if (showAiChip.value) startAiJobMonitor();
  window.addEventListener('ai-feed-navigate', onNavigateHint);
});

onBeforeUnmount(() => {
  stopAiJobMonitor();
  window.removeEventListener('ai-feed-navigate', onNavigateHint);
});
</script>

<style scoped>
.shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 248px 1fr;
  background:
    radial-gradient(circle at 100% 0%, rgba(15, 110, 120, 0.08), transparent 28%),
    linear-gradient(180deg, #f5f7f9 0%, #eef1f4 100%);
}

.aside {
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 22px 16px;
  color: #eef4f5;
  background:
    linear-gradient(180deg, rgba(15, 110, 120, 0.18), transparent 35%),
    linear-gradient(180deg, #121c25, #172430 100%);
  border-right: 1px solid rgba(255, 255, 255, 0.04);
}

.brand-block {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px 24px;
}

.brand-mark {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 11px;
  background: rgba(15, 110, 120, 0.35);
  border: 1px solid rgba(216, 238, 240, 0.25);
  font-family: var(--font-display);
  font-weight: 700;
  letter-spacing: 0.04em;
}

.brand-name {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.brand-sub {
  margin-top: 2px;
  font-size: 11px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(238, 244, 245, 0.5);
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  color: rgba(238, 244, 245, 0.72);
  text-decoration: none;
  transition: background 0.2s ease, color 0.2s ease, transform 0.2s ease;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.nav-item.active {
  background: rgba(15, 110, 120, 0.28);
  color: #fff;
}

.nav-bar {
  width: 3px;
  height: 16px;
  border-radius: 999px;
  background: transparent;
  transition: background 0.2s ease;
}

.nav-item.active .nav-bar {
  background: #7fd0d7;
}

.nav-label {
  font-size: 14px;
  font-weight: 500;
}

.aside-foot {
  padding: 14px 12px 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.aside-foot p {
  margin: 0;
  font-size: 12px;
  color: rgba(238, 244, 245, 0.4);
}

.main {
  min-width: 0;
}

.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  padding: 22px 28px 8px;
}

.crumb {
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--muted);
}

.topbar h1 {
  font-size: 28px;
  font-weight: 700;
}

.user {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px 8px 8px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(20, 32, 43, 0.06);
  backdrop-filter: blur(8px);
}

.ai-chip {
  border: 1px solid rgba(15, 110, 120, 0.22);
  background: rgba(15, 110, 120, 0.08);
  color: #0f6e78;
  border-radius: 999px;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ai-chip.running {
  background: rgba(196, 92, 38, 0.1);
  border-color: rgba(196, 92, 38, 0.25);
  color: #a14a1f;
}

.ai-chip .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: var(--teal-soft);
  color: var(--teal);
  font-weight: 700;
}

.user-meta {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.user-meta strong {
  font-size: 13px;
}

.user-meta span {
  font-size: 12px;
  color: var(--muted);
}

.logout {
  margin-left: 4px;
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 13px;
  padding: 6px 8px;
  border-radius: 8px;
}

.logout:hover {
  color: var(--danger);
  background: #f8eceb;
}

.content {
  padding: 12px 28px 32px;
}

@media (max-width: 960px) {
  .shell {
    grid-template-columns: 1fr;
  }

  .aside {
    position: relative;
    height: auto;
  }

  .nav {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .topbar {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
