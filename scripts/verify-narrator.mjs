/**
 * 播报链路体检：从宿主调试日志里读出「配置是否生效 / 模型是否出文 / 是否发布了播报行」。
 *
 * 用法：node scripts/verify-narrator.mjs
 * 只读，不写任何文件。退出码 0 表示链路正常，1 表示有问题（并给出下一步动作）。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const LOG = join(homedir(), '.dsh', 'progress-summary-debug.log')
const PATCH = join(homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')

/** 读 profile 里实际的播报间隔，避免脚本写死期望值后误报。 */
function readInterval() {
  try {
    const lines = readFileSync(PATCH, 'utf8').split(String.fromCharCode(10))
    const start = lines.findIndex((line) => line.trim() === '- id: progress-summary')
    if (start < 0) return '45000'
    for (let index = start; index < Math.min(start + 20, lines.length); index += 1) {
      const match = lines[index].match(/minIntervalMs:\s*(\d+)/)
      if (match) return match[1]
      if (index > start && lines[index].trim().startsWith('- id:')) break
    }
  } catch {
    /* 读不到就退回默认值 */
  }
  return '45000'
}
const MAX_GAP_MINUTES = 30

let text = ''
try {
  text = readFileSync(LOG, 'utf8')
} catch (error) {
  console.log('FAIL  读不到日志 ' + LOG)
  console.log('      先确认 dsh-progress-summary 已装入 profile，并重启过一次应用。')
  process.exit(1)
}

const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
const pickLast = (predicate) => {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (predicate(lines[index])) return lines[index]
  }
  return null
}
const stampOf = (line) => {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)
  return match ? match[1] : null
}
const minutesAgo = (line) => {
  const stamp = stampOf(line)
  if (!stamp) return null
  const at = Date.parse(stamp)
  return Number.isFinite(at) ? Math.round((Date.now() - at) / 60000) : null
}

const apply = pickLast((line) => line.includes('apply provider='))
const call = pickLast((line) => line.includes('prepareCall ok'))
const stream = pickLast((line) => line.includes('stream done chars='))
const publish = pickLast((line) => line.includes('publish record'))

const rows = []
const add = (status, label, detail) => rows.push({ status, label, detail })

if (apply) {
  const interval = (apply.match(/interval=(\d+)/) || [])[1]
  const effort = (apply.match(/effort=(\w+)/) || [])[1]
  const model = (apply.match(/model=([\w.\-]+)/) || [])[1]
  const expectedInterval = process.env.EXPECTED_INTERVAL || readInterval()
  add(interval === expectedInterval ? 'OK' : 'STALE', 'config', 'model=' + model + ' effort=' + effort + ' interval=' + interval + '（期望 ' + expectedInterval + '）')
} else {
  add('FAIL', 'config', '日志里没有 apply 记录，插件可能未挂载')
}

if (call) {
  const age = minutesAgo(call)
  add('OK', 'model call', '最近一次调用 ' + (age === null ? '' : age + ' 分钟前') + '：' + call.replace(/^\S+Z\s*/, ''))
} else {
  add('WAIT', 'model call', '尚未触发调用（需要 agent 持续思考到阈值：默认 200 tokens）')
}

let lastGoodLine = ''
if (publish) {
  const published = (publish.match(/line="(.*)"$/) || [])[1] || ''
  if (published !== '') lastGoodLine = published
}

if (stream) {
  const chars = Number((stream.match(/chars=(\d+)/) || [])[1] || 0)
  if (chars > 0) {
    add('OK', 'model output', 'chars=' + chars)
  } else if (lastGoodLine !== '') {
    // 免费模型有突发限流：超限时上游 429，适配器吞成空文本。上一次成功出文即说明链路没坏。
    add('WARN', 'model output', '最近一次 chars=0（多半是免费额度被限流，429），上一次已成功出文')
  } else {
    add('FAIL', 'model output', 'chars=0 且从未成功出文：先跑 npm run config:fix，再查 provider/api/effort')
  }
}

if (publish) {
  const state = (publish.match(/state=(\w+)/) || [])[1]
  const line = (publish.match(/line="(.*)"$/) || [])[1] || ''
  add(line !== '' ? 'OK' : 'INFO', 'publish', 'state=' + state + ' 内容=' + (line === '' ? '（空，空闲时会这样）' : line.slice(0, 60)))
}

const width = Math.max(...rows.map((row) => row.label.length))
for (const row of rows) console.log(row.status.padEnd(6) + row.label.padEnd(width + 2) + row.detail)

const bad = rows.filter((row) => row.status === 'FAIL' || row.status === 'STALE')
const warned = rows.filter((row) => row.status === 'WARN')
if (bad.length === 0) {
  console.log('\n结论：播报链路正常（若界面仍无播报行，看是否处于空闲状态——空闲时按设计不显示）')
  process.exit(0)
}
console.log('\n结论：播报链路有问题')
for (const row of bad) {
  if (row.label === 'config' && row.status === 'STALE') console.log('- 配置未生效：重启一次应用（配置不会热更新）')
  if (row.label === 'model output') console.log('- 模型空输出且从未成功：先跑 npm run config:fix 确认配置齐全，再核对 provider/api/effort')
}
process.exit(1)
