import { createRouter, createWebHistory } from 'vue-router';
import Login from './views/Login.vue';
import Layout from './views/Layout.vue';
import Members from './views/Members.vue';
import Users from './views/Users.vue';
import Feed from './views/Feed.vue';
import Polls from './views/Polls.vue';
import Events from './views/Events.vue';
import Requests from './views/Requests.vue';
import Analytics from './views/Analytics.vue';
import AiJobs from './views/AiJobs.vue';
import ErrorPage from './views/ErrorPage.vue';
import { ensureAdminSession } from './api';
import { ADMIN_MENUS, canAccessMenu, firstAllowedPath } from './menus';

const pathToMenu = Object.fromEntries(ADMIN_MENUS.map((m) => [m.path, m.key]));

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: Login },
    { path: '/404', component: ErrorPage, meta: { errorCode: '404', public: true } },
    { path: '/500', component: ErrorPage, meta: { errorCode: '500', public: true } },
    {
      path: '/',
      component: Layout,
      redirect: () => {
        try {
          const member = JSON.parse(localStorage.getItem('admin_member') || 'null');
          return firstAllowedPath(member);
        } catch {
          return '/members';
        }
      },
      children: [
        { path: 'members', component: Members, meta: { menu: 'members' } },
        { path: 'users', component: Users, meta: { menu: 'users' } },
        { path: 'admins', redirect: '/users' },
        { path: 'feed', component: Feed, meta: { menu: 'feed' } },
        { path: 'polls', component: Polls, meta: { menu: 'polls' } },
        { path: 'events', component: Events, meta: { menu: 'events' } },
        { path: 'requests', component: Requests, meta: { menu: 'requests' } },
        { path: 'analytics', component: Analytics, meta: { menu: 'analytics' } },
        { path: 'ai', component: AiJobs, meta: { menu: 'ai' } },
      ],
    },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: ErrorPage, meta: { errorCode: '404', public: true } },
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
