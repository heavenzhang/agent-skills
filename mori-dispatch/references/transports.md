# Mori 调用通道与操作映射

适用于 `mori-dispatch` 1.1。以目标版本 Mori 仓库的 `mcp/main.ts`、`mcp/client.ts`、`mcp/tools.ts` 和 `server/app.ts` 为接口契约；下表已对照 `heavenzhang/mori-platform` 提交 `9efa22df403fd813f0d208bd40bf598caf0df6c0`。目标服务版本不明或契约不同时先核对，不能猜测路径或字段。

## 使用真实 stdio MCP 适配器

运行经审阅的 Mori `mcp/main.js` 或其 Node 22 CJS bundle，由环境/密钥绑定提供 `MORI_BASE_URL`、`MORI_USERNAME`、`MORI_PASSWORD`。stdio 使用逐行 JSON-RPC，完成 initialize 后通过 tools/list 读取实际 schema，通过 tools/call 调用真实工具。先调用 whoami 和 list_employees，核实身份与员工列表；工具清单可由脚本读取，不要求宿主客户端预注册。

当前仓库适配器是 stdio MCP，经 HTTPS 调用平台 REST API；平台公开地址不是 HTTP MCP 地址。不要从平台 URL 自行拼出 `/mcp` 或 `/AIRouter/mcp`。若已有 HTTP MCP 服务，使用用户提供或已有配置中已验证的完整地址及其实际工具 schema。

## 使用真实 HTTP 客户端

复用 `MoriHttpClient` 或等价会话客户端：登录 `POST /api/v1/auth/login`，在内存中保留 Cookie，然后 `GET /api/v1/session` 取得身份及 CSRF。示例基址 `https://192.144.166.234/mori`：所有 API 都拼接在 `/mori` 后；写请求 Origin 只使用 `https://192.144.166.234`。

请求遵循服务端鉴权、Cookie、同源 Origin、`X-Mori-CSRF` 和 `Idempotency-Key`；发送消息还需 `clientMessageId`。所有对象 ID 从实际响应读取并按路径段编码。不要在会话失效时无限重试；认证失败或权限不足时准确汇报，不能改用管理员或其他账号绕过。

| 逻辑操作 | 真实 REST 接口 | 关键约束 |
| --- | --- | --- |
| whoami | `GET /api/v1/session` | 仅展示组织、用户、角色等身份字段；隐藏 csrfToken/Cookie |
| list_employees | `GET /api/v1/employees` | 保留服务端可见性过滤；字段未提供时如实标记 |
| list_conversations | `GET /api/v1/employees/:employeeId/conversations` | 当前账号可见员工 |
| create_conversation | `POST /api/v1/employees/:employeeId/conversations` | body `{title}`，用户选人之后执行 |
| send_message | `POST /api/v1/conversations/:conversationId/messages` | body `{text,clientMessageId,interactionMode}`；返回平台 TaskTurn，不直接返回 MCP 的等待结果 |
| get_messages | `GET /api/v1/conversations/:conversationId/messages` | 可在客户端按真实消息顺序截取最近 N 条 |
| get_runtime | `GET /api/v1/conversations/:conversationId/runtime` | 读取任务状态、交互与文件 |
| respond | `POST /api/v1/conversations/:conversationId/respond` | `{requestId,kind,decision}` 或 `{requestId,kind,answers}`；带真实交互的 expectedTurnId |
| stop_turn | `POST /api/v1/conversations/:conversationId/stop` | `{expectedTurnId}`，先确认当前任务 |
| reconcile_turn | `POST /api/v1/turns/:turnId/reconcile` | 默认自动核对 body `{}`；不得伪造人工完成/失败结算 |
| wait_turn | 查询 `GET /api/v1/turns` 与会话 runtime/messages | 是客户端等待过程，没有假定的 `/wait_turn` REST 路由 |

等待应复用 `mcp/tools.ts` 的 waitForTurn 行为，或按相同契约以本次平台 turnId 查真实结果。运行时可能仍显示旧任务终态，必须核对 platform turn 与 runtime turnId/threadId 的对应关系。收到 awaiting_approval / awaiting_input 立即回传真实交互；等待超时表示仍需查询，不能当作失败或盲目重新发任务。

遇到网络超时或写请求结果不明时，保留原幂等键和 clientMessageId，先查询受理记录。不要换键重复创建会话或重复发任务。遇到 RECONCILIATION_REQUIRED 按主技能的 reconcile 流程处理。

## 更新平台上的技能副本

仓库内 SKILL.md、平台 `skill-library.json`、不可变类型版本与员工 CODEX_HOME 的 SKILL.md 是不同副本。更新仓库和本地安装后，只有取得实际平台记录与权限才能更新线上版本。

先查 `GET /api/v1/catalog` 识别已有记录的 id、名称、版本和内容；`POST /api/v1/skills` 是导入新记录，不能当作更新已有技能。当前核对版本没有技能更新 REST 路由，不得虚构 PATCH 路径、重复导入冒充更新，或覆盖其他私有技能。需要平台已有更新操作或授权的服务端维护通道时，再按实际支持方式执行并回读验证。

类型版本已经固化的技能和员工磁盘 manifest 不能靠修改源文件自动升级；使用平台的类型版本/准备流程更新，并记录版本及哈希。保留已运行任务与现有用户数据，未核实的线上更新须报告为未完成。
