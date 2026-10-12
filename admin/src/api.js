import axios from 'axios';
import { friendlyApiError } from './utils/errors';

const api = axios.create({
  baseURL: '',
  timeout: 15000,
});

let redirectingAuth = false;
let sessionCache = null;
let sessionCacheAt = 0;

function clearAdminSession() {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_member');
  sessionCache = null;
  sessionCacheAt = 0;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const status = err.response?.status;
    const msg = friendlyApiError(err);
    const silent = Boolean(err.config?.silentAuth);
    const isLoginReq = String(err.config?.url || '').includes('/auth/admin-login');

    if (status === 401 && !isLoginReq) {
      clearAdminSession();
      if (!silent && typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
        if (!redirectingAuth) {
          redirectingAuth = true;
          window.location.href = '/login';
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

  if (sessionCache && Date.now() - sessionCacheAt < 15000) {
    return sessionCache;
  }

  try {
    const res = await api.get('/auth/me', { silentAuth: true });
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

export { clearAdminSession };
export default api;
