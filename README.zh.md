# dsh-plugin-progress-summary-history

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）右侧栏加一个
**「进度历史」面板**：把当前会话里所有进度播报按时间列出来，最新一条加粗。

社区插件，与 DSH 官方无关。

## 它和 dsh-progress-summary 的关系

```
dsh-progress-summary（另一个插件，MIT）  每跑一段写一条记录
        └─▶ 会话记录 plugin:progress-summary/line
                    └─▶ 本插件折叠成投影 progressHistory
                                └─▶ 右侧栏「进度历史」面板
```

- **必须先装** [`dsh-progress-summary`](https://github.com/tastynoob/dsh-progress-summary)，否则面板会是空的（会给出提示，不会报错）。
- 本插件**不复制**上游代码，只读它写下的记录类型；也不改写会话内容、不注入任何面向模型的内容。

## 安装

装进某个 profile（桌面版用应用内插件管理器，命令行直改会和它冲突）：

```sh
dsh plugin --profile web add dsh-plugin-progress-summary-history
```

从 GitHub Release 的固定 tag 安装：

```sh
dsh plugin --profile web add "https://github.com/neoiw0/dsh-plugin-progress-summary-history/releases/download/v0.1.3/dsh-plugin-progress-summary-history-0.1.3.tgz"
```

装完重启该 profile。

## 使用

![面板效果](docs/panel.png)

面板规则：

- **时间正序**：最上面最老，最下面最新；新播报到达自动滚到底部。
- **字号分档**：最新一条比正文大 2 号并加粗，次新大 1 号，其余为基础字号。
- **重点着色（扫读优先）**：每行最多强调 3 处——1 个状态词（蓝=进行中 / 绿=已完成 / 红=需注意）＋ 2 个量或标识符（数字加粗、文件与命令用等宽弱紫），其余保持正文色。
- **时间**：相对显示（刚刚 / N 分钟前 / N 小时前），悬停可看精确时刻；最新一条左侧有蓝色竖线。


1. 打开会话的右侧栏；
2. 点标签条的「+」，引导页里选 **「进度历史」**；
3. 面板按时间正序列出本会话的播报，最新一条最大且加粗。

面板是会话级投影，**切换会话会自动跟着换**，不需要刷新。

## 兼容性

- 声明支持 DSH `0.2.1-rc.2`（`dsh.compatibility.dshReleases`）。
- 依赖上游插件的数据格式；上游若改记录名或字段，本插件需要同步升级。
- 无配置项。

## 限制

- 只读：没有搜索、没有复制按钮、没有导出。
- 只显示进度播报，不显示思考过程。
- 上游插件缺席时显示空状态提示。

## 卸载

```sh
dsh plugin --profile web remove dsh-plugin-progress-summary-history
```

## 许可

MIT，见 `LICENSE`；数据来源声明见 `NOTICE`。

## 安装与升级注意（重要）

这个插件的客户端半边（`client.js`）会和其它客户端插件打进同一批脚本：**它加载失败会把整批带崩**，表现是窗口卡在「Loading plugins…」或弹出「应用无法启动」。

因此安装/升级时请遵守两条：

1. **不要在 DSH 运行时直接把文件写进 profile 的 `node_modules`**。复制过程若被热重载读到半截文件，就会触发上面的崩溃。正确做法是先写到同目录临时文件，再原子改名（`mv` 覆盖），或干脆关掉应用再复制。
2. 改完先跑 `npm run check`（15 项，含"一行最多 3 处强调"与"引导入口 title/description 必须是函数"的回归断言），再装。

万一真的崩了：错误对话框里点「重启」即可恢复（文件此时已是一致的）；若仍失败，把 `package.json` 的 `dsh.profile.bundles` 里 `dsh-plugin-progress-summary-history` 暂时去掉，重载后再加回。

## 防复发：三条护栏（2026-10-24 事故后新增）

1. **不要往运行中的 profile 里复制文件**。改为装 tarball 快照：
   ```bash
   npm pack
   # profile 的依赖写成 file:<绝对路径>/dsh-plugin-progress-summary-history-<版本>.tgz
   pnpm install
   ```
   源码目录与运行中的应用解耦，改源码不再触发热重载。
2. **装之前跑 `npm run check`（20 项）**，其中三条静态断言正是当天两次启动失败的根因：
   - 客户端 `__ModuleLoader__.load({ id })` 必须等于包名（否则 duplicate factory registration）；
   - `cordis.patch.yml` 的行 `name` 必须等于包名；
   - 投影必须声明 `wire: { viewSchema, view }`（否则宿主不外发，面板永远空白）。
3. **profile 配置可自愈**：`npm run config:check` 只报告，`npm run config:fix` 幂等补回
   provider 块与播报配置行（写入前自动备份）。这两块曾被别的流程整体重置，症状是播报行消失。

## 播报（bar）用哪个模型：免费档已全线阵亡，实测最省的是 GLM-5.3-Flash

2026-10-27 实测：**没有任何可用的免费模型**，已切换到付费但极便宜的 `glm-5.3-flash`。

| 免费模型 | 状态 |
|---|---|
| `longcat-2.5-preview-free` | HTTP 410 已下线（前一天还能用） |
| `beam-free` / `muse-spark-*-contributor` | HTTP 403 锁区 |
| `iceman-contributor-free` | HTTP 503 上游不可用 |
| `deepseek-v4.1-flash-free` | 免费额度用尽 / 仅 OpenCode 官方客户端 |
| Zen 免费档（`public` 密钥） | HTTP 403 |

### 为什么是 GLM-5.3-Flash（实测，不是看价目表猜的）

用播报真实的 prompt（约 130 输入 token、256 token 预算）逐个打表：

| 模型 | 思考字符 | 耗时 | 每次成本 | 月额度 | 结论 |
|---|---|---|---|---|---|
| **glm-5.3-flash** | **0** | **2.4s** | **$0.000026** | $60 | ✅ 唯一不思考、最快、最便宜 |
| mimo-v2.6-flash | 190 | 3.5s | $0.000034 | $60 | 思考型 |
| deepseek-v4.1-flash | 225 | 2.6s | $0.000060 | $80 | 思考型，贵 2.3 倍 |
| qwen3.8-flash | 333 | 4.7s | $0.00012 | $30 | 思考吃太多 |
| hy3 / minimax-m3.1-flash | 256/559 | 7.4/8.0s | — | — | 思考吃光预算，正文 0 字 |

三个容易踩的判断错误：

1. **「DeepSeek 月额度 $80 所以更划算」不成立**：GLM 也有 $60（同样是 $10 订阅的杠杆），只差 1.33 倍；
   而 DeepSeek 的 `reasoning_effort: off` **关不掉思考**（实测仍思考 209 字），思考 token 按输出价计费，实测每次贵 2.3 倍。
2. **「缓存读便宜 10 倍」对我们无效**：实测同一请求连发两次，`cached_tokens` 都是 **0**。
   原因：整条 prompt 只有 113~130 token（低于缓存门槛），且可变部分在后面。
3. **官网的「预估请求数」不能直接套用**：那是按编码 agent 画像算的
   （DeepSeek 每次 410 输入 + **71,300 缓存** + 310 输出），播报没有缓存、prompt 极小，结论会反过来。

### GLM 能不能关掉思考（字段级证据）

| `reasoning_effort` | 思考字符 | 返回字段 |
|---|---|---|
| 不传 | 0 | 有 `reasoning_content` 但为空 |
| `off` | 0 | **连 `reasoning_content` 都不返回** |
| `high` | 32 | 出现 `reasoning` 字段（说明能思考，只是默认不思考） |

所以配置里保持 `effort: 'off'` 即可确定性关闭思考。


### 用量怎么核对（月额度）

官方提供额度接口，本地提供调用记录，两边都能复核：

```bash
npm run usage           # 当前额度 + 最近 1 天的播报用量估算
npm run usage:record    # 顺便存一份快照到 ~/.dsh/narrator-usage.jsonl
npm run usage -- --days 7
```

官方接口 `GET https://opencode.ai/zen/go/v1/usage` 返回三个窗口的已用百分比（账号级，含所有模型）：

```
rolling  滚动窗口   weekly 本周   monthly 本月
```

本地日志 `~/.dsh/progress-summary-debug.log` 里每个 `prepareCall` 就是一次播报调用。

**估算口径**（2026-10-27 实测标定，`glm-5.3-flash` + `effort: off`，连测 4 次）：

| 量 | 取值 | 来源 |
|---|---|---|
| 输入 token / 次 | 102 | 实测 `usage.prompt_tokens` |
| 输出 token / 字 | 0.56 | 实测 38~42 字 → 19~23 token |
| 输入价 / 输出价 | $0.15 / $0.50 每百万 | 官方价目（Go 计划） |
| 月额度 | $60 | 官方价目 Monthly limit |

**基线（2026-10-27 记录）**：月额度已用 **48%**（11-17 重置）；当日 48 次播报（成功 27 / 空 20）、1104 字、
约 **$0.00072 ~ $0.00104（0.005~0.007 元）**，占月额度 **0.0017%**——换算下来，月额度的 1% ≈ **27,600 次播报**。

两个口径细节（都会影响核对）：

1. **本地日志每次重启会重置**（首行是启动头），所以统计窗口只覆盖本次运行；跨重启要用 `--record` 存的快照累计。
2. **约四成调用是空的**：插件在回合结束时会中断在途请求（设计如此，避免过时播报），日志记成 `chars=0`。
   所以成本给区间：下界只算成功出文的，上界把空调用也按满额算。

所以：**播报的消耗在账号总额度里基本是四舍五入级别的**，月度百分比的变化几乎全部来自会话主模型。

### 换模型怎么做

改 `cordis.patch.yml` 两处（provider 的 `models` 列表 + `progress-summary` 的 `model`），**重启 DSH**。
换之前先用探测器确认现状：

```bash
npm run probe:free          # 只测名字带 free 的
npm run probe:free -- --all # 连付费的一起测
```

### 其它两个坑（与模型无关）

- **网关强制要求 `x-opencode-session` 请求头**，缺了直接 `400 Request is missing x-opencode-session`。
  provider 块里必须有 `headers: { x-opencode-session: <任意本地标识> }`。
- **profile 配置的换行符可能混用**（CRLF + LF）。`npm run config:check` 已能正确处理混用，
  但如果你手改过文件，跑一次 `config:check` 确认没误报。
