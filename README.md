# 前沿社会员小程序 MVP

会员专属微信小程序 + 自建 API + Web 管理后台。

## 目录结构

```
/
├── server/        # Node.js + Express + Prisma (SQLite)
├── miniprogram/   # 微信原生小程序
├── admin/         # Vue 3 + Element Plus 管理后台
└── README.md
```

## 功能范围

### 已完成（P0 + 基础自动化）

- 手机号优先的会员门禁（微信授权 / mock）
- 超级管理员 / 管理员 / 会员角色
- 前沿动态 Feed（折叠查看更多、原文链接）
- 投票（Feed 入口、一人一票、可选公开投票人）
- 活动展示与报名（含封面）
- 会员需求提交与后台处理
- Web 后台：会员 / 动态 / 投票 / 活动 / 需求 / AI与任务
- 定时维护：过期投票自动结束、会员到期自动过期、到期提醒占位
- AI 动态抓取流水线（搜索 → LLM 整理 → 待审核；默认不自动发布）

### 未完成（后续）

- AI 智能资源匹配（P2）
- 微信订阅消息正式上线（需模板 ID + 用户授权）
- 生产环境 MySQL/PG、域名与合法域名配置

## 1. 启动后端

```bash
cd server
npm install
npx prisma db push
npm run seed
npm run dev
```

API：`http://localhost:3000`

### Seed 测试账号

| 角色 | 手机号 | 说明 |
|------|--------|------|
| 超级管理员 | `17611294568` | 根超管，不可删除 |
| 普通管理员 | `13800000009` | 可管理内容，不可赋权 |
| 会员 | `13800000001` | 张三 / 星河智能 |
| 会员 | `13800000002` | 李四 / 深蓝机器人 |
| 会员 | `13800000003` | 张鹏 / 极客公园 CEO |

### AI / 搜索 Key（稍后补）

编辑 `server/.env`：

```env
# 搜索（Tavily 或 Serper 二选一）
SEARCH_PROVIDER=tavily
TAVILY_API_KEY=你的key
# 或
# SEARCH_PROVIDER=serper
# SERPER_API_KEY=你的key

# 大模型（OpenAI 兼容）
LLM_PROVIDER=openai
LLM_API_KEY=你的key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

未配置时自动走 **mock**，后台「运行 AI 抓取」仍可生成待审样例。

### 冒烟测试

```bash
cd server
npm run smoke
```

默认连续跑 3 轮：health、维护任务、AI 抓取、待审列表、会员 Feed。

## 2. 启动管理后台

```bash
cd admin
npm install
npm run dev
```

打开 `http://localhost:5173`，用 `17611294568` 登录。  
动态页可筛选「待审核 / 自动」，或进入「AI 与任务」手动触发。

## 3. 打开小程序

1. 微信开发者工具导入 `miniprogram/`
2. AppID 测试号见 `project.config.json`
3. 详情 → 本地设置：勾选不校验合法域名
4. `app.js` 中本机调试用 `http://127.0.0.1:3000`

## 常用 API

- `POST /auth/bind-phone`（微信手机号授权后绑定）
- `POST /auth/wechat-login` / `POST /auth/mock-login` / `POST /auth/admin-login`
- `GET /feed` / `GET /polls/active` / `GET /events` / `POST /requests`
- `POST /admin/ai/run-feed` / `POST /admin/jobs/maintenance` / `GET /admin/ai/status`

## 数据库

默认 SQLite：`server/prisma/dev.db`。生产可改为 `mysql` / `postgresql`。
