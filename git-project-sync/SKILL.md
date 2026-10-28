---
name: git-project-sync
description: 以用户明确提供的 Git 仓库为共同基准，保存代码、项目说明、计划和任务交接记录，支持跨智能体、会话、机器及 worktree 的持续开发。适用于首次绑定、接入已有开发、保存进度、发现和恢复远端任务、集成与发布交接。各部署单元沿用唯一负责会话；本技能不授予额外权限，不保存秘密信息或运行数据。
---

# Git 项目同步

让另一个智能体仅凭指定 Git 仓库中的内容，就能定位成果、理解当前状态并接续工作。同步成功以远端分支的准确提交和有效交接记录为依据；聊天历史只提供背景。

## 使用前核实

- 必须使用用户明确提供的仓库地址。后续沿用该地址，每条命令都传入 `--remote <git-url>`；缺少地址时再询问，不从 `origin`、目录或交接文字擅自选择仓库。
- 核实实际仓库、主干、分支、worktree 和已有改动。保留其他任务的工作，不 reset、clean、覆盖、强推或代为提交归属不明的内容。
- 脚本要求 Node.js 18+，以及支持 `git hook run --ignore-missing --to-stdin` 的 Git，使用已有 Git 凭据。支持 HTTPS、SCP 风格 SSH、`ssh://git@host/...` 和本地测试远端；URL 不得包含密码、HTTP 认证信息、查询参数或片段。
- 脚本检查全部 fetch／push URL；只有它们都指向所提供的仓库时才继续。保存前核实 push／merge 是否自动触发共享 CI 或部署，并沿用该单元负责会话的协调流程。

## 项目中保存什么

沿用现有目录结构，不为示例移动代码或建立空目录：

```text
AGENTS.md                              项目规则与技能加载入口
.agent-sync.json                       仓库身份、主干与分支策略
.agent-sync/project-map.md             源码、测试、规格、决策、运维与资源的位置
.agent-sync/plan.md                    目标、里程碑、优先级、依赖与部署归属
.agent-sync/tasks/<branch-record>.md   每个任务分支的目标、验收、进度、证据和下一步
.agents/skills/git-project-sync/       随项目保存的技能、脚本与部署参考
```

新任务和接续任务依次阅读地图、计划、任务记录，再检查其中指向的实际文件。地图中注明不适用的类别及其他仓库的明确地址、版本；共享计划不能由分支交接记录替代。避免复制完整设计或测试日志，链接权威资料和证据。

仅版本化适合保存的源码、测试、文档和源资源。凭据、令牌、Cookie、私钥、本地数据库、缓存、构建输出和本机状态不进入 Git。大型输出使用已获授权的外部存储，记录非敏感位置和摘要；访问资料只记录取得方式或安全存储位置。

## 选择入口

| 当前情况 | 操作 |
| --- | --- |
| 首次为干净项目建立共享协议 | `bind` |
| 已有提交或未提交开发，希望保留成果并建立交接 | `adopt` |
| 从主干开始新任务 | `start` → `task-init` |
| 保存当前任务的明确文件范围 | `save` |
| 只有仓库地址，需要发现远端待接续任务 | `list` |
| 已选定任务，在新 worktree 接续 | `resume` |
| 独立检查当前分支是否已同步 | `handoff` |

下面用 `<script>` 表示当前安装技能的 `scripts/project-sync.mjs`；绑定后优先使用项目内 `.agents/skills/git-project-sync/scripts/project-sync.mjs`。

## 首次绑定或接入已有开发

干净项目从远端主干最新提交建立初始化分支，再执行：

```bash
node <script> bind --repo <project-path> --remote <git-url> --canonical-branch main --branch-prefix codex/
```

已经有开发成果时，先核实当前工作归属；如果仍在主干，使用 `git switch -c <branch-prefix><task-id>` 创建唯一任务分支并保留现有改动，再执行：

```bash
node <script> adopt --repo <project-path> --remote <git-url> --title "本任务目标"
```

`adopt` 可在已有提交或脏工作区执行，基线自动取当前 HEAD 与已核实远端主干的共同祖先；也可用 `--base <full-sha>` 明确指定。基线必须同时属于任务和主干历史。命令不切换分支，不提交、不推送，不覆盖已有地图、计划或任务记录。已有记录时直接更新并使用 `save`。

填写地图、计划和任务的实际内容，移除 `scaffold=true`。`bind` 只生成项目资源，`adopt` 还生成当前分支任务记录。完成后，将输出的 `changedFiles` 逐文件纳入保存范围，再按项目流程合入主干；合入前不把初始化分支当作全项目已共享的协议。

已有绑定需升级时，在干净且位于远端主干最新提交的初始化分支运行 `bind --update --refresh-skill`；已有开发接入时可使用 `adopt --refresh-skill`。审阅生成差异，保留自定义内容和原有部署负责人。命令不会自动更新所有已克隆项目或修改 CI/CD。

## 从主干启动新任务

先读地图和计划，运行 `observe`。获取主干，在唯一任务分支和隔离 worktree 中开始；两个写入者不得共用 worktree：

```bash
node <script> observe --repo <project-path> --remote <git-url>
git fetch <remote-name> <canonical-branch>
git worktree add -b <branch-prefix><task-id> <isolated-path> <remote-name>/<canonical-branch>
node <script> start --repo <isolated-path> --remote <git-url> --base <full-canonical-sha>
node <script> task-init --repo <isolated-path> --remote <git-url> --base <full-canonical-sha> --title "本任务目标"
```

填写任务记录的目标、可观察验收标准、已完成工作、验证、阻断和一个明确下一步，移除模板标记。记录还应说明所涉及部署单元及是否需要发布。脚本生成的标题和元数据是协议标识，保留原样，正文可用中文。

## 保存进度并核实远端

Agent 先更新任务记录、执行相称检查，再将实际命令与结果作为 `--verification` 提供；未运行时明确写 `not-run: 原因`。这段文字是调用者提供的证据说明，脚本不会代替运行测试或证明其真实性。

```bash
node <script> save --repo <task-worktree> --remote <git-url> \
  --path src/example.js --path tests/example.test.js \
  --message "修复并保存任务进度" --verification "node --test：通过"
```

- `--path` 可重复，只接受明确的仓库相对文件路径；不接受目录、通配选择或 `git add .`。删除的已跟踪文件也可指定。任务记录自动纳入。
- 索引中存在范围外暂存改动时停止；其他工作区改动保留并报告为尚未同步。初次接入要明确包含配置、地图、计划、AGENTS 及技能副本等生成文件。
- 保存会检查必填正文和模板残留，写入稳定任务 ID、版本 2 元数据及当前源码树摘要，并保留已有验证内容。摘要覆盖除任务记录目录之外的所有已跟踪树条目，避免记录自身提交 SHA 的循环引用。
- 只提交选择的文件，核实记录与候选内容后，非强制推送当前任务分支，并再核对远端 SHA。只有 `synchronized: true` 才可报告所选成果已保存到远端；剩余本地改动必须另行说明。
- 保留并通过 Git 执行项目已有的 hooks，包括引用事务门禁，转发原参数和标准输入；每个提交前阶段结束后检查索引仍等于已审阅候选。hook 额外暂存或改写候选时，在创建提交前停止，保留文件和索引供审阅，不跳过项目检查。审阅并处理 hook 产生的暂存内容、重做受影响验证后再保存。
- 失败时保留本地文件、索引和提交；推送结果未知时先检查远端，不盲目重试或强推。远端存在本地未包含的新工作时停止，先获取、审阅和协调。

代码在记录保存后再次变化，`handoff`、`resume` 和任务发现会报告记录过时。版本 1 记录可读取，但缺少摘要时不会通过恢复校验；在已有任务 worktree 使用当前安装版本执行 `save`，或按核实的远端 SHA 手动创建隔离 worktree 后再迁移。补齐实际内容并保存，即可补上摘要并升级，不需要重写历史。

## 发现任务和恢复工作

另一个智能体克隆用户给定的同一仓库，然后列出远端任务；自定义远端名、主干或分支前缀时，传入与项目一致的参数：

```bash
node <script> list --repo <new-checkout> --remote <git-url> --json
node <script> resume --repo <new-checkout> --remote <git-url> \
  --task <task-id-or-branch> --worktree <new-isolated-path> --json
```

`list` 获取远端任务记录，输出任务 ID、标题、状态、分支、HEAD、基线、记录路径和下一步，也显示未建立记录或校验失败的分支。默认不列已合入或标记完成的任务，`--all` 可查看。仅有一个待接续任务且有效时才给出建议；多个任务或存在其他无效候选时，不擅自挑选。

`resume` 可省略 `--task` 来选择唯一待接续任务；有多个时列出候选并停止。创建新的隔离 worktree 前再次核实远端 SHA，不覆盖现有路径，不重置本地分支，不抢占其他 worktree。成功后使用返回的 `resumedWorktree` 继续。已在正确任务分支时，可直接执行 `resume`；基线默认从任务记录读取，明确传入时必须一致。

阅读地图、计划和任务记录，审阅完整 `base..HEAD` 差异，从下一步继续，重跑与风险相关的检查。可独立检查当前分支：

```bash
node <script> handoff --repo <task-worktree> --remote <git-url> --json
```

任务报告提供“仓库地址、任务 ID、远端分支、完整 HEAD SHA、记录路径、验证状态及下一步”。记录文件不保存它自身所属提交的 HEAD SHA。

## 集成、部署与边界

指定集成负责人合入前，核对已审阅的远端提交，同步当前主干、处理冲突并复核受影响行为，随后验证远端主干实际包含成果。不得强推或改写已发布历史。沿用已有授权，技能本身不额外授予合并、部署、迁移或生产变更权限。

涉及共享 CI、版本分配、发布、部署、迁移、回滚或归属转交时，读取 [部署协调参考](references/deployment.md)，并按最新主干计划中的单元负责人执行。缺失归属只暂停受影响发布，不妨碍开发、Git 保存或其他独立单元。

同步校验只证明已提交成果、记录和远端版本一致。它不保证文字的语义完整性、测试质量或真实业务验收，不提供实时锁、数据库同步、凭据分发，也不自动同步忽略文件、生成文件或子模块工作区。浅克隆缺少基线历史时，先补充所需历史再校验。

目标地址、主干、基线、分支、任务记录或远端版本无法核实时停止，报告具体缺口及修复动作；不通过破坏性清理或降低校验标准继续。
