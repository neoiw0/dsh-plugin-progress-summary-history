/**
 * 用量核对报告：把「官方额度接口」与「本地播报调用记录」合起来看。
 *
 * 用法：
 *   node scripts/usage-report.mjs            # 看当前额度 + 今天的播报用量估算
 *   node scripts/usage-report.mjs --record   # 顺便把这次额度快照存进 ~/.dsh/narrator-usage.jsonl
 *   node scripts/usage-report.mjs --days 7   # 统计最近 7 天的播报调用
 *
 * 数据来源（都可复核）：
 *   1) 官方额度：GET https://opencode.ai/zen/go/v1/usage
 *      返回 rolling / weekly / monthly 三个窗口的已用百分比与重置时间（账号级，含所有模型）。
 *   2) 本地调用：~/.dsh/progress-summary-debug.log
 *      每行 prepareCall / stream done 就是一次播报调用与其输出字符数。
 *
 * 为什么需要估算：官方接口只给百分比（整数），播报单次成本极小（约 $0.000027），
 * 攒到 1% 需要两万多次调用，所以单看百分比看不出播报的份额；本地调用次数 + 实测单价
 * 才是能复核的口径。两者一起给，谁都能自己验算。
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
const CREDENTIALS = join(homedir(), '.dsh', '.credentials.yaml')
const DEBUG_LOG = join(homedir(), '.dsh', 'progress-summary-debug.log')
const SNAPSHOT = join(homedir(), '.dsh', 'narrator-usage.jsonl')
const SESSION_ID = process.env.OPENCODE_SESSION_ID || 'dsh-plugin-progress-summary-history'

/** 实测标定值（2026-10-27，glm-5.3-flash + effort:off，连测 4 次）： */
const CALIBRATION = {
  model: 'glm-5.3-flash',
  promptTokens: 102,      // 每次输入 token（固定 system + 短 user）
  completionPerChar: 0.56, // 输出 token / 正文字符（实测 38~42 字 → 19~23 token）
  priceIn: 0.15,           // 美元 / 百万输入 token（Go 计划官方价目）
  priceOut: 0.5,           // 美元 / 百万输出 token
  monthlyQuotaUsd: 60,     // Go 计划该模型的月额度（官方价目表 Monthly limit）
}

const args = process.argv.slice(2)
const record = args.includes('--record')
const daysIndex = args.indexOf('--days')
const days = daysIndex >= 0 ? Number(args[daysIndex + 1]) || 1 : 1

function readKey() {
  if (process.env.OPENCODE_GO_API_KEY) return process.env.OPENCODE_GO_API_KEY
  try {
    const text = readFileSync(CREDENTIALS, 'utf8')
    const match = text.match(/OPENCODE_GO_API_KEY\s*:\s*["']?([^"'\s]+)/)
    return match ? match[1] : ''
  } catch {
    return ''
  }
}

async function fetchUsage() {
  const response = await fetch(USAGE_URL, {
    headers: {
      Authorization: 'Bearer ' + readKey(),
      'x-opencode-session': SESSION_ID,
    },
  })
  if (!response.ok) throw new Error('额度接口失败：HTTP ' + response.status)
  const data = await response.json()
  return data.usage || {}
}

/** 从本地日志里数出每天的调用次数与输出字符总数。 */
function readCalls() {
  const result = new Map()
  if (!existsSync(DEBUG_LOG)) return result
  const lines = readFileSync(DEBUG_LOG, 'utf8').split(String.fromCharCode(10))
  for (const line of lines) {
    if (!line.startsWith('202')) continue
    const day = line.slice(0, 10)
    const bucket = result.get(day) || { calls: 0, chars: 0, empty: 0, ok: 0 }
    if (line.includes('prepareCall ok')) bucket.calls += 1
    const match = line.match(/stream done chars=(\d+)/)
    if (match) {
      const size = Number(match[1])
      bucket.chars += size
      if (size === 0) bucket.empty += 1
      else bucket.ok += 1
    }
    result.set(day, bucket)
  }
  return result
}

const usage = await fetchUsage()
const calls = readCalls()

/** 日志首行是启动头：说明日志每次重启会被重置，统计窗口从那时开始。 */
function logWindow() {
  if (!existsSync(DEBUG_LOG)) return '(没有日志)'
  const first = readFileSync(DEBUG_LOG, 'utf8').split(String.fromCharCode(10))[0] || ''
  const match = first.match(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)
  if (!match) return '(未知)'
  return '自 ' + new Date(match[1]).toLocaleString('zh-CN') + ' 起（每次重启会重置）'
}

console.log('=== 官方额度（账号级，含所有模型）')
for (const [name, label] of [['rolling', '滚动窗口'], ['weekly', '本周'], ['monthly', '本月']]) {
  const item = usage[name]
  if (!item) continue
  const resets = item.resetsAt ? new Date(item.resetsAt).toLocaleString('zh-CN') : '(未知)'
  console.log('  ' + label.padEnd(8) + ' 已用 ' + String(item.percent).padStart(3) + '%   重置于 ' + resets)
}

console.log('')
console.log('=== 播报调用（本地日志，最近 ' + days + ' 天）')
console.log('  日志覆盖：' + logWindow())
const dayList = [...calls.keys()].sort().slice(-days)
let totalCalls = 0
let totalChars = 0
let totalOk = 0
let totalEmpty = 0
for (const day of dayList) {
  const bucket = calls.get(day)
  totalCalls += bucket.calls
  totalChars += bucket.chars
  totalOk += bucket.ok || 0
  totalEmpty += bucket.empty || 0
  console.log('  ' + day + '  调用 ' + String(bucket.calls).padStart(4) + ' 次（成功 ' +
    String(bucket.ok || 0).padStart(3) + ' / 空 ' + String(bucket.empty || 0).padStart(3) +
    '）  输出 ' + String(bucket.chars).padStart(6) + ' 字')
}
if (dayList.length === 0) console.log('  (日志里没有调用记录)')

const completionTokens = Math.round(totalChars * CALIBRATION.completionPerChar)
const promptTokens = totalCalls * CALIBRATION.promptTokens
const cost = (promptTokens * CALIBRATION.priceIn + completionTokens * CALIBRATION.priceOut) / 1e6

console.log('')
console.log('=== 播报用量估算（可复核）')
console.log('  调用次数        ' + totalCalls + ' 次')
console.log('  输入 token      ' + promptTokens + '（每次按实测 ' + CALIBRATION.promptTokens + ' 计）')
console.log('  输出 token      ' + completionTokens + '（输出 ' + totalChars + ' 字 × ' + CALIBRATION.completionPerChar + '）')
const costLower = (totalOk * CALIBRATION.promptTokens * CALIBRATION.priceIn +
  Math.round(totalChars * CALIBRATION.completionPerChar) * CALIBRATION.priceOut) / 1e6
console.log('  估算花费        $' + costLower.toFixed(6) + ' ~ $' + cost.toFixed(6) +
  '  ≈ ' + (costLower * 7.1).toFixed(3) + ' ~ ' + (cost * 7.1).toFixed(3) + ' 元')
console.log('  区间含义        下界＝只算成功出文的调用；上界＝把被中断的空调用也按满额算')
console.log('  占月额度        ' + ((cost / CALIBRATION.monthlyQuotaUsd) * 100).toFixed(4) + '%（月额度 $' + CALIBRATION.monthlyQuotaUsd + '）')
console.log('  换算            月额度的 1% ≈ $' + (CALIBRATION.monthlyQuotaUsd / 100).toFixed(2) + ' ≈ ' +
  Math.round((CALIBRATION.monthlyQuotaUsd / 100) / (cost / Math.max(totalCalls, 1))) + ' 次播报')

if (record) {
  const snapshot = {
    at: new Date().toISOString(),
    usage,
    calls: Object.fromEntries(dayList.map((day) => [day, calls.get(day)])),
    estimate: { calls: totalCalls, promptTokens, completionTokens, costUsd: Number(cost.toFixed(6)) },
  }
  appendFileSync(SNAPSHOT, JSON.stringify(snapshot) + String.fromCharCode(10), 'utf8')
  console.log('')
  console.log('已追加额度快照 → ' + SNAPSHOT)
}

console.log('')
console.log('核对方法：过一段时间再跑一次本脚本，用两次的 monthly 百分比差值 ÷ 期间的播报估算成本，')
console.log('就能看出播报占多少；差值里绝大部分来自会话主模型（deepseek），不是播报。')
