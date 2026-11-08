# 子任务与执行方式

当前会话负责任务记录。例：修复跨模块缺陷时，主 Agent 保留复现环境，将脱敏日志交给一个候选模型分析，另一个候选模型按接口契约提出回归用例。两个产物独立时可并行。主 Agent 验证诊断、应用修复、运行用例并组织最终发布。只改一个配置值时可直接在当前会话完成。

外部模型经 call_model 获取显式内容并返回文本。宿主负责读取仓库、应用补丁、执行命令和浏览器验证。授权范围和实际可用工具决定能执行的操作。原生子智能体的工具、推理档位和模型以宿主当次能力为准。

## Choose host-native model tier and effort
Use model and reasoning-effort values actually supported by the runtime.

Default to `gpt-6-luna` for selectable Codex-native roles, including ordinary implementation, host tool execution, tests, focused review and routine primary coordination. This is a preference beneath explicit task choices, live user policy and actual availability, not a guarantee that this turn's primary can change model.

| Work | Native default / justified upgrade | Typical effort |
| --- | --- | --- |
| Extraction, file inventory, mechanical edits, deterministic checks | `gpt-6-luna` | low |
| Ordinary implementation, debugging, tests, focused review, host execution, routine coordination | `gpt-6-luna` | medium |
| Difficult repair, ambiguous cross-module logic, consequential failure risk | `gpt-6.1-sol` when evidence justifies escalation | medium/high |
| Hardest bounded reasoning or high-consequence architecture/security decision | `gpt-6-astra` only when its added cost is justified | medium/high; higher only with a reason |

Primary accountability, many agents, or the word “architecture” alone does not justify the strongest model. Known complexity can justify starting higher without paying for a predictable failed low-tier attempt. Diagnose context/tool/environment problems before escalating intelligence. Never create a lower-tier agent merely to pretend a fixed primary was downgraded.

Output `选择依据` before dispatch, and old/new model and effort plus concrete evidence for every `升级原因`, including effort increases. State `不调用外部原因` even in zero-worker runs: explicit local/no-call mode, actual preflight or policy failure, missing suitable candidate/capability/context, or better total accepted-result cost. Use private source or logs only within the current user’s authorization for the chosen recipient and task. Do not mechanically redo accepted external reasoning with an internal model. Record decisions again in the final report.
