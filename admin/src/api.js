import axios from 'axios';
import { friendlyApiError } from './utils/errors';
import { shouldSkipGlobalLoading, trackGlobalLoading } from './utils/globalLoading';

const api = axios.create({
  // 页面与接口同在 frontier-api；本地 vite 代理 /api
  baseURL: '/api',
  timeout: 15000,
});

let redirectingAuth = false;
let sessionCache = null;
let sessionCacheAt = 0;

function isOnLoginPage() {
  if (typeof window === 'undefined') return false;
  return String(window.location.pathname || '').includes('/login');
}

function goLoginPage() {
  if (typeof window === 'undefined') return;
  window.location.href = '/login';
}

function clearAdminSession() {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_member');
  sessionCache = null;
  sessionCacheAt = 0;
}

/** 登录成功后写入内存缓存，避免沿用上一账号的 sessionCache */
function seedAdminSession(member) {
  if (member && (member.isAdmin || member.isSuperAdmin)) {
    sessionCache = member;
    sessionCacheAt = Date.now();
  } else {
    sessionCache = null;
    sessionCacheAt = 0;
  }
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (!shouldSkipGlobalLoading(config)) {
    config.__globalLoading = true;
    trackGlobalLoading(1);
  }
  return config;
});

function endGlobalLoading(config) {
  if (config?.__globalLoading) trackGlobalLoading(-1);
}

api.interceptors.response.use(
  (res) => {
    endGlobalLoading(res.config);
    return res.data;
  },
  (err) => {
    endGlobalLoading(err.config);
    const status = err.response?.status;
    const msg = friendlyApiError(err);
    const silent = Boolean(err.config?.silentAuth);
    const isLoginReq = String(err.config?.url || '').includes('/auth/admin-login');

    if (status === 401 && !isLoginReq) {
      clearAdminSession();
      if (!silent && !isOnLoginPage()) {
        if (!redirectingAuth) {
          redirectingAuth = true;
          goLoginPage();
        }
      }
    }
    const wrapped = new Error(msg);
    wrapped.status = status;
    return Promise.reject(wrapped);
  }
);

export async function ensureAdminSession() {
  const token = localStorage.getItem('admin_token');
  if (!token) return null;

  // 优先用本地会员信息，避免每次切路由都打 /auth/me
  if (sessionCache && Date.now() - sessionCacheAt < 5 * 60 * 1000) {
    return sessionCache;
  }

  try {
    const cached = JSON.parse(localStorage.getItem('admin_member') || 'null');
    // 内存未命中时用 localStorage 立刻放行，后台静默续期
    if (cached && (cached.isAdmin || cached.isSuperAdmin)) {
      sessionCache = cached;
      sessionCacheAt = Date.now();
      api
        .get('/auth/me', { silentAuth: true, skipGlobalLoading: true })
        .then((res) => {
          if (res?.member && (res.member.isAdmin || res.member.isSuperAdmin)) {
            localStorage.setItem('admin_member', JSON.stringify(res.member));
            sessionCache = res.member;
            sessionCacheAt = Date.now();
          }
        })
        .catch(() => {});
      return cached;
    }
  } catch {
    // ignore
  }

  try {
    const res = await api.get('/auth/me', { silentAuth: true, skipGlobalLoading: true });
    if (res?.member && (res.member.isAdmin || res.member.isSuperAdmin)) {
      localStorage.setItem('admin_member', JSON.stringify(res.member));
      sessionCache = res.member;
      sessionCacheAt = Date.now();
      return res.member;
    }
    clearAdminSession();
    return null;
  } catch {
    clearAdminSession();
    return null;
  }
}

export { clearAdminSession, seedAdminSession, goLoginPage, isOnLoginPage };
export default api;
