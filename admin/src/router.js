import { createRouter, createWebHistory } from 'vue-router';
import { ensureAdminSession } from './api';
import { ADMIN_MENUS, canAccessMenu, firstAllowedPath } from './menus';

const pathToMenu = Object.fromEntries(ADMIN_MENUS.map((m) => [m.path, m.key]));

const router = createRouter({
  // 页面由 frontier-api 同源托管；静态资源可走 CDN（vite base）
  history: createWebHistory('/'),
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/Login.vue') },
    {
      path: '/404',
      name: 'error-404',
      component: () => import('./views/ErrorPage.vue'),
      meta: { errorCode: '404', public: true },
    },
    {
      path: '/500',
      name: 'error-500',
      component: () => import('./views/ErrorPage.vue'),
      meta: { errorCode: '500', public: true },
    },
    {
      path: '/',
      name: 'layout',
      component: () => import('./views/Layout.vue'),
      redirect: () => {
        try {
          const member = JSON.parse(localStorage.getItem('admin_member') || 'null');
          if (!member) return '/login';
          return firstAllowedPath(member);
        } catch {
          return '/login';
        }
      },
      children: [
        { path: 'members', name: 'members', component: () => import('./views/Members.vue'), meta: { menu: 'members' } },
        { path: 'wx-entries', name: 'wx-entries', component: () => import('./views/WxEntries.vue'), meta: { menu: 'wx-entries' } },
        { path: 'users', name: 'users', component: () => import('./views/Users.vue'), meta: { menu: 'users' } },
        { path: 'admins', redirect: '/users' },
        { path: 'feed', name: 'feed', component: () => import('./views/Feed.vue'), meta: { menu: 'feed' } },
        { path: 'briefs', name: 'briefs', component: () => import('./views/Briefs.vue'), meta: { menu: 'briefs' } },
        { path: 'polls', name: 'polls', component: () => import('./views/Polls.vue'), meta: { menu: 'polls' } },
        { path: 'events', name: 'events', component: () => import('./views/Events.vue'), meta: { menu: 'events' } },
        { path: 'requests', name: 'requests', component: () => import('./views/Requests.vue'), meta: { menu: 'requests' } },
        { path: 'analytics', name: 'analytics', component: () => import('./views/Analytics.vue'), meta: { menu: 'analytics' } },
        { path: 'notify', name: 'notify', component: () => import('./views/NotifyLogs.vue'), meta: { menu: 'notify' } },
        { path: 'audit', name: 'audit', component: () => import('./views/AuditLogs.vue'), meta: { menu: 'audit' } },
        { path: 'ai', name: 'ai', component: () => import('./views/AiJobs.vue'), meta: { menu: 'ai' } },
        { path: 'sources', name: 'sources', component: () => import('./views/Sources.vue'), meta: { menu: 'sources' } },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('./views/ErrorPage.vue'),
      meta: { errorCode: '404', public: true },
    },
  ],
});

router.beforeEach(async (to) => {
  if (to.meta?.public) return true;

  if (to.path === '/login') {
    const member = await ensureAdminSession();
    if (member) return firstAllowedPath(member);
    return true;
  }

  const member = await ensureAdminSession();
  if (!member) return '/login';

  const menuKey = to.meta?.menu || pathToMenu[to.path];
  if (menuKey && !canAccessMenu(member, menuKey)) {
    return firstAllowedPath(member);
  }
  return true;
});

export default router;
