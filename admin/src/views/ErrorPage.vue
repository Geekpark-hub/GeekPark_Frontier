<template>
  <div class="err-page">
    <div class="err-card">
      <div class="mark">FS</div>
      <p class="code">{{ code }}</p>
      <h1>{{ title }}</h1>
      <p class="desc">{{ description }}</p>
      <div class="actions">
        <el-button type="primary" @click="goHome">返回首页</el-button>
        <el-button @click="goBack">返回上一页</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { firstAllowedPath } from '../menus';

const props = defineProps({
  kind: { type: String, default: '' }, // '404' | '500'
});

const route = useRoute();
const router = useRouter();

const code = computed(() => props.kind || String(route.meta?.errorCode || '404'));

const title = computed(() => {
  if (code.value === '500') return '服务暂时不可用';
  return '页面不存在';
});

const description = computed(() => {
  if (code.value === '500') {
    return '系统开小差了，请稍后再试。若持续出现，请联系前沿社运营。';
  }
  return '你访问的地址不存在，或没有权限查看。';
});

function goHome() {
  try {
    const member = JSON.parse(localStorage.getItem('admin_member') || 'null');
    if (member) {
      router.replace(firstAllowedPath(member));
      return;
    }
  } catch {
    /* ignore */
  }
  router.replace('/login');
}

function goBack() {
  if (window.history.length > 1) router.back();
  else goHome();
}
</script>

<style scoped>
.err-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 40px 24px;
  background:
    radial-gradient(circle at 80% 10%, rgba(15, 110, 120, 0.08), transparent 30%),
    linear-gradient(180deg, #f5f7f9, #eef1f4);
}

.err-card {
  width: min(440px, 100%);
  text-align: center;
}

.mark {
  width: 48px;
  height: 48px;
  margin: 0 auto 20px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #eef4f5;
  background: linear-gradient(145deg, #1a6f78, #123842);
}

.code {
  margin: 0;
  font-size: 56px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.04em;
  color: #1a6f78;
}

h1 {
  margin: 12px 0 8px;
  font-size: 24px;
  font-weight: 700;
  color: #15202b;
}

.desc {
  margin: 0 0 28px;
  font-size: 14px;
  line-height: 1.6;
  color: #6d7883;
}

.actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}
</style>
