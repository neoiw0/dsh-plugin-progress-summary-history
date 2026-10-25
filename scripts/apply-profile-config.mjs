/**
 * profile 配置自愈：把「播报专用 provider」和「播报插件配置行」补回 DSH 的 profile patch。
 *
 * 背景：这两块曾被别的流程整体重置过，症状是 composer 上方的播报行消失、
 * 日志里 `stream done chars=0`。手写 YAML 容易出错，所以收敛成一条命令。
 *
 * 用法：
 *   node scripts/apply-profile-config.mjs            # 只检查，报告缺什么
 *   node scripts/apply-profile-config.mjs --fix      # 缺什么补什么（写入前自动备份）
 *   node scripts/apply-profile-config.mjs --fix --dry-run
 *   DSH_PROFILE_DIR=<副本目录> node scripts/apply-profile-config.mjs   # 自测用
 *
 * 实现注意：本文件刻意不用反斜杠转义（换行与判断一律用 split/join 与 String.fromCharCode），
 * 以免经过某些命令通道时被折叠成真实换行而破坏语法。
 */
import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = new Set(process.argv.slice(2))
const fix = args.has('--fix')
const dryRun = args.has('--dry-run')
const profile = process.env.DSH_PROFILE_DIR || join(homedir(), '.dsh', 'profiles', 'desktop')
const patchPath = join(profile, 'cordis.patch.yml')

const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)

// 写死会把「某台机器的值」带进公开包。需要时用环境变量 OPENCODE_SESSION_ID 自行指定。
const PROVIDER_BLOCK = `      opencode-go-free:
        displayName: 播报专用（OpenCode Go 免费档）
        api: openai-completions
        baseURL: https://opencode.ai/zen/go/v1
        apiKeyEnv: OPENCODE_GO_API_KEY
        models:
          - id: longcat-2.5-preview-free
            name: LongCat 2.5 Preview（免费）
            contextWindow: 1000000
`

const PLUGIN_BLOCK = `
# 播报（进度摘要）：必须用免费模型。2026-10-24 实测：minimax-m3.1-flash-free 已 410 弃用；
# Zen 免费档全部 403（只允许 OpenCode 客户端内部调用）；beam-free 在部分地区 403；
# 可用的是 longcat-2.5-preview-free（go 端点 200，5-6 秒稳定出文，价格 0/0）。
# 它有突发限流（约每 15 秒 3 次，超了返回 429 Endpoint is unavailable，适配器会吞成空文本），
# 所以 minIntervalMs 设为 45000，稳稳落在免费额度内。
# 注意：模型条目**不要**写 reasoningEfforts——会让适配器按“会思考”占满输出额度，正文变空。
- id: progress-summary
  name: 'dsh-progress-summary'
  config:
    provider: opencode-go-free
    model: longcat-2.5-preview-free
    effort: 'low'
    lang: zh
    maxTokens: 256
    excerptChars: 300
    timeoutMs: 25000
    minIntervalMs: 45000
    minTokens: 600
`

const toEol = (block, eol) => (eol === LF ? block : block.split(LF).join(eol))

const raw = readFileSync(patchPath, 'utf8')
const eol = raw.includes(CR + LF) ? CR + LF : LF
const lines = raw.split(eol)
const report = []

const providerIndex = lines.findIndex((line) => line.trim() === 'opencode-go-free:')
const anchorIndex = lines.findIndex((line) => line.trim() === 'opencode-go:')
if (providerIndex >= 0) {
  report.push('provider 块 opencode-go-free 已存在')
} else if (anchorIndex < 0) {
  report.push('缺少 provider 块 opencode-go-free，且找不到锚点 opencode-go:（需手工补）')
} else {
  report.push('缺少 provider 块 opencode-go-free（播报路由找不到模型）')
  if (fix) lines.splice(anchorIndex + 1, 0, ...toEol(PROVIDER_BLOCK, eol).split(eol))
}

const hasPluginRow = lines.some((line) => line.trim() === '- id: progress-summary')
if (hasPluginRow) {
  report.push('progress-summary 配置行已存在')
} else {
  report.push('缺少 progress-summary 配置行（播报会退回会话模型，通常得到空文本）')
  if (fix) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    lines.push(...toEol(PLUGIN_BLOCK, eol).split(eol))
  }
}

const missing = report.filter((item) => item.startsWith('缺少'))
const changed = fix && missing.length > 0
for (const line of report) console.log((changed ? '[fix] ' : '[check] ') + line)

if (changed) {
  const text = lines.join(eol).replace(/[ \t]+$/gm, '') + eol
  if (dryRun) {
    console.log('[dry-run] 未写入；实际会写入 ' + patchPath)
  } else {
    const backup = patchPath + '.bak-configfix-' + Date.now()
    copyFileSync(patchPath, backup)
    const temp = patchPath + '.tmp-configfix'
    writeFileSync(temp, text, 'utf8')
    renameSync(temp, patchPath)
    console.log('已写入 ' + patchPath)
    console.log('备份 ' + backup)
  }
} else if (fix) {
  console.log('无需修改')
}

process.exitCode = missing.length === 0 || changed ? 0 : 1
