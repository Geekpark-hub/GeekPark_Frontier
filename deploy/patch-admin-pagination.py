# -*- coding: utf-8 -*-
"""Patch admin list views for pageSize=10 pagination."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'admin' / 'src' / 'views'


def must_replace(text, old, new, label):
    if old not in text:
        raise SystemExit(f'[{label}] pattern not found:\n{old[:120]}...')
    return text.replace(old, new, 1)


def insert_after_first_table(text, pager_html, label):
    needle = '    </el-table>\n'
    idx = text.find(needle)
    if idx < 0:
        raise SystemExit(f'[{label}] table end not found')
    insert_at = idx + len(needle)
    if '<ListPager' in text[insert_at:insert_at + 80]:
        return text
    return text[:insert_at] + pager_html + text[insert_at:]


PAGER = '    <ListPager v-model:page="page" :page-size="pageSize" :total="total" @update:page="onPage" />\n'


def ensure_imports(text, label):
    if "from '../components/ListPager.vue'" in text:
        return text
    old = "import api from '../api';\n"
    new = (
        "import api from '../api';\n"
        "import ListPager from '../components/ListPager.vue';\n"
        "import { DEFAULT_PAGE_SIZE, pageParams } from '../utils/listPage';\n"
    )
    return must_replace(text, old, new, f'{label} imports')


def ensure_page_state(text, after_list_line, label):
    if 'const page = ref(1)' in text:
        return text
    return must_replace(
        text,
        after_list_line,
        after_list_line
        + "\nconst page = ref(1);\nconst pageSize = DEFAULT_PAGE_SIZE;\nconst total = ref(0);",
        f'{label} state',
    )


def ensure_on_page(text, label):
    if 'function onPage(' in text:
        return text
    # insert before onMounted
    marker = 'onMounted('
    idx = text.find(marker)
    if idx < 0:
        raise SystemExit(f'[{label}] onMounted not found')
    block = (
        "function onPage(p) {\n"
        "  page.value = p;\n"
        "  load();\n"
        "}\n\n"
    )
    return text[:idx] + block + text[idx:]


def patch_members():
    p = ROOT / 'Members.vue'
    t = p.read_text(encoding='utf-8')
    t = insert_after_first_table(t, PAGER, 'Members')
    t = ensure_imports(t, 'Members')
    t = ensure_page_state(t, 'const list = ref([]);', 'Members')
    t = must_replace(
        t,
        "  const res = await api.get('/admin/members', { params: { role: 'member' } });\n"
        "  list.value = res.members || [];\n"
        "  me.isSuperAdmin = Boolean(res.me?.isSuperAdmin);\n",
        "  const res = await api.get('/admin/members', { params: { role: 'member', ...pageParams(page.value, pageSize) } });\n"
        "  list.value = res.members || [];\n"
        "  total.value = res.total || 0;\n"
        "  me.isSuperAdmin = Boolean(res.me?.isSuperAdmin);\n",
        'Members load',
    )
    t = ensure_on_page(t, 'Members')
    if 'list.value.length <= 1 && page.value > 1' not in t:
        t = t.replace(
            "    ElMessage.success('已删除');\n    await load();",
            "    ElMessage.success('已删除');\n"
            "    if (list.value.length <= 1 && page.value > 1) page.value -= 1;\n"
            "    await load();",
            1,
        )
    p.write_text(t, encoding='utf-8')
    print('Members ok')


def patch_users():
    p = ROOT / 'Users.vue'
    t = p.read_text(encoding='utf-8')
    t = insert_after_first_table(t, PAGER, 'Users')
    t = ensure_imports(t, 'Users')
    t = ensure_page_state(t, 'const list = ref([]);', 'Users')
    t = must_replace(
        t,
        "  const res = await api.get('/admin/members', { params: { role: 'admin' } });\n"
        "  list.value = res.members || [];\n"
        "  me.isSuperAdmin = Boolean(res.me?.isSuperAdmin);\n",
        "  const res = await api.get('/admin/members', { params: { role: 'admin', ...pageParams(page.value, pageSize) } });\n"
        "  list.value = res.members || [];\n"
        "  total.value = res.total || 0;\n"
        "  me.isSuperAdmin = Boolean(res.me?.isSuperAdmin);\n",
        'Users load',
    )
    t = ensure_on_page(t, 'Users')
    if 'list.value.length <= 1 && page.value > 1' not in t:
        t = t.replace(
            "    ElMessage.success('已删除');\n    await load();",
            "    ElMessage.success('已删除');\n"
            "    if (list.value.length <= 1 && page.value > 1) page.value -= 1;\n"
            "    await load();",
            1,
        )
    p.write_text(t, encoding='utf-8')
    print('Users ok')


def patch_feed():
    p = ROOT / 'Feed.vue'
    t = p.read_text(encoding='utf-8')
    t = insert_after_first_table(t, PAGER, 'Feed')
    t = ensure_imports(t, 'Feed')
    t = ensure_page_state(t, 'const list = ref([]);', 'Feed')
    t = must_replace(
        t,
        "async function load() {\n"
        "  const params = {};\n"
        "  if (status.value) params.status = status.value;\n"
        "  if (sourceType.value) params.sourceType = sourceType.value;\n"
        "  const res = await api.get('/admin/feed', { params });\n"
        "  list.value = res.posts;\n"
        "  selectedIds.value = [];\n"
        "}\n",
        "async function load() {\n"
        "  const params = { ...pageParams(page.value, pageSize) };\n"
        "  if (status.value) params.status = status.value;\n"
        "  if (sourceType.value) params.sourceType = sourceType.value;\n"
        "  const res = await api.get('/admin/feed', { params });\n"
        "  list.value = res.posts || [];\n"
        "  total.value = res.total || 0;\n"
        "  selectedIds.value = [];\n"
        "}\n\n"
        "function resetAndLoad() {\n"
        "  page.value = 1;\n"
        "  load();\n"
        "}\n",
        'Feed load',
    )
    t = t.replace('@change="load"', '@change="resetAndLoad"', 2)
    t = ensure_on_page(t, 'Feed')
    # batch delete / single delete adjust page
    t = t.replace(
        "    ElMessage.success(`已删除 ${res.deleted ?? ids.length} 条`);\n    await load();",
        "    ElMessage.success(`已删除 ${res.deleted ?? ids.length} 条`);\n"
        "    if (list.value.length <= ids.length && page.value > 1) page.value -= 1;\n"
        "    await load();",
        1,
    )
    t = t.replace(
        "    ElMessage.success('已删除');\n    await load();\n  } catch (e) {\n    if (e === 'cancel' || e === 'close') return;\n    ElMessage.error(e?.message || '删除失败');",
        "    ElMessage.success('已删除');\n"
        "    if (list.value.length <= 1 && page.value > 1) page.value -= 1;\n"
        "    await load();\n  } catch (e) {\n    if (e === 'cancel' || e === 'close') return;\n    ElMessage.error(e?.message || '删除失败');",
        1,
    )
    p.write_text(t, encoding='utf-8')
    print('Feed ok')


def patch_polls():
    p = ROOT / 'Polls.vue'
    t = p.read_text(encoding='utf-8')
    t = insert_after_first_table(t, PAGER, 'Polls')
    t = ensure_imports(t, 'Polls')
    t = ensure_page_state(t, 'const list = ref([]);', 'Polls')
    t = must_replace(
        t,
        "async function load() {\n"
        "  const res = await api.get('/admin/polls');\n"
        "  const rows = res.polls || [];\n"
        "  list.value = status.value ? rows.filter((p) => p.status === status.value) : rows;\n"
        "}\n",
        "async function load() {\n"
        "  const params = { ...pageParams(page.value, pageSize) };\n"
        "  if (status.value) params.status = status.value;\n"
        "  const res = await api.get('/admin/polls', { params });\n"
        "  list.value = res.polls || [];\n"
        "  total.value = res.total || 0;\n"
        "}\n\n"
        "function resetAndLoad() {\n"
        "  page.value = 1;\n"
        "  load();\n"
        "}\n",
        'Polls load',
    )
    t = t.replace('@change="load"', '@change="resetAndLoad"', 1)
    t = ensure_on_page(t, 'Polls')
    p.write_text(t, encoding='utf-8')
    print('Polls ok')


def patch_events():
    p = ROOT / 'Events.vue'
    t = p.read_text(encoding='utf-8')
    t = insert_after_first_table(t, PAGER, 'Events')
    # registrations pager inside dialog
    if 'regPage' not in t:
        t = must_replace(
            t,
            "      </el-table>\n    </el-dialog>\n  </div>\n</template>",
            "      </el-table>\n"
            "      <ListPager v-model:page=\"regPage\" :page-size=\"pageSize\" :total=\"regTotal\" @update:page=\"onRegPage\" />\n"
            "    </el-dialog>\n  </div>\n</template>",
            'Events regs pager',
        )
    t = ensure_imports(t, 'Events')
    t = ensure_page_state(t, 'const list = ref([]);', 'Events')
    if 'const regPage' not in t:
        t = must_replace(
            t,
            "const regs = ref([]);\n",
            "const regs = ref([]);\nconst regPage = ref(1);\nconst regTotal = ref(0);\nconst regEventId = ref('');\n",
            'Events reg state',
        )
    t = must_replace(
        t,
        "async function load() {\n"
        "  const res = await api.get('/admin/events');\n"
        "  const rows = res.events || [];\n"
        "  list.value = status.value ? rows.filter((e) => e.status === status.value) : rows;\n"
        "}\n",
        "async function load() {\n"
        "  const params = { ...pageParams(page.value, pageSize) };\n"
        "  if (status.value) params.status = status.value;\n"
        "  const res = await api.get('/admin/events', { params });\n"
        "  list.value = res.events || [];\n"
        "  total.value = res.total || 0;\n"
        "}\n\n"
        "function resetAndLoad() {\n"
        "  page.value = 1;\n"
        "  load();\n"
        "}\n",
        'Events load',
    )
    t = t.replace('@change="load"', '@change="resetAndLoad"', 1)
    t = must_replace(
        t,
        "  const res = await api.get(`/admin/events/${row.id}/registrations`);\n"
        "  regs.value = res.registrations;\n"
        "  regVisible.value = true;\n",
        "  regEventId.value = row.id;\n"
        "  regPage.value = 1;\n"
        "  await loadRegs();\n"
        "  regVisible.value = true;\n",
        'Events open regs',
    )
    if 'async function loadRegs' not in t:
        t = must_replace(
            t,
            "async function updateReg(row, status) {\n",
            "async function loadRegs() {\n"
            "  if (!regEventId.value) return;\n"
            "  const res = await api.get(`/admin/events/${regEventId.value}/registrations`, {\n"
            "    params: pageParams(regPage.value, pageSize),\n"
            "  });\n"
            "  regs.value = res.registrations || [];\n"
            "  regTotal.value = res.total || 0;\n"
            "}\n\n"
            "function onRegPage(p) {\n"
            "  regPage.value = p;\n"
            "  loadRegs();\n"
            "}\n\n"
            "async function updateReg(row, status) {\n",
            'Events loadRegs',
        )
    t = ensure_on_page(t, 'Events')
    p.write_text(t, encoding='utf-8')
    print('Events ok')


def patch_requests():
    p = ROOT / 'Requests.vue'
    t = p.read_text(encoding='utf-8')
    t = insert_after_first_table(t, PAGER, 'Requests')
    t = ensure_imports(t, 'Requests')
    t = ensure_page_state(t, 'const list = ref([]);', 'Requests')
    t = must_replace(
        t,
        "async function load() {\n"
        "  const res = await api.get('/admin/requests');\n"
        "  const rows = res.requests || [];\n"
        "  list.value = status.value ? rows.filter((r) => r.status === status.value) : rows;\n"
        "}\n",
        "async function load() {\n"
        "  const params = { ...pageParams(page.value, pageSize) };\n"
        "  if (status.value) params.status = status.value;\n"
        "  const res = await api.get('/admin/requests', { params });\n"
        "  list.value = res.requests || [];\n"
        "  total.value = res.total || 0;\n"
        "}\n\n"
        "function resetAndLoad() {\n"
        "  page.value = 1;\n"
        "  load();\n"
        "}\n",
        'Requests load',
    )
    t = t.replace('@change="load"', '@change="resetAndLoad"', 1)
    t = ensure_on_page(t, 'Requests')
    p.write_text(t, encoding='utf-8')
    print('Requests ok')


def patch_sources():
    p = ROOT / 'Sources.vue'
    t = p.read_text(encoding='utf-8')
    t = insert_after_first_table(t, PAGER, 'Sources')
    t = ensure_imports(t, 'Sources')
    t = ensure_page_state(t, 'const list = ref([]);', 'Sources')
    t = must_replace(
        t,
        "    const res = await api.get('/admin/ai/sources');\n"
        "    list.value = res.sources || [];\n",
        "    const res = await api.get('/admin/ai/sources', { params: pageParams(page.value, pageSize) });\n"
        "    list.value = res.sources || [];\n"
        "    total.value = res.total || 0;\n",
        'Sources load',
    )
    t = ensure_on_page(t, 'Sources')
    p.write_text(t, encoding='utf-8')
    print('Sources ok')


def patch_aijobs():
    p = ROOT / 'AiJobs.vue'
    t = p.read_text(encoding='utf-8')
    # table ends before drawer
    if '<ListPager' not in t:
        t = must_replace(
            t,
            "    </el-table>\n\n    <el-drawer",
            "    </el-table>\n"
            "    <ListPager v-model:page=\"page\" :page-size=\"pageSize\" :total=\"total\" @update:page=\"onPage\" />\n\n"
            "    <el-drawer",
            'AiJobs pager',
        )
    t = ensure_imports(t, 'AiJobs')
    if 'const page = ref(1)' not in t:
        t = must_replace(
            t,
            "const logs = ref([]);\n",
            "const logs = ref([]);\nconst page = ref(1);\nconst pageSize = DEFAULT_PAGE_SIZE;\nconst total = ref(0);\n",
            'AiJobs state',
        )
    t = must_replace(
        t,
        "async function load() {\n"
        "  const res = await api.get('/admin/ai/status');\n"
        "  Object.assign(status, res);\n"
        "  logs.value = res.recentJobs || [];\n"
        "}\n",
        "async function load() {\n"
        "  const res = await api.get('/admin/ai/status', { params: pageParams(page.value, pageSize) });\n"
        "  Object.assign(status, res);\n"
        "  logs.value = res.recentJobs || [];\n"
        "  total.value = res.total || 0;\n"
        "}\n",
        'AiJobs load',
    )
    t = ensure_on_page(t, 'AiJobs')
    p.write_text(t, encoding='utf-8')
    print('AiJobs ok')


def main():
    patch_members()
    patch_users()
    patch_feed()
    patch_polls()
    patch_events()
    patch_requests()
    patch_sources()
    patch_aijobs()
    print('all done')


if __name__ == '__main__':
    main()
