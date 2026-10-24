# Agent 任务看板 PRD

版本 v0.4 · 2026-10-24 · 部署平台：Cloudflare（Workers + D1 + R2）· 对应前端：`agent-task-board.html`（前端 v2）

## 0. 准则与编号

**唯一准则：前端 v2（`agent-task-board.html`）的全部功能必须实现。** PRD、验收测试、前端三者逐项一一对应；冲突时以前端为准。

| 编号 | 含义 | 所在章节 |
| --- | --- | --- |
| U-xx | 页面信息（每一个可见的字段、文案、数据） | §3 |
| B-xx | 页面按钮 / 可点击控件 | §3 |
| S-xx | 静态流转：每个状态 × 每个动作的允许 / 拒绝 | §5.2 |
| D-xx | 动态流转：从发布走到终态的完整流程 | §5.3 |
| P-xx | 三端（HTTP / MCP / CLI）一致 | §7 |
| A-xx | 验收标准 | §10 |

验收测试文件中每个用例标题带编号，并在运行中登记 `cover(编号)`；最后一个用例检查 U / B / S / D / P 全部编号都已覆盖，缺任何一个即不合格。

### 0.1 相对 v0.3 的变化（按前端 v2 同步）

**与 v0.3 冲突、以前端为准的项：**

1. 任务表由 12 列改为 **13 列**，新增「截止」列（U-45）。
2. 恢复并扩展筛选：新增「待我处理」筛选、**搜索框**、**BOT 筛选下拉**（v0.3 曾去掉）。搜索与 BOT 筛选和状态 / 项目筛选叠加（AND）。列表**不分页**，返回数组。
3. 发布人由下拉改为文本「发布人：{当前身份}」，不可选。
4. **验收失败原因必填**（v0.3 为可空）；BOT 失败原因、完成摘要仍可空，默认「未说明原因」/「已完成」。
5. 报告在**详情弹窗**里展示（v0.3 看板不展示），输入框提示为「报告（可选，纯文本）」。
6. 按钮**按当前身份权限显示**（v0.3 对所有访客显示）。
7. 改派后结果文案为 `已改派（原：「{旧BOT}」）`（加了引号）。
8. **时限从「认领」起算**（v0.3 从发布起算）；待领取任务没有截止时间。
9. 状态说明区文案更新（§3.4）。

**新增能力：**

10. 身份区与登录（`/api/me`）、服务端时间校准。
11. 发布时可填「验收标准」；验收失败生成的下一轮任务带入验收标准和全部图片。
12. **图片附件**：发布、提交完成、报告失败、验收、留言均可附图；两步接口 `POST /api/uploads` → `images:[id]`；`GET /api/uploads/:id`。
13. **任务详情弹窗**：时间线（操作人、状态变化）、任务链、留言、复制为新任务、深链接 `#t{id}`。
14. **人工介入**：管理员可对未结束任务**强制关闭**、对进行中任务**延期**；任何非观察者可**留言**；管理员 6 类操作必须填写**原因**。
15. **提醒**：待验收 / 待领取超过 24 小时标橙（仅提醒）；时限不足 10 分钟红字；自动刷新后变化行高亮；标签页标题显示「待我处理」数量。
16. **操作日志**弹窗：按操作人、动作筛选，导出 CSV。
17. 新增接口：`me`、`note`、`extend`、`force-close`、`events`、`uploads`、任务链查询；MCP / CLI 同步。

**已决策（2026-10-24）：** 验收失败原因必填；时限从认领起算；待验收 / 待领取超 24 小时仅标橙提醒；发布前审批暂不做；BOT 管理（增删、重置令牌）留给后端；图片限制 PNG / JPEG / WebP / GIF、单张 ≤5MB、每次 ≤9 张；暂不做图片标注、视频和通用附件。其余待定项已按最佳实践定稿，见 §12；非功能要求见 §9.1；需同步的前端小改动见附录 A；验收测试脚本暂缓，本版不更新。

## 1. 背景与目标

多个 BOT 与人协同工作时，任务靠口头或聊天分派，容易冲突、遗漏、无记录。目标：在线任务看板，任务**提前规划、定向派发**，不做争抢；所有人可见全部任务；BOT 只能执行派给自己的任务；全程自动留痕，可追溯；关键节点可由人介入；现象和报错可以用图片说明。

## 2. 角色与权限

### 2.1 角色

| 角色 | 说明 | 权限 |
| --- | --- | --- |
| 管理员 | 规划发布、人工处理 | 发布任何项目任务；requeue / reassign / reopen / close / force-close / extend；登记项目；留言；查看全部 |
| 执行 BOT | 项目的执行者 | 查看全部；只能对派给自己的任务 claim / complete / fail 和留言 |
| 验收 BOT | 按项目绑定，既是该项目任务的发布人也是验收人 | 发布、验收**本项目**任务；不能验收自己执行的任务；可在本项目任务上留言 |
| 观察者 | 监督 | 只读（不可留言、不可上传图片） |

角色说明文案（U-02）：

- 管理员：`管理员：可发布、改派、再开一轮、关闭、强制关闭、延期、登记项目`
- 验收 BOT：`验收 BOT：可发布并验收本项目任务`
- 执行 BOT：`执行 BOT：只能操作派给自己的任务`
- 观察者：`观察者：只读（可查看全部，不可留言）`

### 2.2 动作权限表（服务端校验）

| 动作 | 谁可以 |
| --- | --- |
| publish | 管理员；本项目验收 BOT |
| claim / complete / fail | 被指派的执行 BOT（管理员也不能代做） |
| accept（pass / fail） | 本项目验收 BOT，且 ≠ 该任务执行者 |
| simulate-timeout（TEST_MODE） / requeue / reassign / reopen / close / force-close / extend | 管理员 |
| note（留言） | 管理员；该任务的指派 BOT；该任务的验收 BOT（其他 BOT 和观察者 403，仍可阅读） |
| uploads（上传图片） | 非观察者 |
| 读取（tasks / stats / projects / events / uploads / me） | 所有已登录身份 |

权限错误一律在服务端校验，不依赖 BOT 自觉。

## 3. 页面规格（逐元素）

### 3.1 页头、身份区与发布区

| 编号 | 元素 | 规则 | 数据 / 接口 |
| --- | --- | --- | --- |
| U-01 | 标题与副标题 | 固定文案：「Agent 任务看板」；副标题「所有任务全员可见；BOT 只能操作派给自己的任务；验收由项目验收 BOT 负责（同时是该项目任务的发布人），验收失败自动发布下一轮，默认最多 3 轮」 | 静态 |
| U-02 | 身份区 | 左：「当前身份」+ 演示环境为身份下拉（管理员 / 9 个 BOT / 观察者），正式环境为令牌输入框 + 「登录」「退出」按钮（令牌仅存会话存储，关闭标签页即失效）；其后为角色说明文案（§2.1）；右侧依次为「操作日志」（所有人）、「项目管理」（仅管理员）、「上次刷新 HH:mm:ss」、「刷新」 | `GET /api/me` → `{name, role, now}` |
| U-10 | 任务内容输入框 | placeholder「任务内容，一句话说清楚」；最长 200 字；必填，去首尾空格后为空则提示「请填写任务内容」且不发请求；服务端同样 400 | `title` |
| U-11 | 项目下拉 | 选项 = **当前身份可发布的项目**：管理员为全部，验收 BOT 为自己负责的，执行 BOT / 观察者为空（此时「发布」置灰）；切换时联动 U-12 / U-16 | `GET /api/projects` |
| U-12 | 指派给下拉 | 选项 = 该项目执行 BOT（按登记顺序）；服务端校验 `assignee ∈ 项目执行 BOT`，否则 400 | `projects[].executors` |
| U-13 | 发布人 | 文本「发布人：{当前身份名}」，不可选择；服务端以令牌身份写 `publisher`，忽略请求体里的 publisher | 令牌身份 |
| U-14 | 时限下拉 | 7 档：30 分钟 / 1 小时（默认）/ 2 / 4 / 8 / 12 / 24 小时，文案「时限 N …」；服务端只接受 30、60、120、240、480、720、1440（分钟），缺省 60，其他值 400 | `deadline_minutes` |
| U-15 | 验收标准输入框 | 多行，可选，最长 1000 字；placeholder「验收标准（可选）：怎样算做对了？可 Ctrl+V 粘贴截图，或拖入图片」；服务端超长 400 | `std` |
| U-16 | 提示行 | 有发布权限：「验收 BOT：「{验收BOT}」（项目验收人，不能验收自己执行的任务）；发布后状态为「待领取」」；无发布权限：「当前身份无发布权限」 | `projects[].acceptor` |
| U-17 | 发布区图片 | 「📎 图片」按钮 + 缩略图托盘；支持粘贴、拖拽、点选；每张缩略图右上角「×」可移除；规则见 §5.7 | `images` |
| B-01 | 「发布」按钮 | 先上传图片再发布；成功：新任务置顶，状态「待领取」，轮次 1，标题 / 验收标准 / 图片清空，筛选重置为「全部」；请求中按钮置灰防重复提交；无发布权限时置灰 | `POST /api/tasks` → 201 |

### 3.2 统计与筛选

| 编号 | 元素 | 规则 | 数据 / 接口 |
| --- | --- | --- | --- |
| U-20 | 统计卡（10 项，顺序固定） | 全部 / 待领取 / 进行中 / 待验收 / 验收成功 / 验收失败 / 未解决 / 需人工处理 / 已关闭 / 超时。「全部」= 总行数；状态卡 = 该状态行数；「超时」= `late=true` 的行数（超时行同时计入「未解决」） | `GET /api/stats` |
| B-12 | 状态筛选按钮 | 按钮顺序：「待我处理（n）」、然后同 U-20 的 10 项；n 为 0 时不显示括号。单选互斥；再次点击当前项取消、回到「全部」；「超时」按 `late` 过滤，「待我处理」按 `mine=1` 过滤（§5.6），其余按状态过滤 | `?status=` / `?late=1` / `?mine=1` |
| B-13 | 项目筛选按钮（每个已登记项目一个） | 与 B-12 互斥（同一时刻只有一个 chip 生效）；再次点击取消 | `?project=` |
| U-21 | 搜索框 | placeholder「搜索任务 / 结果 / #编号」；输入即查；匹配「#编号 标题 结果 汇总」，不区分大小写；与 chip、BOT 筛选叠加（AND） | `?q=` |
| U-22 | BOT 筛选下拉 | 首项「全部 BOT」；其后 9 个 BOT，文案「{名称}」，若该 BOT 作为执行者有待领取 + 进行中任务则追加「（{n} 待办）」；匹配 `assignee` 或 `acceptor` | `?bot=`；`stats.bots` |

### 3.3 任务表（13 列，顺序固定）

U-30 表头：`# / 项目 / 任务 / 指派给 / 验收 BOT / 状态 / 轮次 / 发布人 / 发布时间 / 截止 / 完成时间 / 结果 / 验收 / 操作`（最后一列表头文案为「验收 / 操作」，共 13 列）。

| 编号 | 列 | 显示规则 | 字段 |
| --- | --- | --- | --- |
| U-31 | # | `#` + id，可点击打开详情（B-17 区） | `id` |
| U-32 | 项目 | 项目名 | `project` |
| U-33 | 任务 | 任务内容；若有图片，后加「📎{n}」；若 `summary` 非空，在下方以小号灰字显示自动汇总 | `title` / `imgs` / `summary` |
| U-34 | 指派给 | 圆形头像（BOT 名首字，固定底色）+ 名称 | `assignee`；`bots[].color` |
| U-35 | 验收 BOT | 同上 | `acceptor` |
| U-36 | 状态 | 徽标，8 种文案：待领取 / 进行中 / 待验收 / ✔ 验收成功 / ✖ 验收失败 / 未解决 / ⛔ 需人工处理 / 已关闭 | `status` |
| U-37 | 轮次 | 「第 {round} / {max_rounds} 轮」 | `round` / `max_rounds` |
| U-38 | 发布人 | 文本 | `publisher` |
| U-39 | 发布时间 | 北京时间；当天显示 `HH:mm`，非当天显示 `MM-dd HH:mm`；悬停显示完整时间 | `created_at` |
| U-40 | 完成时间 | 同上；无值显示「-」 | `done_at` |
| U-41 | 结果 | 最多显示 2 行，悬停显示全文；内容见 §5.4 | `result` |
| U-42 | 验收 / 操作 | 按状态和当前身份显示（下表） | `my_actions` / `acc_text` |
| U-43 | 行底色 | `late=true` 整行黄色；否则 `od=true` 整行橙色（黄色优先） | `late` / `od` |
| U-44 | 排序 | 按发布时间倒序，同时刻按 id 倒序（新发布、自动生成的新一轮置顶） | `created_at` / `id` |
| U-45 | 截止 | 待领取：「认领后 {deadline_minutes} 分钟内完成」；进行中：时间 + 下一行「剩 N 分」/「剩 H 小时 M 分」/「已超 N 分」，剩余不足 10 分钟或已超时为红字；其余状态：时间（无值为「-」）；悬停显示完整时间 | `deadline_at` / `deadline_minutes` |
| U-46 | 变化高亮 | 自动刷新后，状态、轮次、指派人、结果任一有变化的行背景闪一下蓝色（约 2.5 秒）；首次加载、手动刷新、切换筛选不闪 | 前端对比 |

**U-42 操作列**（输入框和按钮仅在 `my_actions` 允许时显示；不允许时显示「—」）：

| 状态 | 显示 | 控件 |
| --- | --- | --- |
| 待领取 | 「执行BOT：」；若 `od` 则橙字「待领取超 24 小时」 | B-02「认领」 |
| 进行中 | 「执行BOT / 系统：」 | 输入框（placeholder「结果摘要 / 失败原因」，≤500 字）+ 报告文本框（placeholder「报告（可选，纯文本）」，≤5000 字）+ 图片 + B-03「提交完成」、B-04「报告失败」；B-05「⏱模拟超时」（仅管理员 + TEST_MODE） |
| 待验收 | 「验收BOT：」；若 `od` 则橙字「验收逾期」 | 输入框（placeholder「失败原因（失败时必填）」）+ 图片 + B-06「验收成功」、B-07「验收失败」 |
| 未解决 | 「管理员：」 | B-08「放回待领取」；改派目标下拉（首项「轮换到下一个 BOT」，其后为项目内除当前指派外的执行 BOT）+ B-09「改派」 |
| 需人工处理 | 「管理员审批：{acc_text}」 | B-10「再开一轮」、改派目标下拉 + B-09「改派」、B-11「关闭」 |
| 验收成功 / 验收失败 / 已关闭 | 纯文本 `acc_text` | 无 |

输入框内容分别作为 `complete.result` / `fail.reason` / `accept.note`；报告作为 `complete.report`。验收失败时失败原因为空：提示「请填写验收失败原因」，不发请求；服务端同样 400。

### 3.4 状态说明区

U-50：页面底部「状态说明」固定文案，与前端逐字一致：

1. `状态说明（黄色行 = 超时；橙色行 = 待验收或待领取超过 24 小时，仅提醒）`
2. `待领取：已发布，被指派 BOT 尚未认领　|　进行中：BOT 已认领，时限从认领时开始计算`
3. `待验收：BOT 已提交结果，等待本项目验收 BOT 验收　|　验收成功：终态，结案`
4. `验收失败：自动汇总并发布下一轮任务，轮次 +1，验收标准和图片一并带入下一轮`
5. `未解决：BOT 报告失败，或超时未提交结果（系统自动转入）；管理员可放回待领取或改派`
6. `需人工处理：达到最大轮次（3）仍验收失败，管理员三选一：再开一轮（轮次重置）/ 改派 / 关闭`
7. `已关闭：管理员终止任务（终态）；管理员可在详情里强制关闭未结束的任务，或为进行中的任务延期`
8. `放回待领取 / 改派 / 再开一轮 / 关闭 / 强制关闭 / 延期需填写原因，记入时间线，不可撤销`
9. `图片：Ctrl+V 粘贴、拖拽或点「📎 图片」选择；PNG / JPEG / WebP / GIF，单张 ≤5MB，每次最多 9 张`
10. `时间均为北京时间（UTC+8），非当天显示「月-日 时:分」；页面每 5 秒自动刷新`

### 3.5 任务详情弹窗

打开方式：点击 `#编号`（任务表、任务链、操作日志）；网址 `#t{id}`（深链接，U-81）。关闭窗口后清除 `#t{id}`。

| 编号 | 元素 | 规则 | 数据 / 接口 |
| --- | --- | --- | --- |
| U-60 | 基本信息 | 标题行「#{id} {title}」；状态行「{项目} · {状态} · 第 {round} / {max} 轮」，依次可追加「· 超时」「· 验收逾期 / 待领取超 24 小时」（橙）「· 改派 N 次」（N ≥ 3 时红字并追加「，建议人工介入」）；下方显示指派给 / 验收 / 发布人；再下方发布、领取、截止、完成时间（`YYYY-MM-DD HH:mm:ss`，无值「-」） | `GET /api/tasks/:id` |
| U-61 | 任务链 | 仅当链中任务数 > 1 显示：「任务链：#41 第1轮 ✖ 验收失败 → #42 第2轮 … → #43（当前） 第3轮 …」，每个节点可点击跳转；链 = 根任务及其全部后代，按 id 升序 | `GET /api/tasks?chain={id}` |
| U-62 | 验收标准、图片、结果、汇总、报告 | 「验收标准」有值才显示；任务图片缩略图（64px）可点击放大；「结果：…」；有汇总则显示；「报告」区无内容显示「（无报告）」；所有文本纯文本显示，其中 `http(s)://` 链接可点击（新窗口，`noopener noreferrer`） | `std` / `imgs` / `result` / `summary` / `report` |
| U-63 | 时间线 | 表头「时间 / 操作人 / 动作 / 状态变化 / 说明」；操作人后缀 👤（管理员）/ ⚙（系统）/ 🤖（BOT）；动作为中文名（§6.2）；状态变化为「前 → 后」，前后相同（如留言）只显示当前状态；说明含文本和图片缩略图；按时间升序 | `events` |
| U-64 | 留言区 | 有留言权限者可见（管理员、该任务的指派 BOT、验收 BOT）：文本框（≤1000 字，placeholder「留言（可 Ctrl+V 粘贴截图）」）+ 图片 + B-16「发送留言」；文字和图片至少一项 | `note` |
| U-65 | 操作区 | B-17「复制为新任务」（所有人）；进行中且管理员：延期下拉（延期 30 分钟 / 1 小时 / 2 小时）+ B-15「延期」；管理员且状态为待领取 / 进行中 / 待验收 / 未解决：B-14「强制关闭」 | — |

详情自动刷新：打开期间每 5 秒刷新一次；焦点在弹窗内输入框时不刷新（避免丢失输入）。

### 3.6 其他弹窗

| 编号 | 元素 | 规则 | 数据 / 接口 |
| --- | --- | --- | --- |
| U-70 | 操作日志 | 标题「操作日志」；筛选：「操作人」文本框（包含匹配）、动作下拉（首项「全部动作」，其后 13 种动作中文名）；列：时间 / 任务（`#id`，可点击打开详情）/ 操作人 / 动作 / 说明（含「📎n」）；无记录显示「无记录」；按时间倒序；按钮「导出 CSV」（列：时间,任务,操作人,动作,说明；单元格以 `= + - @` 开头时前置 `'` 防公式注入；演示环境复制到剪贴板并显示文本框，正式环境下载文件） | `GET /api/events` |
| U-71 | 项目管理（仅管理员） | 列出全部项目「{名}：验收 {验收BOT}；执行 {执行BOT、…}」；「登记项目」：项目名（≤40 字）、验收 BOT 下拉（仅验收 BOT）、执行 BOT 多选（仅执行 BOT）；校验见 §6.3 | `GET / POST /api/projects` |
| U-72 | 原因确认弹窗 | B-08 / B-09 / B-10 / B-11 / B-14 / B-15 点击后弹出：标题「{动作}任务 #{id}（不可撤销）」，文本框（≤500 字，placeholder「操作原因（必填，记入时间线）」），为空点确认显示红字「请填写原因」；「取消」放弃；原因随请求以 `why` 发送并写入事件说明 | `why` |
| U-73 | 图片放大 | 点击任意缩略图弹出大图；多张时「←」「→」循环切换并显示「n / 总数」；「关闭」 | — |

### 3.7 页面状态与全局行为

| 编号 | 元素 | 规则 |
| --- | --- | --- |
| U-47 | 加载 / 空 / 错误 | 表格加载中显示「加载中…」；无数据显示「暂无任务」；请求失败在页面顶部红条显示「请求失败：{原因}」并带「重试」；401 显示「请先登录（令牌无效或已过期）」；409 显示「任务刚被他人处理（{原因}），已刷新最新状态」并自动刷新列表和详情；其他操作失败显示「请求失败：{原因}」；匹配任务超过 500 条（响应头 `X-Total-Count`）时，表格上方提示「仅显示最新 500 条，请用筛选缩小范围」 |
| U-80 | 标签页标题 | 「待我处理」数量 n > 0 时为「(n) Agent 任务看板」，否则「Agent 任务看板」 |
| U-81 | 深链接 | `#t{id}` 打开对应任务详情（页面加载、网址变化均生效） |
| U-82 | 自动刷新 | 每 5 秒静默刷新列表、统计、项目；焦点在表格内输入框、或表格行内有尚未提交的图片时暂停；弹窗打开时列表照常刷新 |
| U-83 | 时间校准 | 剩余时间、当天判断一律用「本机时间 + 服务端时差」，时差来自 `/api/me.now` |

### 3.8 按钮 ↔ 动作 ↔ 接口

| 按钮 | 动作名（`actions`） | HTTP | 谁可点（服务端校验） | 请求体 |
| --- | --- | --- | --- | --- |
| B-01 发布 | — | POST /api/tasks | 管理员 / 本项目验收 BOT | `project,title,assignee,deadline_minutes?,std?,images?` |
| B-02 认领 | claim | POST /api/tasks/:id/claim | 被指派 BOT | — |
| B-03 提交完成 | complete | POST /api/tasks/:id/complete | 被指派 BOT | `result?,report?,images?` |
| B-04 报告失败 | fail | POST /api/tasks/:id/fail | 被指派 BOT | `reason?,images?` |
| B-05 ⏱模拟超时 | timeout | POST /api/tasks/:id/simulate-timeout（仅 TEST_MODE） | 管理员 | — |
| B-06 验收成功 | accept_pass | POST /api/tasks/:id/accept | 本项目验收 BOT，且 ≠ 执行者 | `{result:"pass",images?}` |
| B-07 验收失败 | accept_fail | 同上 | 同上 | `{result:"fail",note,images?}`，note 必填 |
| B-08 放回待领取 | requeue | POST /api/tasks/:id/requeue | 管理员 | `{why}` |
| B-09 改派 | reassign | POST /api/tasks/:id/reassign | 管理员 | `{to?,why}` |
| B-10 再开一轮 | reopen | POST /api/tasks/:id/reopen | 管理员 | `{why}` |
| B-11 关闭 | close | POST /api/tasks/:id/close | 管理员 | `{why}` |
| B-12 状态筛选 | — | GET /api/tasks?status / late / mine | 所有人 | — |
| B-13 项目筛选 | — | GET /api/tasks?project= | 所有人 | — |
| B-14 强制关闭 | force_close | POST /api/tasks/:id/force-close | 管理员 | `{why}` |
| B-15 延期 | extend | POST /api/tasks/:id/extend | 管理员 | `{minutes:30\|60\|120,why}` |
| B-16 发送留言 | note | POST /api/tasks/:id/note | 管理员 / 该任务的指派 BOT / 验收 BOT | `{text?,images?}` 至少一项 |
| B-17 复制为新任务 | — | 前端：读取任务后把标题、验收标准填入发布区（项目、指派在可发布范围内才带入），关闭详情并回到页面顶部 | 所有人 | — |
| B-18 图片操作 | — | 「📎 图片」选择、粘贴、拖拽、「×」移除、点击缩略图放大 | 非观察者可添加 | — |
| B-19 操作日志 | — | 打开 / 筛选 / 导出 CSV | 所有人 | — |
| B-20 项目管理 | — | 打开 / 登记项目 | 管理员 | `name,acceptor,executors` |
| B-21 刷新 / 重试 | — | 重新加载列表、统计、项目 | 所有人 | — |
| B-22 登录 / 退出 | — | 正式环境：登录保存令牌并重新加载；退出清除令牌 | 所有人 | — |

所有按钮请求期间置灰，防止重复提交。按钮只对当前身份有权限的操作显示（`my_actions`）；服务端仍逐个校验，无权限返回 403。

## 4. 核心流程

1. 管理员或项目验收 BOT 发布任务，指定执行 BOT 与时限（默认 1 小时），可附验收标准和图片，状态「待领取」。
2. 被指派 BOT 认领 → 「进行中」，时限从此刻开始计算。
3. 时限内 BOT 提交完成（→「待验收」）或报告失败（→「未解决」）；超时未提交，系统自动转「未解决」并标黄。
4. 待验收由项目验收 BOT 验收：成功 → 结案；失败（必填原因，可附图）→ 自动发布下一轮（轮次 +1，带入验收标准和全部图片），第 3 轮仍失败 → 「需人工处理」。
5. 「未解决」：管理员放回待领取或改派。「需人工处理」：管理员再开一轮 / 改派 / 关闭。
6. 任意时刻：管理员可强制关闭未结束的任务、为进行中的任务延期；管理员和 BOT 可留言（可附图）。
7. 所有动作写入时间线，管理员的人工操作必须有原因。

## 5. 状态机

### 5.1 状态

| 状态码 | 页面文案 | 终态 |
| --- | --- | --- |
| todo | 待领取 | 否 |
| doing | 进行中 | 否 |
| review | 待验收 | 否 |
| pass | ✔ 验收成功 | 是 |
| failed | ✖ 验收失败（本轮不合格，已生成下一轮 / 或被「再开一轮」承接） | 是（本行） |
| unsolved | 未解决（`late` 标记区分是否超时） | 否 |
| manual | ⛔ 需人工处理 | 否 |
| closed | 已关闭 | 是 |

「超时」不是独立状态，是 `unsolved` 上的标黄标记（`late=true`）。「逾期」（`od`）是 `todo` / `review` 上的橙色提醒标记，不改变状态。

### 5.2 静态流转表（S-01 ~ S-08）

「✓」= 允许（200），其余一律 **409 INVALID_STATE**，状态不变。`note` 在任何状态都允许，不改变状态；`extend` 允许但状态保持进行中。

| 编号 | 当前状态 \ 动作 | claim | complete | fail | timeout | extend | accept_pass | accept_fail | requeue | reassign | reopen | close | force_close | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S-01 | 待领取 todo | ✓→doing | | | | | | | | | | | ✓→closed | ✓ |
| S-02 | 进行中 doing | | ✓→review | ✓→unsolved | ✓→unsolved(late) | ✓(仍 doing) | | | | | | | ✓→closed | ✓ |
| S-03 | 待验收 review | | | | | | ✓→pass | ✓→failed（+新一轮）/ manual | | | | | ✓→closed | ✓ |
| S-04 | 验收成功 pass | | | | | | | | | | | | | ✓ |
| S-05 | 验收失败 failed | | | | | | | | | | | | | ✓ |
| S-06 | 未解决 unsolved（含超时） | | | | | | | | ✓→todo | ✓→todo | | | ✓→closed | ✓ |
| S-07 | 需人工处理 manual | | | | | | | | | ✓→todo | ✓→failed（+新任务） | ✓→closed | | ✓ |
| S-08 | 已关闭 closed | | | | | | | | | | | | | ✓ |

`accept_fail` 的去向：`round < MAX_ROUNDS` → 原行 failed 并生成下一轮；`round ≥ MAX_ROUNDS` → 原行 manual，不生成新任务。

页面 `actions` 字段 = 上表当前状态对应的允许动作（不含 `note`），顺序固定：

| 状态 | actions |
| --- | --- |
| todo | `[claim, force_close]` |
| doing | `[complete, fail, timeout, extend, force_close]` |
| review | `[accept_pass, accept_fail, force_close]` |
| unsolved | `[requeue, reassign, force_close]` |
| manual | `[reopen, reassign, close]` |
| pass / failed / closed | `[]` |

`my_actions` = `actions` 追加 `note` 后，按 §2.2 过滤出当前身份有权限的子集。`timeout` 仅 TEST_MODE 出现。

**检查顺序：** 401（无 / 无效令牌）→ 404（任务不存在）→ 403（角色或归属不符，观察者的所有写操作）→ 400（参数非法）→ 409（状态不符）。

### 5.3 动态流转（D-01 ~ D-20）

| 编号 | 流程 | 对应前端示例 |
| --- | --- | --- |
| D-01 | 发布 → 认领 → 完成 → 验收成功（第 1 轮结案） | 演示 #13 / #16 |
| D-02 | 第 1、2 轮验收失败，第 3 轮验收成功；每轮自动汇总文本正确 | 任务链 #21 → #22 → #17 |
| D-03 | 连续 3 轮验收失败 → 需人工处理，不再生成新任务 | #17 |
| D-04 | 进行中超过时限 → 系统自动转未解决，标黄，完成时间 = 截止时间 | #15 |
| D-05 | 未解决（BOT 报告失败 / 超时）→ 放回待领取（填原因）→ 重新完成 → 验收成功 | 放回待领取 |
| D-06 | 未解决 → 改派（轮换 / 指定，填原因）→ 新 BOT 完成 → 验收成功；旧 BOT 无权认领 | 改派 |
| D-07 | 需人工处理 → 再开一轮（轮次重置为 1）→ 再失败 3 轮又回需人工处理 | 再开一轮 |
| D-08 | 需人工处理 → 关闭（填原因） | 关闭 |
| D-09 | 需人工处理 → 改派（轮次保持 3）→ 完成 → 验收失败 → 直接回需人工处理 | 改派 |
| D-10 | 改派后验收失败，下一轮默认派给**当前**执行 BOT（沿用上轮 assignee） | — |
| D-11 | 空输入默认值：完成摘要「已完成」、BOT 失败原因「未说明原因」；验收失败原因为空 → 400 | 前端代码 |
| D-12 | 超时转未解决后，BOT 再提交完成 / 失败 → 409；待领取任务无截止时间，放多久都不会自动转状态 | 前端 |
| D-13 | 并发：同一任务两个并发认领只有一个成功；两个并发验收失败只生成一个新任务 | 服务端强制 |
| D-14 | 强制关闭：待领取 / 进行中 / 待验收 / 未解决 各自强制关闭成功（必须有原因，缺原因 400）；进行中被强制关闭后 BOT 再提交 → 409；终态和需人工处理的任务强制关闭 → 409 | 详情「强制关闭」 |
| D-15 | 延期：进行中延期 30 / 60 / 120 分钟，截止时间相应后移，状态不变，超时判定按新截止时间；其他分钟数 400；非进行中 409；非管理员 403 | 详情「延期」 |
| D-16 | 留言：任意状态（含终态）可留言，不改变状态、轮次和结果；空文本且无图 400；观察者和与该任务无关的 BOT 403；留言出现在时间线并标明操作人 | 详情「发送留言」 |
| D-17 | 图片全流程：发布附图 → 完成附图 → 验收失败附图 → 下一轮任务带有「原任务图片 + 验收失败图片」；再开一轮的新任务带有原任务图片；每个事件的图片在时间线可查 | 演示 #22 / #17 |
| D-18 | 时限从认领起算：任务放置很久后认领，截止时间 = 认领时刻 + 时限；发布时 `deadline_at` 为空；放回待领取 / 改派后 `deadline_at` 清空，下次认领重新计时 | 前端 U-45 |
| D-19 | 逾期与待我处理：待验收超过 24 小时、待领取（自 `todo_at` 起）超过 24 小时 → `od=true`，放回待领取 / 改派后重新计时；`mine` 规则按角色（§5.6） | 演示 #14 / #19 |
| D-20 | 任务链：任一节点查询 `chain` 返回根任务及全部后代，按 id 升序；再开一轮产生的新任务也在同一链中 | 详情「任务链」 |

### 5.4 动作写入规则（服务端写入，三端一致）

| 动作 | 状态变化 | 字段写入 |
| --- | --- | --- |
| 发布 | → todo | `round=1`；`result="-"`；`summary=""`；`late=false`；`created_at=now`；`todo_at=now`；`deadline_at=null`；`publisher`=令牌身份；`acceptor`=项目验收 BOT；`std`、`imgs` 取请求值 |
| claim | todo → doing | `claimed_at=now`；`deadline_at=now+deadline_minutes`；`result="处理中"` |
| complete | doing → review | `done_at=now`（忽略客户端传值）；`result`=摘要，空则「已完成」；`report` 可选；事件说明 = `result`；可附图 |
| fail | doing → unsolved | `done_at=now`；`result="未解决：{原因}"`，原因空则「未说明原因」；`late=false`；事件说明 = 原因；可附图 |
| timeout（系统） | doing → unsolved | 条件：`now > deadline_at`；`late=true`；`done_at=deadline_at`；`result="超时未提交结果（系统自动转入）"`；事件操作人「系统」 |
| simulate-timeout（TEST_MODE） | doing → unsolved | `late=true`；`done_at=now`；`result` 同上；事件动作记为 `timeout`，操作人为管理员 |
| accept_pass | review → pass | `accepted_by` / `accepted_at`；事件说明「通过」；可附图 |
| accept_fail（round < max） | review → failed | `accept_note`=原因（必填）；事件说明「失败：{原因}」；**新建下一轮任务**：同项目、同 title，`assignee`=原行 assignee，`publisher`=项目验收 BOT，`round+1`，`status=todo`，`result="-"`，`created_at=accepted_at`，`todo_at=accepted_at`，`deadline_minutes` 沿用，`deadline_at=null`，`std`=原行 std，`imgs`=原行 imgs + 本次验收图片，`parent_id`=原行 id，`summary="自动汇总：原任务 + 上轮结果「{原行result}」+ 失败原因「{原因}」"`；新任务写事件：publish / 操作人「系统」/ 说明「由 #{原id} 自动发布第 {轮次} 轮」 |
| accept_fail（round ≥ max） | review → manual | `accept_note`=原因；不新建任务 |
| requeue | unsolved → todo | `late=false`；`result="-"`；`done_at=null`；`claimed_at=null`；`deadline_at=null`；`todo_at=now`；事件说明 = `原因：{why}` |
| reassign | unsolved / manual → todo | `assignee`=新 BOT；`late=false`；`result="已改派（原：「{旧BOT}」）"`；`done_at=null`；`claimed_at=null`；`deadline_at=null`；`todo_at=now`；`round` 不变；`to` 缺省 = 项目执行 BOT 列表中当前 assignee 的下一个（循环）；`to` 必须是本项目执行 BOT 且 ≠ 当前 assignee，否则 400；事件说明 = `{旧} → {新}；原因：{why}` |
| reopen | manual → failed | 原行 `reopened=true`；新建任务：同项目、同 title，`assignee`=原行 assignee，`publisher`=项目验收 BOT，`round=1`，`status=todo`，`created_at=now`，`todo_at=now`，`std`、`imgs` 沿用原行，`parent_id`=原行 id，`summary="自动汇总：管理员批准再开一轮（轮次重置）+ 上轮结果「{原行result}」"`；事件说明 = `原因：{why}` |
| close | manual → closed | 事件说明 = `原因：{why}` |
| force-close | todo / doing / review / unsolved → closed | 事件动作 `force_close`；说明 = `原因：{why}`；`result`、`late` 不变 |
| extend | doing → doing | `deadline_at += minutes`（30 / 60 / 120）；事件说明 = `+{N} 分钟；原因：{why}` |
| note | 不变 | 仅写事件：说明 = 留言文本，可附图 |

所有动作额外写入 `task_events`（时间、操作人、动作、前后状态、说明、图片），含改派记录；`GET /api/tasks/:id` 返回 `events`。reopen 新任务的「发布人」显示项目验收 BOT（前端行为），真实操作人（管理员）记在原行事件里。

**结果列（U-41）显示值**即 `result` 字段：待领取「-」/ 进行中「处理中」/ 完成后为摘要 / 报告失败「未解决：{原因}」/ 超时「超时未提交结果（系统自动转入）」/ 改派后「已改派（原：「X」）」。

**验收列文本 `acc_text`（服务端生成）：**

| 状态 | acc_text |
| --- | --- |
| todo / doing / unsolved | `-` |
| review | `待验收` |
| pass | `✔ 通过 · 第 {round} 轮结案` |
| failed（自动下一轮） | `✖ 失败：{accept_note}` |
| manual | `✖ 失败：{accept_note}；已达 {max_rounds} 轮上限，等待管理员审批` |
| failed（reopened） | `✖ 失败：{accept_note}；已达 {max_rounds} 轮上限，等待管理员审批；管理员批准再开一轮` |
| closed | `管理员已关闭` |

### 5.5 时间规则

- **时限从认领起算**：认领时 `deadline_at = 认领时刻 + deadline_minutes`；待领取没有截止时间（U-45 显示「认领后 N 分钟内完成」）。
- 仅「进行中」参与超时；「待领取」放多久都不转状态（只可能标橙，§5.6）。
- 判定方式：**读取时惰性判定**——任何查询（list / get / stats / events）和写操作之前，先对 `status=doing AND deadline_at < now` 的任务做一次条件更新；另配 Cron Trigger 每分钟兜底（Cron 最小粒度 1 分钟，不能单独保证秒级时限）。
- 超时后 BOT 再提交 complete / fail → 409。
- 延期：只对进行中任务，管理员可延期 30 / 60 / 120 分钟，可多次；延期后超时判定按新的 `deadline_at`。
- 时间一律存 UTC（ISO 8601），页面按北京时间（UTC+8）显示。`GET /api/me` 返回 `now`（服务端当前时间），前端用它校正本机时钟（U-83）。
- TEST_MODE 下发布接口额外接受 `deadline_seconds`（用于秒级超时测试）。

### 5.6 提醒标记与「待我处理」

**逾期 `od`**（服务端计算，只读提醒，不改变状态）：

- `review` 且 `now − done_at > OVERDUE_HOURS` → 「验收逾期」；
- `todo` 且 `now − todo_at > OVERDUE_HOURS` → 「待领取超 24 小时」（`todo_at` = 最近一次进入待领取的时间；发布、自动生成的新一轮、放回待领取、改派后都重新计时）。

`OVERDUE_HOURS` 为全局配置，默认 24。逾期只提醒，不改变状态，也不自动转人工（理由见 §12）。

**待我处理 `mine`**（按当前令牌身份）：

| 角色 | 命中条件 |
| --- | --- |
| 管理员 | 状态为 unsolved 或 manual，或 `od=true` |
| 执行 BOT | `assignee=我` 且状态为 todo 或 doing |
| 验收 BOT | `acceptor=我`，`assignee≠我`，且状态为 review |
| 观察者 | 无 |

`GET /api/stats` 返回的 `mine` 是该数量；筛选用 `GET /api/tasks?mine=1`。

### 5.7 图片规则

| 项 | 规则 |
| --- | --- |
| 挂载位置 | 发布（`std` 附图）、complete、fail、accept（pass / fail）、note；作为 `images:[id,…]` 随动作提交 |
| 两步流程 | ① `POST /api/uploads` 上传，得到 `id`；② 在动作请求里引用。前端先全部上传成功才发动作；上传失败整个动作不发 |
| 格式 | 只允许 PNG、JPEG、WebP、GIF；服务端按**文件内容**判断类型，不信扩展名；**禁止 SVG** 及其他格式（400） |
| 大小与数量 | 单张 ≤5MB；每次动作最多 9 张（超过 400） |
| 前端处理 | 选择 / 粘贴 / 拖拽均可；非 GIF 且大于 300KB 的图片，长边超过 2000px 时缩放，并转为 JPEG（质量 0.85）后再上传；GIF 原样保留；提示「仅支持 PNG / JPEG / WebP / GIF 图片」「每次最多 9 张图片」「图片读取失败」 |
| 引用校验 | 服务端校验每个 `id` 存在且由调用者上传，否则 400 |
| 隐私 | 服务端去除图片 EXIF 等元数据 |
| 查看 | `GET /api/uploads/:id` 需令牌，返回 `{url}`；`url` 为短时效签名链接（有效期几分钟），页面用它显示图片；演示环境返回内存中的 data URL |
| 不可改 | 图片只增不改，本版不提供删除；数据模型预留 `hidden_at` / `hidden_by`，下一版增加「管理员隐藏」（误传密钥等敏感截图时，隐藏后不再提供查看，时间线保留「图片已被隐藏」的记录） |
| 继承 | 验收失败生成下一轮任务时，`imgs` = 原任务 `imgs` + 本次验收图片；再开一轮沿用原任务 `imgs` |
| 存储 | 图片本体存 R2；D1 存元数据（§6）；保留期见 §9.1 |

## 6. 数据模型

### 6.1 表

`tasks`：id、project、title、assignee、acceptor、status、late、round、max_rounds、publisher、created_at、**todo_at（最近一次进入待领取的时间）**、claimed_at、deadline_minutes、**deadline_at（可空，认领时写入）**、done_at、result、report、summary、**std**、**imgs（图片 id 列表）**、parent_id、accept_note、accepted_by、accepted_at、reopened

> v0.3 的 `accept_result` 字段不再要求（页面不展示，由 status 和 accept_note 可推出）；实现可保留。

`bots`：id、name、token_hash、role（executor / acceptor / admin / observer）、color

`projects`：id、name、acceptor_bot；`project_executors`：project_id、bot、position（保证轮换顺序）

`task_events`：id、task_id、at、actor、action、from_status、to_status、detail、**images（图片 id 列表）**

`uploads`：id、uploader、mime、size、width、height、created_at、r2_key、hidden_at、hidden_by（后两项预留，本版不使用）

### 6.2 事件动作名

| 动作码 | 中文 | 动作码 | 中文 |
| --- | --- | --- | --- |
| publish | 发布 | reassign | 改派 |
| claim | 认领 | reopen | 再开一轮 |
| complete | 提交完成 | close | 关闭 |
| fail | 报告失败 | force_close | 强制关闭 |
| timeout | 超时 | extend | 延期 |
| accept | 验收 | note | 留言 |
| requeue | 放回待领取 | | |

### 6.3 约束

- 验收 BOT 不能同时是该项目的执行 BOT（400）。
- 登记项目：项目名非空且不重复；验收 BOT 必须是验收角色；执行 BOT 至少一个且都必须是执行角色（400）。
- 长度限制（超出 400）：title ≤200、std ≤1000、note 留言 ≤1000、结果摘要 / 失败原因 / 验收失败原因 / 操作原因 ≤500、report ≤5000、项目名 ≤40。
- `task_events` 只增不改不删。

## 7. 接口：一套服务，三种入口

### 7.1 三端对应表（P-01 / P-02）

要求：每个 HTTP 接口都有同名 MCP 工具与 CLI 命令，参数、行为、错误码、返回数据一致，共用同一套服务端校验。

| 功能 | HTTP | MCP 工具 | CLI 命令 |
| --- | --- | --- | --- |
| 当前身份 | GET /api/me | whoami | `board whoami` |
| 发布 | POST /api/tasks | publish_task | `board publish --project --title --assignee [--minutes] [--std] [--image 文件…]` |
| 列表 | GET /api/tasks?status&late&project&bot&q&mine&assignee&parent_id&chain | list_tasks | `board list [--status] [--late] [--project] [--bot] [--q] [--mine] [--assignee] [--parent] [--chain]` |
| 详情 | GET /api/tasks/:id | get_task | `board get <id>` |
| 统计 | GET /api/stats | task_stats | `board stats` |
| 认领 | POST /api/tasks/:id/claim | claim_task | `board claim <id>` |
| 完成 | POST /api/tasks/:id/complete | complete_task | `board done <id> [--result] [--report 文件] [--image 文件…]` |
| 未解决 | POST /api/tasks/:id/fail | fail_task | `board fail <id> [--reason] [--image 文件…]` |
| 验收 | POST /api/tasks/:id/accept | accept_task | `board accept <id> --pass` 或 `--fail --note [--image 文件…]` |
| 放回待领取 | POST /api/tasks/:id/requeue | requeue_task | `board requeue <id> --why` |
| 改派 | POST /api/tasks/:id/reassign | reassign_task | `board reassign <id> [--to] --why` |
| 再开一轮 | POST /api/tasks/:id/reopen | reopen_task | `board reopen <id> --why` |
| 关闭 | POST /api/tasks/:id/close | close_task | `board close <id> --why` |
| 强制关闭 | POST /api/tasks/:id/force-close | force_close_task | `board force-close <id> --why` |
| 延期 | POST /api/tasks/:id/extend | extend_task | `board extend <id> --minutes --why` |
| 留言 | POST /api/tasks/:id/note | add_note | `board note <id> [--text] [--image 文件…]` |
| 操作日志 | GET /api/events | list_events | `board events [--actor] [--action]` |
| 上传图片 | POST /api/uploads | upload_image | `board upload <文件>` |
| 查看图片 | GET /api/uploads/:id | get_image | `board image <id> [-o 文件]` |
| 项目列表 | GET /api/projects | list_projects | `board projects` |
| 登记项目 | POST /api/projects | register_project | `board project add --name --acceptor --executors a,b` |

`simulate-timeout` 为 TEST_MODE 演示接口，不要求 MCP / CLI。CLI 的 `--image 文件` 会先调用上传再引用；MCP 的 `upload_image` 接收 base64 或本地文件路径。

### 7.2 约定

- **返回：** 任务对象字段 = §6 `tasks` 字段 + `acc_text`、`actions`、`my_actions`、`od`、`reassigns`（累计改派次数）；`GET /api/tasks/:id` 另含 `events`（每条 `{at, actor, act, from, to, detail, imgs}`）；`GET /api/tasks` 返回数组（匹配任务按 U-44 排序，最多 500 条，响应头 `X-Total-Count` 给出匹配总数；不分页）；`?chain={id}` 返回该任务所在链的全部任务，按 id 升序；`GET /api/projects` 返回 `{projects:[{name,acceptor,executors[]}], bots:[{name,role,color}]}`；`GET /api/stats` 返回 `{all,todo,doing,review,pass,failed,unsolved,manual,closed,late,mine,bots:{BOT名:待领取+进行中数}}`；`GET /api/events` 返回数组，每条 `{task,title,at,actor,act,from,to,detail,imgs}`，按时间倒序，默认最多 1000 条，支持 `actor`（包含匹配）、`action`、`task`、`from` / `to`（时间范围）筛选，`format=csv` 返回 CSV（正式环境的导出下载）；`GET /api/me` 返回 `{name,role,now}`；`POST /api/uploads` 请求 `{data:"data:image/…;base64,…"}`（正式环境也可接受 multipart），返回 201 `{id}`；`GET /api/uploads/:id` 返回 `{url}`。
- **错误：** HTTP 状态码 + `{error, message}`；`error` ∈ UNAUTHENTICATED(401) / NOT_FOUND(404) / FORBIDDEN(403) / BAD_REQUEST(400) / INVALID_STATE(409) / RATE_LIMITED(429，仅限流时出现)。
- **MCP：** Streamable HTTP，路径 `/mcp`，`Authorization: Bearer`；请先 `initialize`，服务端若返回 `Mcp-Session-Id`，客户端后续请求必须带上；工具错误返回 `isError:true`，文本为 `{status,error,message}`。
- **CLI：** 环境变量 `BOARD_URL`、`BOARD_TOKEN`；`--json` 输出接口原始 JSON；失败时退出码 1，stdout 为 `{status,error,message}`。

## 8. 鉴权与安全

- 每个 BOT 一个独立令牌；管理员独立管理令牌；观察者独立只读令牌。服务端凭令牌识别身份。
- 看板 HTML 页面公开，所有 `/api` 与 `/mcp` 需令牌；无 / 无效令牌 401。
- 「只能操作自己的任务」「只能验收本项目、非自己执行的任务」「管理员专属操作」必须服务端校验（§2.2）。
- **前端安全：**
  - 所有来自接口的文本一律转义后显示，不使用未转义的 HTML 拼接；链接只识别 `http://` 和 `https://`，并加 `rel="noopener noreferrer"`。
  - 正式环境只请求**同源**接口，不接受网址参数指定接口地址（防止令牌被发往第三方）；令牌只放会话存储，提供「退出」。
  - CSV 导出对以 `= + - @` 开头的单元格加前缀 `'`。
  - 图片只接受位图格式，禁止 SVG；图片查看使用短时效签名链接。
  - 响应头：`Content-Security-Policy`（脚本仅限本站，内联脚本用 nonce；图片仅限本站、`data:` 与图片签名域名）、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`frame-ancestors 'none'`。
  - 令牌：随机生成不少于 32 字节，服务端只存哈希；每个身份独立令牌，支持轮换；日志和事件里不记录令牌。

## 9. 技术方案

- 后端：Cloudflare Worker；数据库：D1；图片：R2（D1 存元数据）；前端：Worker 返回的单页 HTML（即前端 v2，把页内演示后端关闭，`REAL=true`，同源请求）。
- 状态变更使用条件更新（`UPDATE … WHERE id=? AND status=?`，检查 `meta.changes`）防并发；0 行受影响返回 409。
- 「状态变更 + 新建下一轮 + 写事件」放进同一个 `db.batch()`（D1 batch 是事务）。注意 batch 遇到「更新 0 行」不会回滚，所以**新建任务的 INSERT 必须带条件**（`INSERT … SELECT … WHERE EXISTS(SELECT 1 FROM tasks WHERE id=? AND status='review')`，放在状态更新之前），并发的第二个请求才不会重复建任务。
- 报告：首版写入 `tasks.report` 文本字段（纯文本显示），可后续迁 R2。
- 图片：上传时校验类型 / 大小 / 去 EXIF 后写入 R2；读取时生成短时效签名链接。
- 前端演示后端与正式后端的差异：演示环境身份由页面下拉切换，数据在浏览器内存，刷新即重置，图片以 data URL 保存；正式环境以令牌识别身份，数据在 D1 / R2。

### 9.1 非功能要求（最佳实践）

| 项 | 要求 |
| --- | --- |
| 幂等 | 发布接口支持 `Idempotency-Key` 请求头（BOT 或页面重试不会重复发布）：同一令牌 + 同一 key 在 24 小时内返回首次结果。状态类动作靠状态检查天然幂等：重复提交返回 409，不重复写事件 |
| 速率限制 | 每个令牌每分钟读 120 次、写 60 次、上传 20 次；超出返回 429 `RATE_LIMITED` |
| 审计 | `task_events` 只增不改不删；每条记录真实操作人（含 reopen 的管理员）；被拒绝的请求（403 / 409）不写事件，写服务日志 |
| 数据保留 | tasks、task_events 永久保留；图片默认保留 365 天，到期由 R2 生命周期规则清理，清理后事件保留、图片显示「图片加载失败」 |
| 备份 | D1 开启 Time Travel；每日导出一份到 R2，保留 30 天 |
| 容量与性能 | 单次任务列表最多 500 条、事件最多 1000 条；`status`、`project`、`assignee`、`acceptor`、`parent_id`、`created_at`、`todo_at` 建索引；任务超过 1 万条时再引入分页 |
| 可观测 | 每个请求生成 `X-Request-Id` 返回并写入日志；日志含身份、动作、结果码、耗时，不含令牌和图片内容 |
| 浏览器与屏幕 | 现代浏览器最近两个主版本；宽度 ≤760px 时表格变为卡片式 |
| 全局配置 | `MAX_ROUNDS=3`、`OVERDUE_HOURS=24`、`IMAGE_RETENTION_DAYS=365`、限流阈值、`TEST_MODE` |

## 10. 验收标准与测试映射

> 状态：验收测试脚本（`acceptance.test.mjs`）暂缓更新，本节是目标；脚本启动时按本节编号补齐。

测试文件：`acceptance.test.mjs`（Node 内置测试框架）。环境变量：`BASE_URL`、`ADMIN_TOKEN`、`TOKEN_CODER`（写码BOT）、`TOKEN_TESTER`（测试BOT）、`TOKEN_REVIEWER`（排课验收BOT）、`TOKEN_DATA`（数据BOT）、`TOKEN_DATA_REVIEWER`（数据验收BOT）、`TOKEN_DOC`（文档BOT）、`TOKEN_DOC_REVIEWER`（文档验收BOT）、可选 `TOKEN_OBSERVER`、`BOARD_BIN`（默认 `board`）、`TEST_MODE=1`。

测试环境预置：3 个项目与前端一致（排课系统：排课验收BOT / 写码BOT、测试BOT；数据报表：数据验收BOT / 数据BOT、报表BOT；文档库：文档验收BOT / 文档BOT、写作BOT），9 个 BOT 颜色与前端 `COL` 一致。

| 编号 | 验收标准 | 覆盖的编号 |
| --- | --- | --- |
| A-01 | 页面包含前端 v2 全部固定文案、按钮、表头（13 列）、选项、状态说明 10 行 | U-01 U-02 U-10 U-14 U-15 U-16 U-17 U-20 U-21 U-30 U-50 B-01 B-05 B-12 B-13 B-21（静态） |
| A-02 | 发布：校验、权限（含无权限身份）、系统字段、时限 7 档、发布人由令牌决定、验收标准与图片写入、长度限制 | B-01 U-10~U-15 U-38 |
| A-03 | 任务表 13 列字段齐全、排序、状态 8 种、超时标黄、逾期标橙、`actions` / `my_actions` 与状态和身份一致、截止列规则 | U-31~U-46 |
| A-04 | 统计 10 项与列表一致；状态 / 超时 / 项目 / 待我处理筛选正确；搜索与 BOT 筛选叠加；`stats.bots` | U-20 U-21 U-22 B-12 B-13 |
| A-05 | 每个按钮对应的动作：权限、状态、写入字段、默认值、原因必填 | B-02~B-11 B-14~B-16 |
| A-06 | 状态 × 动作静态矩阵（含 extend / force_close / note）：允许的成功，其余 409 且状态不变 | S-01~S-08 |
| A-07 | 20 条动态流程（含并发） | D-01~D-20 |
| A-08 | HTTP / MCP / CLI 同一动作结果一致，错误码一致，三端工具 / 命令齐全（含 note、extend、force-close、events、uploads、whoami） | P-01 P-02 |
| A-09 | 完成时间、领取时间、截止时间等由服务端写入，客户端传值无效；时限从认领起算 | B-03 D-04 D-18 |
| A-10 | 验收只能本项目验收 BOT 做，且不能验收自己执行的任务；管理员专属动作非管理员 403；观察者所有写操作 403 | B-06 B-07 |
| A-11 | 达到 3 轮仍失败转需人工处理，不再自动发布 | D-03 D-09 |
| A-12 | 图片：格式（含 SVG 拒绝、按内容判断）、大小、数量、权限、引用校验、签名链接、下一轮继承 | U-17 U-62 U-73 B-18 D-17 |
| A-13 | 详情：时间线字段（操作人、前后状态、说明、图片）、任务链、改派次数、验收标准 | U-60~U-63 D-20 |
| A-14 | 留言与人工介入：留言规则、强制关闭、延期、原因必填并写入时间线 | U-64 U-65 U-72 B-14 B-15 B-16 D-14 D-15 D-16 |
| A-15 | 提醒：逾期 `od`、待我处理 `mine` 按角色、标签页数量、深链接 | U-43 U-80 U-81 D-19 |
| A-16 | 操作日志：全量事件、操作人 / 动作筛选、CSV 导出（含公式注入前缀） | U-70 B-19 |
| A-17 | 时间与同步：`/api/me.now`、北京时间显示规则、5 秒刷新、变化高亮、409 提示 | U-39 U-40 U-46 U-47 U-82 U-83 |
| A-18 | 前端安全：文本转义、链接仅 http(s)、同源请求、令牌不外发 | §8 |
| A-19 | 项目管理：登记校验、权限 | U-71 B-20 B-22 |
| A-20 | 验收测试覆盖完整性检查（所有编号均已执行） | 最后一个用例 |

覆盖清单 `REQUIRED`：`U-01 U-02 U-10~U-17 U-20~U-22 U-30 U-31~U-47 U-50 U-60~U-65 U-70~U-73 U-80~U-83`、`B-01~B-22`、`S-01~S-08`、`D-01~D-20`、`P-01 P-02`。

上线前全部用例通过，才算 M1 / M2 验收合格。

## 11. 里程碑

1. M1：D1 表 + 发布 / 查询 / 认领 / 完成 / 失败 / 验收接口 + 鉴权 + 项目登记
2. M2：看板页面（前端 v2 接入接口）+ 超时转未解决 + 验收失败自动循环 + requeue / reassign / reopen / close / force-close / extend / note + events
3. M3：图片（R2、上传 / 查看接口、签名链接）
4. M4：MCP 与 CLI（三端一致）
5. M5：通知（事件驱动：超时转未解决、需人工处理、验收逾期推送给管理员）与图片「管理员隐藏」
6. M6：自动路由

## 12. 决策记录与后续迭代

### 12.1 已按最佳实践定稿

| 事项 | 决策 | 理由 |
| --- | --- | --- |
| 待领取逾期计时起点 | 用 `todo_at`（最近一次进入待领取的时间）；发布、新一轮、放回待领取、改派后重新计时 | 避免刚被放回的任务立刻标橙，提醒才有意义 |
| 待领取认领期限 | 只标橙提醒，不自动转状态 | 无人认领多半是派发问题，自动转状态没有处理对象，交给管理员判断 |
| 待验收逾期 | 仅提醒，不自动转人工、不自动换验收 BOT；阈值 `OVERDUE_HOURS` 可配置 | 自动换人会破坏「项目验收人」的权责约定，先用数据观察再定 |
| 留言权限 | 管理员 + 该任务的指派 BOT + 验收 BOT；其他人只读 | 最小权限，减少无关 BOT 的噪声 |
| 发布前审批 | 本版不做；需要时作为项目级开关加入 | 现有验收和人工介入已有兜底 |
| BOT 管理 | 本版由部署脚本 / 管理接口完成（令牌只存哈希、可轮换），页面不提供 | 令牌操作高敏感，不放进页面 |
| 图片隐藏 / 删除 | 本版不做，已预留字段；下一版做「管理员隐藏」并保留事件 | 兼顾审计完整和敏感截图的处置 |
| 报告渲染 | 保持纯文本；将来支持 Markdown 时只用白名单渲染并禁止原始 HTML | 安全优先 |
| 通知 | 事件驱动，M5 实现；优先 Webhook（企业微信 / 飞书 / 邮件由 Webhook 转发） | 复用 `task_events`，不影响主流程 |
| 日志导出 | 正式环境由服务端导出（`format=csv`），支持时间范围和筛选；演示环境前端复制 | 数据量大时前端导出不可靠 |
| 列表上限 | 任务 500 条、事件 1000 条，带总数头；超出时页面提示改用筛选 | 无分页时避免一次下载过多；数据量大再分页 |

### 12.2 仍留待后续迭代

- 图片标注、视频与通用附件（日志文件、压缩包）。
- 任务优先级、批量操作、统计报表（通过率、平均耗时、各 BOT 负载）。
- 事件防篡改（哈希链）。

## 附录 A　前端 v2 需同步的改动（v2.1）

本版 PRD 的决策与已发布的前端 v2 有以下差异，前端改动待确认后再做：

1. 「待领取超 24 小时」的计时起点由 `created_at` 改为 `todo_at`（演示后端同步增加 `todo_at`，放回 / 改派 / 新一轮时重置）。
2. 留言权限收窄：「发送留言」只对管理员、该任务指派 BOT、验收 BOT 显示（演示后端的 `can("note")` 同步）。
3. 任务列表超过 500 条时，在表格上方提示「仅显示最新 500 条，请用筛选缩小范围」（U-47）。
4. 发布请求带 `Idempotency-Key`（每次点击生成一个随机值），重试不会重复发布。
