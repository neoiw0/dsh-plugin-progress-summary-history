/**
 * 播报插件自身的用量报表：按"模型月额度"口径统计（不是账号额度）。
 *
 * 口径（重要）：
 *   - 数据源只用**本地可复核**的证据：会话文件里的 `plugin:progress-summary/line` 记录
 *     （每条 = 一条成功发布的播报），不读账号级 /usage 百分比（换账号后不可比）。
 *   - 花费 = 输入token × 该模型输入价 + 输出token × 该模型输出价。
 *   - 占比 = 花费 ÷ **该模型自己的月额度**（每个模型额度不同，见 MODELS）。
 *
 * 估算参数（都来自实测，改模型/改配置后需要重新标定）：
 *   - 每条播报约 1.04 次模型调用（实测 57 次调用 → 55 条发布）
 *   - 输入 token：P2 补丁前 ≈ 409/次（摘录 300 字）；P2 之后 ≈ 1000/次（摘录到 4000 字）
 *   - 输出 token：思考关闭时 ≈ 正文×0.56；思考开启时 ≈ 正文×3.5
 *
 * 用法：
 *   npm run usage:plugin              # 最近 30 天
 *   npm run usage:plugin -- --days 7  # 最近 7 天
 *   npm run usage:plugin -- --json    # 机器可读
 *   npm run usage:plugin -- --record  # 追加快照到 ~/.dsh/narrator-plugin-usage.jsonl
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'

/** zstd 帧魔数 0xFD2FB528（小端存放）。会话文件是多帧拼接，必须逐帧解压。 */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** 各模型的官方价目（美元/百万 token）与**该模型自己的月额度**。 */
const MODELS = {
  'glm-5.3-flash': { priceIn: 0.15, priceOut: 0.5, monthlyQuotaUsd: 60 },
  'deepseek-v4.1-flash': { priceIn: 0.15, priceOut: 0.6, monthlyQuotaUsd: 80 },
  'iceman-contributor-free': { priceIn: 0, priceOut: 0, monthlyQuotaUsd: 60, free: true },
}

/**
 * 历史阶段：不同时期用的模型/思考开关/摘录长度不同，换算参数随之不同。
 * `to: null` 表示"至今"。新增阶段时追加到数组末尾即可。
 */
const ERAS = [
  { from: '2026-10-22', to: '2026-10-27', model: 'glm-5.3-flash', thinking: true, excerptChars: 300 },
  { from: '2026-10-28', to: '2026-10-30', model: 'glm-5.3-flash', thinking: false, excerptChars: 300 },
  { from: '2026-10-31', to: null, model: 'iceman-contributor-free', thinking: false, excerptChars: 4000 },
]

const RECORD = 'plugin:progress-summary/line'
const SESSIONS = join(homedir(), '.dsh', 'sessions')
const SNAPSHOT = join(homedir(), '.dsh', 'narrator-plugin-usage.jsonl')
const CALLS_PER_LINE = 1.04
const OUTPUT_PER_CHAR = 0.56
const THINKING_FACTOR = 3.5

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const record = args.includes('--record')
const daysIndex = args.indexOf('--days')
const days = daysIndex >= 0 ? Number(args[daysIndex + 1]) || 30 : 30

/** 递归找出所有会话文件。 */
function sessionFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sessionFiles(path))
    else if (entry.name.startsWith('session') && entry.name.endsWith('.jsonl.zstd')) out.push(path)
  }
  return out
}

/**
 * 解压一个会话文件。
 * DSH 的会话是**多帧** zstd 拼接：单次 zstdDecompressSync 只解第一帧（会只剩一两行），
 * 所以按帧魔数切分后逐帧解压再拼接（实测与 Python zstandard.stream_reader 字节一致）。
 */
function readSessionText(path) {
  const buffer = readFileSync(path)
  const starts = []
  let index = buffer.indexOf(ZSTD_MAGIC)
  while (index !== -1) {
    starts.push(index)
    index = buffer.indexOf(ZSTD_MAGIC, index + 1)
  }
  if (starts.length === 0) return ''
  const parts = []
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1] : buffer.length
    try {
      parts.push(zlib.zstdDecompressSync(buffer.subarray(starts[i], end)))
    } catch {
      /* 单帧坏掉不影响其余帧 */
    }
  }
  return Buffer.concat(parts).toString('utf8')
}

/** 从一段会话文本里取出播报记录。 */
function extractRecords(text) {
  const out = []
  for (const line of text.split('\n')) {
    if (line.indexOf(RECORD) < 0) continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (parsed.type !== RECORD) continue
    const data = parsed.data || {}
    const at = data.at || parsed.time
    if (!at) continue
    out.push({ at, chars: String(data.line || '').length })
  }
  return out
}

/** 找出某天适用的阶段。 */
function eraFor(day) {
  for (const era of ERAS) {
    if (day >= era.from && (era.to === null || day <= era.to)) return era
  }
  return ERAS[ERAS.length - 1]
}

/** 本地日期（YYYY-MM-DD，东八区）。 */
function localDay(ms) {
  const date = new Date(ms + 8 * 3600 * 1000)
  return date.toISOString().slice(0, 10)
}

if (!existsSync(SESSIONS)) {
  console.error('找不到会话目录：' + SESSIONS)
  process.exit(2)
}
const cutoff = Date.now() - days * 86400 * 1000
const perDay = new Map()
let scanned = 0
for (const file of sessionFiles(SESSIONS)) {
  let stat
  try {
    stat = statSync(file)
  } catch {
    continue
  }
  if (stat.mtimeMs < cutoff) continue
  scanned += 1
  let text = ''
  try {
    text = readSessionText(file)
  } catch {
    continue
  }
  for (const item of extractRecords(text)) {
    const day = localDay(item.at)
    if (item.at < cutoff) continue
    const entry = perDay.get(day) || { lines: 0, chars: 0 }
    entry.lines += 1
    entry.chars += item.chars
    perDay.set(day, entry)
  }
}

if (perDay.size === 0) {
  console.log('最近 ' + days + ' 天没有播报记录（扫了 ' + scanned + ' 个会话文件）。')
  process.exit(0)
}

const rows = []
for (const day of [...perDay.keys()].sort()) {
  const { lines, chars } = perDay.get(day)
  const era = eraFor(day)
  const model = MODELS[era.model] || MODELS['glm-5.3-flash']
  const calls = Math.round(lines * CALLS_PER_LINE)
  const inputTokens = calls * (era.excerptChars >= 4000 ? 1000 : 409)
  const outputTokens = chars * (era.thinking ? THINKING_FACTOR : OUTPUT_PER_CHAR)
  const costUsd = model.free ? 0 : (inputTokens * model.priceIn + outputTokens * model.priceOut) / 1e6
  rows.push({
    day,
    lines,
    chars,
    calls,
    inputTokens,
    outputTokens,
    model: era.model,
    costUsd,
    quotaUsd: model.monthlyQuotaUsd,
    quotaPercent: (costUsd / model.monthlyQuotaUsd) * 100,
  })
}

const total = rows.reduce((acc, row) => {
  acc.lines += row.lines
  acc.chars += row.chars
  acc.calls += row.calls
  acc.inputTokens += row.inputTokens
  acc.outputTokens += row.outputTokens
  acc.costUsd += row.costUsd
  return acc
}, { lines: 0, chars: 0, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 })

// 总额度占比按"各阶段模型的额度"分别归集，避免把不同模型的额度混在一起
const byModel = new Map()
for (const row of rows) {
  const entry = byModel.get(row.model) || { costUsd: 0, quotaUsd: row.quotaUsd, calls: 0 }
  entry.costUsd += row.costUsd
  entry.calls += row.calls
  byModel.set(row.model, entry)
}

if (asJson) {
  console.log(JSON.stringify({ days, scanned, rows, total, byModel: Object.fromEntries(byModel) }, null, 2))
} else {
  console.log('=== 播报插件用量（按模型月额度口径）')
  console.log('  数据源：本地会话记录 ' + scanned + ' 个文件，统计最近 ' + days + ' 天')
  console.log('')
  console.log('日期         条数    正文   输入token  输出token      花费   模型                占该模型额度')
  for (const row of rows) {
    console.log(
      row.day + '  ' + String(row.lines).padStart(5) + '  ' + String(row.chars).padStart(6) +
      '  ' + String(row.inputTokens).padStart(9) + '  ' + String(Math.round(row.outputTokens)).padStart(9) +
      '  $' + row.costUsd.toFixed(4).padStart(8) + '  ' + row.model.padEnd(20) +
      '  ' + row.quotaPercent.toFixed(3) + '%',
    )
  }
  console.log('')
  console.log('=== 分模型汇总')
  for (const [model, entry] of byModel) {
    const info = MODELS[model] || {}
    console.log('  ' + model.padEnd(24) +
      ' 调用 ' + String(entry.calls).padStart(6) +
      ' 次 · 花费 $' + entry.costUsd.toFixed(4) +
      ' · 占月额度($' + entry.quotaUsd + ') ' + ((entry.costUsd / entry.quotaUsd) * 100).toFixed(3) + '%' +
      (info.free ? '（免费模型，花费恒为 0）' : ''))
  }
  console.log('')
  console.log('  合计：' + total.lines + ' 条播报 / ' + total.calls + ' 次调用 / $' + total.costUsd.toFixed(4))
  console.log('')
  console.log('说明：')
  console.log('  · 条数来自会话里的播报记录，可逐条复核；调用数按实测 1.04 倍换算')
  console.log('  · 输入 token 按实测标定（摘录 300 字≈409，4000 字≈1000/次）')
  console.log('  · 输出 token 按实测标定（思考关：正文×0.56；思考开：×3.5）')
  console.log('  · 占比分母是**该模型自己的月额度**，不涉及账号级额度（换账号不影响本表）')
}

if (record) {
  appendFileSync(SNAPSHOT, JSON.stringify({
    at: new Date().toISOString(),
    days,
    total,
    byModel: Object.fromEntries(byModel),
    rows,
  }) + '\n', 'utf8')
  console.log('\n已追加快照 → ' + SNAPSHOT)
}
