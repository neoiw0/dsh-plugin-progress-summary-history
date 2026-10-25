# 发布流程与实况

> 已完成的真实结果（2026-10-24）：
> - 仓库：https://github.com/neoiw0/dsh-plugin-progress-summary-history
> - Release：https://github.com/neoiw0/dsh-plugin-progress-summary-history/releases/tag/v0.1.4
> - tgz 附件：`dsh-plugin-progress-summary-history-0.1.4.tgz`（124,720 字节）
> - npm：待登录后执行 `npm publish`（本机无 npm 凭据）

# 发布清单（v0.1.3）

> 目标：把插件作为**独立开源包**发布到 npm，并在 GitHub 建一个公开仓库承接源码与 issue。
> 本机已经准备好：本地 git 仓库、提交、`v0.1.3` 标签、可发布 tarball（`dsh-plugin-progress-summary-history-0.1.3.tgz`）。
> **只有两步需要你的账号**：`npm login` 与 GitHub 推送。

## 一、命名（已核实未被占用）

- npm 包名：**`dsh-plugin-progress-summary-history`**（2026-10-23 查 registry，HTTP 404＝可用）
- GitHub 仓库名：`dsh-plugin-progress-summary-history`
- 模块 id（`client.js` 里注册的）：`dsh-plugin-progress-summary-history`
- patch 行 id（`cordis.patch.yml`）：`progress-history`

为什么用这个名字：

1. DSH 生态的第三方插件普遍用 `dsh-` 前缀（`dsh-ops`、`dsh-progress-summary`、`dsh-idle-compaction`…），用户一眼知道是 DSH 插件；
2. `progress-history` 描述的是**它解决的事**（把播报存下来并成列表），比 `progress-panel`（只说形态）更耐改；
3. 不带 scope，安装命令最短：`pnpm add dsh-plugin-progress-summary-history`。

若你想用自己的 scope（例如 `@neoiw0/dsh-plugin-progress-summary-history`），只需改 `package.json` 的 `name`，其余不变；代价是安装命令变长。

## 二、发布到 npm

```bash
cd "D:\GGGGG\Normal Work\dsh-remote\local-bundles\dsh-plugin-progress-summary-history"

# 1) 登录（二选一）
npm login            # 浏览器/一次性密码流程
npm login --auth-type=web

# 2) 发布（0.1.3 是首个公开版本；--access public 对无 scope 包可省略）
npm publish

# 3) 验证
npm view dsh-plugin-progress-summary-history version
npm view dsh-plugin-progress-summary-history dist.tarball
```

发布前自检（都应通过）：

```bash
npm run check     # 15 项断言
npm run doctor    # 只读体检：安装一致性 / 播报是否在产出 / 最近启动是否失败
```

## 三、建 GitHub 仓库并推送

```bash
# 方式 A：装了 gh（推荐）
gh auth login
gh repo create dsh-plugin-progress-summary-history --public --source=. --remote=origin --push
git push origin v0.1.3

# 方式 B：网页建空仓库后
git remote add origin https://github.com/neoiw0/dsh-plugin-progress-summary-history.git
git branch -M main
git push -u origin main
git push origin v0.1.3
```

然后在 GitHub 上建 Release：选标签 `v0.1.3`，标题 `v0.1.3`，正文贴 `CHANGELOG.md` 的 0.1.3 段，**附件上传** `dsh-plugin-progress-summary-history-0.1.3.tgz`（方便不装 npm 的人直接下载）。

## 四、发布后建议补的三件事

1. `README.md` 顶部加上 npm 徽章与安装命令；
2. 在 DSH 社区/文档里登记一行（若上游有插件列表）；
3. 把 `docs/upstream-contract-pr.md` 的内容作为**上游 README 补丁**提交 PR（它描述的是播报记录契约 `plugin:progress-summary/line`，与本包独立发布不冲突）。

## 五、万一要回滚

```bash
# 撤销某个版本（发布后 72 小时内、且无其他包依赖它）
npm unpublish dsh-plugin-progress-summary-history@0.1.3

# 或把该版本标记为弃用（推荐，已安装的用户会看到提示）
npm deprecate dsh-plugin-progress-summary-history@0.1.3 "该版本存在已知问题，请升级到 0.1.4"
```
