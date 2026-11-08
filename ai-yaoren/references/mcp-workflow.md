# New API MCP 调用流程

使用当前会话发现的 MCP 命名空间。读取工具结果时先检查传输错误、isError 和 error，再读 structuredContent。仅有 content 时解析其中的 JSON 文本。以下参数均为工具输入对象。

连接沿用宿主已配置的 AIRouter Streamable HTTP 服务和凭据。以已验证的 HTTPS 连接及当前令牌身份为准；宿主可将工具显示为 mcp__dev_team_control__ 开头。若工具缺失，核查宿主实际发现结果，必要时重新连接。保留已有钥匙串或凭据助手设置，助手输出可能含认证头，避免回显。

1. **get_routing_policy({})**。读取 version、字符串 policy、数组 boundaries 及可选的结构化 delegation。delegation.categories 是后台类别，models 按类内 priority 降序，同级保持保存顺序；delegation.rules 指定适用场景、category_id、执行人、强度和验收要求。返回的类别候选已按当前令牌的实时模型目录过滤。在做任何自做或分派决定前读取本轮规则，结合条件区分默认偏好与明确的“必须”条款。后台发布后，下一次调用即返回新规则；需要记录版本时使用返回的 version。兼容旧服务时该字段可能缺失。策略缺失或不可读时说明缺口，仅推进不依赖未知规则且已明确授权的工作。
2. **list_models({})**。可传 search 字符串过滤 ID。按场景分派时传 category_id，models 保持类内优先级顺序，recommended_model 是当前首选，policy_version 是本次读取的发布版本。该版本须与刚读取的策略一致；否则重新取得规则。没有可用候选时按规则交回主 Agent 并说明原因，必须项则暂停。models[].id 是本令牌可调用的标识，traits、verification 为本地注释。结合已有任务证据选择模型，识别 pricing_status、pricing 中实际返回的定价方式与表达式。未知价格和表达式中的占位值不能按零结算。无适用模型时回到主 Agent 或已授权宿主执行。
3. **call_model**。需要 execute 权限。只读令牌可能仅显示三个查询工具。使用列表返回的准确 ID，必填 model、prompt。按类别分派时同时传 category_id 和 policy_version，服务在实际模型请求前检查版本及类别成员；stale_policy 或 model_outside_category 表示未执行，应重新读取并复核分派。按需传 system_prompt、context_files（每项为 path 和 content）以及正整数 max_output_tokens。上下文由主 Agent 显式读取、脱敏并提供。每个密钥最多 8 个在途调用，按任务独立性分派。每次都是独立文本请求，没有跨调用记忆。已核实上游支持时，可传 thinking: {type: "disabled"} 或 {type: "enabled"} 控制思考模式；默认省略，沿用供应商行为。输出上限可能同时计入推理 Token，只有推理而没有最终回答时按未交付处理。
4. **get_usage({})**。只在有额度或用量查询需要时读取，遵守独立限流。返回令牌级累计或可用额度及内部参考换算。共享令牌期间的差额不能直接归为某一子任务。调用结果自己的 usage 更适合逐项报告，可能为估算或缺失。不要轮询余额来判断某次调用是否完成。

调用示意如下。用已获授权的列表结果替换 model 和 category_id，用实际发布版本替换 policy_version，再按任务提供内容。旧服务没有类别字段时沿用其实际工具参数。

```json
{
  "model": "<list_models 返回的 id>",
  "category_id": "<命中场景引用的类别 ID>",
  "policy_version": 1,
  "prompt": "根据给定接口说明，列出边界用例。每项给出前置条件、输入及可观察的期望结果，由主 Agent 在测试环境验证。",
  "context_files": [{"path":"contract.txt","content":"示例接口允许 1 至 3 项输入。"}]
}
```

成功时读 content、model_requested、model_reported、finish_reason、usage。返回模型标识可缺失，也不单独证明上游模型身份。把产物放回当前会话逐项验收。

明确 not_executed 时，排查模型许可或并发等原因，条件恢复后再决定是否发出新请求。truncated 时保留 partial_content、usage，按未完成处理。unknown、断流或超时不盲目重试，核对可取的网关记录；无法确认就记录未知。MCP 没有按子任务查询历史的工具。对已经成功返回但未达标的文本，新的修正请求应注明失败标准及前次产物，仍遵守费用授权。
