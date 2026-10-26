/**
 * 免费模型探测器：把 OpenCode Go 网关上「看起来免费」的模型逐个打一遍，
 * 报告它们现在到底能不能用（200 出文 / 410 已下线 / 403 锁区 / 503 上游挂了）。
 *
 * 用法：
 *   node scripts/probe-free-models.mjs
 *   node scripts/probe-free-models.mjs --model xxx-free        # 只测指定模型
 *   node scripts/probe-free-models.mjs --all                   # 连付费模型一起测（只读，不产生明显费用）
 *
 * 密钥来源：~/.dsh/.credentials.yaml 里的 OPENCODE_GO_API_KEY，或环境变量同名。
 * 本脚本只读、不打印密钥、不改配置。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = 'https://opencode.ai/zen/go/v1'
const SESSION_HEADER = 'x-opencode-session'
const CREDENTIALS = join(homedir(), '.dsh', '.credentials.yaml')

/** 网关现在强制要求会话头，缺了直接 400。这里固定用一个本地标识即可。 */
const SESSION_ID = process.env.OPENCODE_SESSION_ID || 'dsh-plugin-progress-summary-history'

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

async function call(path, init) {
  const key = readKey()
  const response = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: 'Bearer ' + key,
      [SESSION_HEADER]: SESSION_ID,
      ...(init && init.headers ? init.headers : {}),
    },
  })
  return response
}

/** 列出模型 id。 */
async function listModels() {
  const response = await call('/models', { method: 'GET' })
  if (!response.ok) throw new Error('列模型失败：HTTP ' + response.status)
  const data = await response.json()
  return (data.data || data.models || []).map((item) => item.id || item.name).filter(Boolean)
}

/** 打一次真实请求，返回 { status, chars, error }。 */
async function probe(model) {
  const body = JSON.stringify({
    model,
    max_tokens: 48,
    stream: true,
    messages: [{ role: 'user', content: '用一句中文说明你在做什么' }],
  })
  const response = await call('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  const text = await response.text()
  let chars = 0
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (payload === '' || payload === '[DONE]') continue
    try {
      const chunk = JSON.parse(payload)
      const delta = ((chunk.choices || [{}])[0] || {}).delta || {}
      if (typeof delta.content === 'string') chars += delta.content.length
    } catch {
      /* 非 JSON 行忽略 */
    }
  }
  const errorMatch = text.match(/"message"\s*:\s*"([^"]{0,120})/)
  return { status: response.status, chars, error: errorMatch ? errorMatch[1] : '' }
}

/** 给人看的结论。 */
function verdict(result) {
  if (result.chars > 0) return '可用'
  if (result.status === 200) return '200 但无正文（可能是思考模型）'
  if (result.status === 410) return '已下线'
  if (result.status === 403) return '无权限/锁区'
  if (result.status === 503) return '上游暂不可用'
  if (result.status === 400) return '请求被拒'
  return '未知'
}

const args = process.argv.slice(2)
const onlyIndex = args.indexOf('--model')
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : ''
const includePaid = args.includes('--all')

const key = readKey()
if (!key) {
  console.error('找不到 OPENCODE_GO_API_KEY（既不在环境变量，也不在 ' + CREDENTIALS + '）')
  process.exit(2)
}

const models = only ? [only] : await listModels()
const candidates = only || includePaid ? models : models.filter((id) => /free/i.test(id))

if (candidates.length === 0) {
  console.log('网关当前没有任何名字里带 free 的模型。')
  console.log('可加 --all 看全部模型，或用 --model <id> 单独测一个。')
  process.exit(0)
}

console.log('探测 ' + candidates.length + ' 个模型（密钥已读取，不打印）\n')
let usable = []
for (const model of candidates) {
  const result = await probe(model)
  const line = '  ' + model.padEnd(30) + ' HTTP ' + String(result.status).padEnd(4) +
    ' 正文 ' + String(result.chars).padEnd(4) + ' ' + verdict(result) +
    (result.error ? '  ' + result.error.slice(0, 60) : '')
  console.log(line)
  if (result.chars > 0) usable.push(model)
}

console.log('')
if (usable.length > 0) {
  console.log('可用的免费模型：' + usable.join('、'))
  console.log('切过去只需把 cordis.patch.yml 里 progress-summary 的 model 改成它，然后重启 DSH。')
} else {
  console.log('当前没有可用的免费模型。过段时间再跑一次；出现可用模型时本脚本会直接列出。')
}
