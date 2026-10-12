<template>
  <div class="login-page">
    <section class="hero" aria-label="前沿社">
      <div class="hero-grid"></div>
      <div class="hero-glow"></div>
      <div class="hero-content">
        <p class="eyebrow">MEMBER OPS</p>
        <h1 class="brand">前沿社</h1>
        <p class="tagline">连接会员信息、社区活动与服务需求</p>
      </div>
      <p class="hero-foot">Admin Console</p>
    </section>

    <section class="panel-wrap">
      <div class="form-panel">
        <h2>管理员登录</h2>
        <p class="hint">使用管理员手机号登录。根超管：17611294568</p>

        <el-form class="form" label-position="top" @submit.prevent>
          <el-form-item label="手机号">
            <el-input v-model="phone" size="large" placeholder="17611294568" clearable maxlength="11" />
          </el-form-item>
          <el-button
            class="submit"
            type="primary"
            size="large"
            :loading="loading"
            @click="login"
          >
            进入后台
          </el-button>
        </el-form>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '../api';
import { firstAllowedPath } from '../menus';

const router = useRouter();
const phone = ref('17611294568');
const loading = ref(false);

async function login() {
  loading.value = true;
  try {
    const res = await api.post('/auth/admin-login', {
      phone: phone.value || undefined,
    });
    localStorage.setItem('admin_token', res.token);
    localStorage.setItem('admin_member', JSON.stringify(res.member));
    ElMessage.success('登录成功');
    router.push(firstAllowedPath(res.member));
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  background: #eef1f4;
}

.hero {
  position: relative;
  overflow: hidden;
  color: #f4f7f8;
  background:
    linear-gradient(160deg, rgba(15, 110, 120, 0.35), transparent 45%),
    linear-gradient(180deg, #101820 0%, #1a2834 55%, #14202b 100%);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: clamp(32px, 6vw, 72px);
  animation: fade-in 0.7s ease both;
}

.hero-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(circle at 30% 20%, #000 20%, transparent 70%);
  opacity: 0.7;
}

.hero-glow {
  position: absolute;
  width: 420px;
  height: 420px;
  right: -80px;
  bottom: -120px;
  background: radial-gradient(circle, rgba(15, 110, 120, 0.45), transparent 68%);
  animation: drift 8s ease-in-out infinite alternate;
}

.hero-content {
  position: relative;
  z-index: 1;
  margin-top: 18vh;
}

.eyebrow {
  margin: 0 0 18px;
  font-size: 12px;
  letter-spacing: 0.28em;
  color: rgba(244, 247, 248, 0.62);
}

.brand {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(56px, 8vw, 88px);
  font-weight: 800;
  letter-spacing: 0.12em;
  line-height: 1;
}

.tagline {
  margin: 22px 0 0;
  max-width: 360px;
  font-size: 16px;
  line-height: 1.7;
  color: rgba(244, 247, 248, 0.78);
}

.hero-foot {
  position: relative;
  z-index: 1;
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(244, 247, 248, 0.45);
}

.panel-wrap {
  display: grid;
  place-items: center;
  padding: 40px 24px;
  background:
    radial-gradient(circle at 80% 10%, rgba(15, 110, 120, 0.08), transparent 30%),
    linear-gradient(180deg, #f5f7f9, #eef1f4);
  animation: rise 0.55s ease 0.1s both;
}

.form-panel {
  width: min(420px, 100%);
}

.form-panel h2 {
  font-size: 28px;
  font-weight: 700;
}

.hint {
  margin: 8px 0 28px;
  color: var(--muted);
  font-size: 14px;
}

.form :deep(.el-form-item) {
  margin-bottom: 18px;
}

.form :deep(.el-form-item__label) {
  margin-bottom: 6px !important;
}

.submit {
  width: 100%;
  margin-top: 8px;
  height: 46px;
  font-size: 15px;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes drift {
  from { transform: translateY(0); }
  to { transform: translateY(-18px); }
}

@media (max-width: 900px) {
  .login-page {
    grid-template-columns: 1fr;
  }

  .hero {
    min-height: 38vh;
    padding: 28px 24px;
  }

  .hero-content {
    margin-top: 24px;
  }

  .brand {
    letter-spacing: 0.08em;
  }
}
</style>
