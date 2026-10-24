# EdgeChat 生产部署与持续迭代指南 (`deploy.md`)

> **文档状态**：已实测校准  
> **更新时间**：2026-10-24  
> **线上验证结果**：HTTP 200 OK，Cloudflare Worker 正常运行  

---

## 1. 线上部署概览与当前拓扑

| 项目 | 配置值 / 说明 |
| :--- | :--- |
| **Worker 服务名称** | `cfchat` |
| **生效生产域名** | `https://link.chf5762.cloudns.org` |
| **Workers.dev 备用域名** | `https://cfchat.75957832.workers.dev` |
| **允许的跨域/通信来源 (SITE_ORIGINS)** | `https://link.chf5762.cloudns.org,https://chat.chf5762.cloudns.org,https://cfchat.75957832.workers.dev` |
| **代码仓库** | `https://github.com/chf5762-sudo/Edgechat-cloudfalre-` |
| **主部署分支** | `master` |

### 链路可用性实测记录
```bash
# 线上主域名 HTTP 状态探测
curl -I https://link.chf5762.cloudns.org
# 返回: HTTP/1.1 200 OK, Server: cloudflare, Cache-Control: private, no-store

# 后端健康检查探测
curl https://link.chf5762.cloudns.org/api/health
# 返回: {"ok":true}

# 站点信息接口探测
curl https://link.chf5762.cloudns.org/api/site
# 返回: {"site":{"siteName":"Edgechat","siteIconUrl":""}}
```

---

## 2. Cloudflare 资源绑定清单

以下信息提取自 [wrangler.toml](file:///c:/Users/Alex/Desktop/Github%20Project/Edgechat-cloudfalre-/wrangler.toml)，为生产线上运行所绑定的确切实例：

### (1) D1 关系数据库
- **Binding 名称**：`DB`
- **数据库名**：`cfchat-db`
- **Database ID**：`0e556d95-d6a0-4110-b963-082fa34e5d36`

### (2) KV 缓存与会话存储
- **Binding 名称**：`SESSIONS`
- **KV Namespace ID**：`f5464d03ea3649eb83abed344a4f2506`

### (3) R2 对象存储 (文件/音频/附件)
- **Binding 名称**：`FILES`
- **Bucket 名称**：`cfchat-files`

### (4) Durable Objects 实时状态绑定
- `CHANNEL_ROOM` $\rightarrow$ `ChannelRoom`（频道与群聊房间状态机）
- `SCHEDULER` $\rightarrow$ `Scheduler`（定时清理与定时任务）
- `USER_INBOX` $\rightarrow$ `UserInbox`（用户实时收件箱通知）
- `INSTANCE_BRIDGE` $\rightarrow$ `InstanceBridge`（多实例跨域桥接）
- `VOICE_CALL` $\rightarrow$ `VoiceCall`（WebRTC 语音呼叫协调）
- `TELEGRAM_NOTIFICATIONS` $\rightarrow$ `TelegramNotifications`（Telegram 消息与通知）

---

## 3. 账号体系与管理员设置

### 管理员账号说明
- **系统管理员用户名**：默认定义于 `wrangler.toml` 中的 `ADMIN_USERNAMES = "admin"`。
- **登录凭证生成途径**：
  1. **CI 自动注入**：如果在 GitHub Repository Secrets 中配置了 `EDGECHAT_ADMIN_USERNAME` 与 `EDGECHAT_ADMIN_PASSWORD`，CI 在执行迁移部署时会自动通过 `.github/scripts/generate-admin-bootstrap-sql.mjs` 写入/重置管理员账密。
  2. **邀请注册模式**：如果没有预设密码，系统首次启动后支持通过初始安装引导或管理员邀请链接（`/api/register-links/:token`）进行首次超管账号初始化。

### GitHub Actions 部署所需 Secrets 清单
在 GitHub 仓库 `Settings -> Secrets and variables -> Actions` 中维护：

| Secret / Variable 名称 | 类别 | 作用说明 |
| :--- | :--- | :--- |
| `CLOUDFLARE_API_TOKEN` | Secret | Cloudflare API 令牌（需具备 Workers、D1、KV、R2 的编辑权限） |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Cloudflare 账号 ID |
| `EDGECHAT_ADMIN_USERNAME` | Secret (可选) | 初始化超管用户名（如 `admin`） |
| `EDGECHAT_ADMIN_PASSWORD` | Secret (可选) | 初始化超管密码 |
| `EDGECHAT_ENCRYPTION_KEYRING` | Secret (重要) | 消息与附件加密密钥环 JSON |
| `MESSAGE_RETENTION_DAYS` | Variable (可选) | 消息保存天数（默认 7 天） |

---

## 4. 产品迭代与持续部署 (CI/CD 流程)

本项目已配置完善的 GitHub Actions 自动部署流水线 [deploy-worker.yml](file:///c:/Users/Alex/Desktop/Github%20Project/Edgechat-cloudfalre-/.github/workflows/deploy-worker.yml)。

### 方式一：Git 自动化部署（推荐）
每次迭代完成并测试通过后，直接提交代码并推送到 `master` 分支：

```bash
# 1. 提交改动
git add .
git commit -m "feat: 迭代功能描述"

# 2. 推送至 GitHub 触发自动发布
git push origin master
```
**CI 自动化执行步骤**：
1. 安装依赖并运行单元测试 (`npm test`)
2. 构建前端单页静态资源 (`npm run build`) 输出至 `frontend/dist`
3. 检查 Cloudflare D1 / KV / R2 资源
4. 自动执行增量数据库迁移 (`prepare-d1-migrations.mjs`)
5. 打包 Worker 代码并完成无缝热部署 (`npx wrangler deploy`)

---

### 方式二：本地 CLI 直接部署（应急/手动发布）

如果需要在本地机器直接发布更新至线上 Cloudflare：

```bash
# 1. 登录 Cloudflare（若尚未认证）
npx wrangler login

# 2. 生成本地前端构建文件
npm run build

# 3. 部署 Worker 与前端资源到线上
npx wrangler deploy
```

---

## 5. 本地开发与调试流程

在进入下一步“个人聊天存储”等产品迭代开发时，推荐本地联调环境：

```bash
# 1. 安装项目依赖
npm install

# 2. 启动前端 Vite 实时开发服务（支持热重载）
cd frontend
npm run dev

# 3. 本地启动 Worker 后端模拟（新终端）
# 本地使用 Wrangler 的本地 SQLite 与 Miniflare 进行全套 D1/KV 模拟
npm run dev
```

---

## 6. 核心配置文件速查

- **云函数与绑定定义**：[wrangler.toml](file:///c:/Users/Alex/Desktop/Github%20Project/Edgechat-cloudfalre-/wrangler.toml)
- **数据库初始结构**：[worker/schema.sql](file:///c:/Users/Alex/Desktop/Github%20Project/Edgechat-cloudfalre-/worker/schema.sql)
- **数据库增量迁移**：[worker/migrations/](file:///c:/Users/Alex/Desktop/Github%20Project/Edgechat-cloudfalre-/worker/migrations/)
- **后端路由与业务入口**：[worker/src/index.js](file:///c:/Users/Alex/Desktop/Github%20Project/Edgechat-cloudfalre-/worker/src/index.js)
- **前端源代码**：[frontend/src/](file:///c:/Users/Alex/Desktop/Github%20Project/Edgechat-cloudfalre-/frontend/src/)
