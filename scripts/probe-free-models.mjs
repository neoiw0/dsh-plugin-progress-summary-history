/**
 * 模型探测器 + 成本估算：把候选模型逐个打一遍（用播报真实的提示词），
 * 报告「能不能用 / 会不会思考 / 多快 / 每次多少钱」。
 *
 * 用法：
 *   node scripts/probe-free-models.mjs                 # 只测名字里带 free 的
 *   node scripts/probe-free-models.mjs --all           # 连付费模型一起测
 *   node scripts/probe-free-models.mjs --model glm-5.3-flash
 *
 * 密钥来源：环境变量 OPENCODE_GO_API_KEY，或 ~/.dsh/.credentials.yaml 里的同名项。
 * 本脚本只读、不打印密钥、不改配置。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = 'https://opencode.ai/zen/go/v1'
const SESSION_HEADER = 'x-opencode-session'
const CREDENTIALS = join(homedir(), '.dsh', '.credentials.yaml')
const NEWLINE = String.fromCharCode(10)

/** 网关现在强制要求会话头，缺了直接 400。本地固定一个标识即可。 */
const SESSION_ID = process.env.OPENCODE_SESSION_ID || 'dsh-plugin-progress-summary-history'

/** 与插件真实用法一致的提示词（固定 system + 变化的 user），测出来的结论才可迁移。 */
const SYSTEM_PROMPT = [
  '你是编码智能体的进度播报员。读者正在等结果，看不到模型的内部思考。',
  '根据"最近思考"，写一行中文进度说明：它想达成什么、现在走到哪一步。',
  '要求：不超过 40 字；只输出这一行；不要引号；不要解释。',
].join(NEWLINE)
const USER_PROMPT = '上一条：（无）' + NEWLINE + '最近思考：我在核对 profile 配置里的 provider 块与换行符，确认后准备写汇报。'

/** Go 计划官方价目：输入 / 输出（美元每百万 token）。没有条目的模型不估算成本。 */
const PRICES = {
  'glm-5.3-flash': [0.15, 0.5],
  'mimo-v2.6-flash': [0.14, 0.28],
  'deepseek-v4.1-flash': [0.15, 0.6],
  'qwen3.8-flash': [0.15, 0.47],
  'minimax-m3.1-flash': [0.15, 0.6],
  'longcat-2.0': [0.3, 1.2],
  hy3: [0.14, 0.58],
}

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

const KEY = readKey()

async function call(path, init) {
  return fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: 'Bearer ' + KEY,
      [SESSION_HEADER]: SESSION_ID,
      ...(init && init.headers ? init.headers : {}),
    },
  })
}

async function listModels() {
  const response = await call('/models', { method: 'GET' })
  if (!response.ok) throw new Error('列模型失败：HTTP ' + response.status)
  const data = await response.json()
  return (data.data || data.models || []).map((item) => item.id || item.name).filter(Boolean)
}

/** 打一次真实请求，返回正文/思考字符数、耗时、usage。 */
async function probe(model) {
  const body = JSON.stringify({
    model,
    max_tokens: 256,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: USER_PROMPT },
    ],
  })
  const started = Date.now()
  const response = await call('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  const text = await response.text()
  const elapsedMs = Date.now() - started

  let chars = 0
  let thinking = 0
  let usage = null
  let sample = ''
  for (const line of text.split(NEWLINE)) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (payload === '' || payload === '[DONE]') continue
    try {
      const chunk = JSON.parse(payload)
      const delta = ((chunk.choices || [{}])[0] || {}).delta || {}
      if (typeof delta.content === 'string') {
        chars += delta.content.length
        if (sample.length < 24) sample += delta.content
      }
      for (const key of ['reasoning_content', 'reasoning']) {
        if (typeof delta[key] === 'string') thinking += delta[key].length
      }
      if (chunk.usage) usage = chunk.usage
    } catch {
      /* 非 JSON 行忽略 */
    }
  }
  const errorMatch = text.match(/"message"\s*:\s*"([^"]{0,120})/)
  return { status: response.status, chars, thinking, usage, elapsedMs, sample, error: errorMatch ? errorMatch[1] : '' }
}

function verdict(result) {
  if (result.chars > 0) return '可用'
  if (result.status === 200) return '200 但无正文（思考吃光预算？）'
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

if (!KEY) {
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

console.log('探测 ' + candidates.length + ' 个模型（用播报真实提示词；密钥已读取，不打印）')
console.log('')
console.log('  ' + '模型'.padEnd(26) + '状态  正文 思考 耗时    每次成本  判断')
let usable = []
for (const model of candidates) {
  let result
  try {
    result = await probe(model)
  } catch (error) {
    console.log('  ' + model.padEnd(26) + '请求异常：' + String(error).slice(0, 50))
    continue
  }
  const price = PRICES[model]
  const cost = price && result.usage
    ? (result.usage.prompt_tokens * price[0] + result.usage.completion_tokens * price[1]) / 1e6
    : null
  console.log(
    '  ' + model.padEnd(26) +
    String(result.status).padEnd(6) +
    String(result.chars).padEnd(4) +
    String(result.thinking).padEnd(4) +
    (result.elapsedMs / 1000).toFixed(1) + 's'.padEnd(6) +
    (cost === null ? '?' : '$' + cost.toFixed(6)).padEnd(11) +
    verdict(result) +
    (result.error ? '  ' + result.error.slice(0, 46) : ''),
  )
  if (result.chars > 0) usable.push(model)
}

console.log('')
if (usable.length > 0) {
  console.log('可用的模型：' + usable.join('、'))
  console.log('切换方式：改 cordis.patch.yml 里 provider 的 models 与 progress-summary 的 model，然后重启 DSH。')
} else {
  console.log('当前没有可用的模型。过段时间再跑一次。')
}
