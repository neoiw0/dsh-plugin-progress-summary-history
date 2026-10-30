# 事前验尸（pre-mortem）：知乎帖子发出后，朋友装不上 / 装了没用

> 方法：假设帖子已发、一个月后出现大量「装不上」「没反应」的反馈，倒推所有死因，
> 按 **概率 × 影响** 排序，逐条给出**预防**（发布前能改的）与**检测**（发布后怎么快速发现）。
> 每条尽量附本机实测证据；没有证据的标注「未验证」。

## 一、结论先说：发布前必须改的三件事

| 优先级 | 问题 | 现状 | 处理 |
|---|---|---|---|
| P0 | **文案里的安装命令不存在** | 写的是 `dsh plugin --profile desktop add ...`，但桌面版**没有 `dsh` 命令**（本机 PATH 无 `dsh`） | 改成 GUI 步骤：DSH →「插件」→ 右上「+ 添加插件」→ 粘贴地址 → 重启 |
| P0 | **GitHub 直连不稳** | 本机 `git push` 直连 GitHub 失败（`Recv failure`），必须走系统代理 `127.0.0.1:9910`；朋友大概率同样 | 文案加「若下载失败，用代理或手动下载 tgz」 |
| P1 | **密钥填在哪里没说清** | 配置写 `apiKeyEnv: OPENCODE_GO_API_KEY`，密钥实际存在 DSH 的凭据里（`~/.dsh/.credentials.yaml`，UI 的「Add API Key」写入） | 文案补：在 DSH 设置里加 API Key，而不是设系统环境变量 |

## 二、死因清单（按概率 × 影响排序）

| # | 死因 | 概率 | 影响 | 证据 / 说明 | 预防 | 检测 |
|---|---|---|---|---|---|---|
| 1 | 安装命令写错，用户复制后报「命令不存在」 | **高** | 中 | 本机 `command -v dsh` 为空；插件入口只在 GUI（`dsh-client-ui-plugin-manager` 的「添加插件」，底层 `pnpm add`） | 文案改为 GUI 三步；给出地址而非命令 | 帖子评论出现「dsh 不是内部命令」 |
| 2 | GitHub 下载失败（直连被重置） | **高** | 高 | 本机实测 `git push` 直连失败、需代理；`curl` 直连 GitHub 也超时 | 文案注明「需要能访问 GitHub 的网络，或用代理」；备选：Release 页手动下载 tgz 后用「本地文件」安装 | 反馈集中在「安装卡住/超时」 |
| 3 | 手写 `cordis.patch.yml` 缩进错 → DSH 启动异常或插件不加载 | **高** | 高 | 我们自己在今天多次因 patch 出错导致播报消失；YAML 对缩进极敏感 | ① 提供 `npm run config:fix` 一键补；② 后续版本把 provider 默认值内置进插件，用户不用手写 | 「插件装了但没反应」类反馈 |
| 4 | 密钥没填 / 填错位置 → 播报永远空 | **高** | 高 | 适配器对上游错误会吞成空文本（今天实测 `chars=0` 静默）；密钥存于凭据库而非环境变量 | 文案明确「DSH 设置 → Add API Key」；面板/文档给排查命令 | 用户说「播报行从来不出现」 |
| 5 | 免费模型被限流（429）→ 播报偶发消失 | **高** | 中 | 实测约每 15 秒 3 次，超限返回 `429 Endpoint is unavailable`，适配器静默 | 配置 `minIntervalMs: 45000`；文案写明这是限流不是坏了 | 反馈「有时候有有时候没有」 |
| 6 | 免费模型下线 | **已发生并已处置（2026-10-26~27）** | 中 | `minimax-m3.1-flash-free` → `410`；**`longcat-2.5-preview-free` 也已在 10-26 变 `410`**，当日 189/248 次调用空输出，bar 静默 7 小时 | 已提供 `npm run probe:free` 探测器；文档不再写死模型 id | 跑 `npm run probe:free`；日志出现 `410` |
| 7 | 空闲时播报行隐藏，被当成坏了 | **高** | 低 | 设计如此（`state=idle` 时不显示） | 文案一句话说明 | 反馈「只有干活时才有」 |
| 8 | 只装面板、没装播报插件 → 面板「暂无进度」 | 中 | 低 | 面板数据来自 `plugin:progress-summary/line` | 文案强调「两个都要装」；面板空态文案提示先装播报插件 | 反馈「面板空的」 |
| 9 | 上游插件更新，事件名/属性变了 → 面板空 / 点 bar 失效（静默） | 中 | **高** | 我们依赖 `plugin:progress-summary/line` 与 `[data-progress-summary]`；上游改名不会报错，只是没数据 | 客户端对属性缺失做降级（已有：点不到就不触发）；面板空态区分「没数据」与「上游缺失」 | 上游发新版后集中出现「面板空」 |
| 10 | DSH 版本差异（旧版/Web 版）→ 侧栏 API 不存在 | 中 | **极高** | 今天亲身经历：客户端插件 import 失败会让**整批**客户端插件失效 → 白屏 | 客户端在 `apply` 里先探测 `sidebarRight` 是否存在（已有 `ctx.inject` + `safe()` 包裹）；发版前在隔离 profile 冒烟 | 反馈「装完 DSH 白屏」——最高危，需立刻回滚说明 |
| 11 | 改完配置不重启 → 以为没生效 | 中 | 中 | 今天多次验证：插件配置**不热更新** | 文案写明「改完必须重启」 | 反馈「改了没用」 |
| 16 | **长回合打满 `maxPerTurn`（默认 40）后静默停播**：bar 停更但插件无报错，极易被误判为"插件坏了" | 中 | 高 | 2026-10-30 实测：turn 17 跑 5 小时、323 次工具调用，播报正好 40 次后停 3.5 小时，下回合恢复 | 配置 `maxPerTurn: 300`；`verify:narrator` 增加"本回合调用数"显示 | 用户以为功能失效，反复重启排查 |
| 15 | **把 `effort: 'off'` 当成"已关闭思考"**：适配器把 `off` 翻译成"不发该字段"，而模型条目没声明 `reasoningEfforts` 时宿主判定该模型不支持推理，effort 被判无效并**静默回落**；GLM 于是按默认思考，思考 token 吃光 `maxTokens`，正文只剩 0~10 字（碎片/空行） | 高 | 高 | 2026-10-28 实测：重启前 6.1% 短输出、36% 空输出、中位耗时 3.5~6.8s；补上 `compat.thinkingFormat: zai` 后 0% 短输出、1% 空输出、中位 2.1s | 模型条目必须同时写 `reasoningEfforts`（让宿主认定支持推理）与 `compat.thinkingFormat`（让适配器发 `thinking:{type:"disabled"}`）；`npm run verify:narrator` 增加"短输出比例"检查 | 碎片行持续出现、月额度被思考 token 白烧 |
| 14 | **拿官网「预估请求数」选模型**：那张表按编码 agent 画像算（每次 7 万缓存 token），播报 prompt 仅 130 token、**缓存命中实测为 0**，直接套用会把结论算反（实测 GLM $0.000026/次 vs DeepSeek $0.000060/次） | 中 | 中 | 10-27 实测同请求连发两次 `cached_tokens` 均为 0 | 文档写明「播报吃不到缓存，只看输入×130+输出×实际输出」；`probe:free` 用真实 prompt 打表 | 用户按官网数字选错模型 |
| 13 | **配置解析脚本误报**：profile 换行符混用（CRLF+LF）时，`config:check` 曾误报「缺少 provider 块」 | 中 | 中 | 10-26 实测：文件 37 个 CRLF + 177 个 LF，脚本按 CRLF 切分只得到 38 段 | 已改为按 LF 切分并剥行尾 CR；文件换行已统一 | 跑 `npm run config:check` 应报「已存在」 |
| 12 | 插件自身语法/契约错误 | 低 | **极高** | 今天两次启动失败均由此而来（半截文件、模块 id 与包名不一致） | `npm run check` 20 项（含 3 条静态断言）+ 从 tarball 安装（不再软链工作目录） | 启动日志 `web boot: N entry did not activate` |

## 三、本次已实测验证的项

| 验证 | 方法 | 结果 |
|---|---|---|
| 面板安装包能否被 pnpm 安装 | `pnpm add <Release tgz URL>` | ✅ 9.7 秒装成 `dsh-plugin-progress-summary-history@0.1.4` |
| 播报插件能否被 pnpm 安装 | `pnpm add git+https://github.com/tastynoob/dsh-progress-summary.git` | ✅ 9.3 秒装成 `dsh-progress-summary@0.1.0` |
| GUI 接受什么形式的地址 | 读 `dsh-client-ui-plugin-manager` 文案 | ✅「支持 npm 包、Git 仓库和本地目录」，底层 `pnpm add` |
| 密钥存放位置 | 读 UI 文案 + 本机凭据文件 | ✅ DSH 设置里的「Add API Key」写入 `~/.dsh/.credentials.yaml` |
| 免费模型可用性 | 直连网关实测 | ✅ 仅 `longcat-2.5-preview-free` 可用；Zen 免费档 403；`minimax-*-free` 410 |

## 四、发布后 24 小时观察清单

1. 评论/私信里出现「dsh 不是内部命令」→ 文案没改干净，立刻置顶更正。
2. 「装完白屏」→ 最高危：让对方在 `~/.dsh/profiles/<profile>/package.json` 里临时删掉本插件依赖并重启，再把启动日志发来。
3. 「播报从来不出现」→ 让对方跑 `npm run verify:narrator`（在插件目录里），按输出定位是配置、密钥还是限流。
4. 「面板空的」→ 先确认播报插件是否安装、`progress-summary` 是否已配置模型。

## 五、后续值得做的工程改进（不在本次范围）

- **把 provider 默认值内置进插件**：用户装完即用，不再手写 YAML（消灭死因 3、4 的大半）。
- **面板空态分诊**：区分「没装播报插件」「装了但没配置模型」「配置了但被限流」，各给一句可操作提示。
- **模型自动降级**：`longcat` 不可用时自动切到候选免费模型，并在播报行里标注「已切换模型」。
- **发版冒烟脚本**：在隔离 profile 里装一遍、启动一次、断言 `every client entry activated`。
