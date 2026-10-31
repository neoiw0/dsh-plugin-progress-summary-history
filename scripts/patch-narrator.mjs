/**
 * 给第三方插件 dsh-progress-summary 打两个补丁（可重复执行、可回滚）。
 *
 * 背景：该插件没有开放"提示词"和"摘录范围"的配置项，只能改它装好的 narrator.js。
 * 插件升级（pnpm add / 重装）会覆盖这个文件，届时重跑一次 `node scripts/patch-narrator.mjs --apply` 即可。
 *
 * 补丁内容：
 *   P1 中文提示词：要求用初学者能听懂的话（少行话，必要的术语用括号解释）。
 *   P2 摘录范围：从"最近 N 字"改成"上次总结到现在的全部新增推理"（上限 4000 字），
 *      避免只看到尾巴、把长间隔里的前因漏掉。
 *
 * 用法：
 *   node scripts/patch-narrator.mjs            # 只看状态（默认 --check）
 *   node scripts/patch-narrator.mjs --apply    # 打补丁（首次会留 .bak-progress-patch 备份）
 *   node scripts/patch-narrator.mjs --revert   # 从备份还原
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const TARGET = join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-progress-summary', 'narrator.js')
const BACKUP = TARGET + '.bak-progress-patch'

/** P1：原文的中文提示词四行 → 初学者友好版本。 */
const PROMPT_OLD = [
  "    '你是编码智能体的进度播报员。读者正在等结果，看不到模型的内部思考。',",
  "    '根据\"最近思考\"，写一行中文进度说明：它想达成什么、现在走到哪一步。',",
  "    '读者已经在工作步骤里看到了每次工具调用，所以不要复述工具名、命令、路径或文件名，只写目的和进展。',",
  "    '规则：一句话，尽量不超过 100 字；不要引号、Markdown、前缀或句末标点；不要与\"上一条\"雷同；信息不足时写得更概括。',",
].join('\n')

const PROMPT_NEW = [
  "    '你是编码智能体的进度播报员。读者正在等结果，看不到模型的内部思考。',",
  "    '根据\"最近思考\"，写一行中文进度说明：它想达成什么、现在走到哪一步。',",
  "    '读者已经在工作步骤里看到了每次工具调用，所以不要复述工具名、命令、路径或文件名，只写目的和进展。',",
  "    '写给完全不懂技术的读者：用日常语言，不用行话；必须出现的技术名词要用括号简单解释一句。',",
  "    '规则：一句话，尽量不超过 100 字；不要引号、Markdown、前缀或句末标点；不要与\"上一条\"雷同；信息不足时写得更概括。',",
].join('\n')

/** P2：摘录改成"上次总结到现在"。 */
const EXCERPT_OLD = '    const excerpt = tailText(this.buffer, this.config.excerptChars)'
const EXCERPT_NEW = [
  '    // 补丁 P2：把"上次总结到现在"的全部新增推理喂出去（上限 4000 字），',
  '    // 而不是只看最近 excerptChars 字，避免长间隔里漏掉前因。',
  '    const spanChars = Math.min(Math.max(this.config.excerptChars, this.dirty), 4000)',
  '    const excerpt = tailText(this.buffer, spanChars)',
].join('\n')

/** P3：总开关——旗标文件存在时一次模型调用都不发。 */
const OFF_OLD = '    if (!this.active) return'
const OFF_NEW = [
  '    if (!this.active) return',
  '    // 补丁 P3：总开关。宿主插件把 globalThis.__dshNarratorOff 置 true 时，',
  '    // 这里直接返回——连模型请求都不发，零 token 消耗。',
  '    if (globalThis.__dshNarratorOff === true) return',
].join(String.fromCharCode(10))

/** P4：放开 maxTokens 上限（默认 256 太小，免费模型要 1024 才肯出正文）。 */
const CAP_OLD = 'maxTokens: z.number().min(16).max(256).step(1).default(96)'
const CAP_NEW = 'maxTokens: z.number().min(16).max(4096).step(1).default(96)'
// 运行时还有一道 clamp(..., 16, 256, ...)，只改 schema 不够——值会被压回 256。
const CLAMP_OLD = 'maxTokens: Math.round(clamp(merged.maxTokens, 16, 256, DEFAULTS.maxTokens))'
const CLAMP_NEW = 'maxTokens: Math.round(clamp(merged.maxTokens, 16, 4096, DEFAULTS.maxTokens))'

const args = process.argv.slice(2)
const mode = args.includes('--apply') ? 'apply' : args.includes('--revert') ? 'revert' : 'check'

if (!existsSync(TARGET)) {
  console.error('找不到目标文件：' + TARGET)
  console.error('先确认 dsh-progress-summary 已装入 profile。')
  process.exit(2)
}

const text = readFileSync(TARGET, 'utf8')
const hasPrompt = text.includes(PROMPT_NEW)
const hasExcerpt = text.includes('const spanChars = Math.min(Math.max(')
const hasOff = text.includes('globalThis.__dshNarratorOff === true')
const INDEX_TARGET = join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-progress-summary', 'index.js')
const indexText = existsSync(INDEX_TARGET) ? readFileSync(INDEX_TARGET, 'utf8') : ''
const hasCap = indexText.includes('max(4096)') && indexText.includes('clamp(merged.maxTokens, 16, 4096')

if (mode === 'check') {
  console.log('目标：' + TARGET)
  console.log('  P1 初学者提示词  ' + (hasPrompt ? '已应用' : '未应用'))
  console.log('  P2 摘录范围      ' + (hasExcerpt ? '已应用' : '未应用'))
  console.log('  P3 总开关        ' + (hasOff ? '已应用' : '未应用'))
  console.log('  P4 输出上限      ' + (hasCap ? '已应用' : '未应用'))
  console.log(hasPrompt && hasExcerpt && hasOff && hasCap ? '状态：四个补丁都在' : '状态：需要 --apply')
  process.exit(0)
}

if (mode === 'revert') {
  if (!existsSync(BACKUP)) {
    console.error('没有备份可还原：' + BACKUP)
    process.exit(2)
  }
  copyFileSync(BACKUP, TARGET)
  console.log('已从备份还原：' + TARGET)
  process.exit(0)
}

// apply：先备份，再逐条替换，最后回读校验
let next = text
if (!hasPrompt) {
  if (!next.includes(PROMPT_OLD)) {
    console.error('P1 锚点没找到（插件版本可能变了），中止，未修改任何文件。')
    process.exit(3)
  }
  next = next.replace(PROMPT_OLD, PROMPT_NEW)
}
if (!hasExcerpt) {
  if (!next.includes(EXCERPT_OLD)) {
    console.error('P2 锚点没找到（插件版本可能变了），中止，未修改任何文件。')
    process.exit(3)
  }
  next = next.replace(EXCERPT_OLD, EXCERPT_NEW)
}

if (!hasOff) {
  if (!next.includes(OFF_OLD)) {
    console.error('P3 锚点没找到，中止。')
    process.exit(3)
  }
  next = next.replace(OFF_OLD, OFF_NEW)
}
if (!hasCap) {
  let patched = indexText
  if (patched.includes(CAP_OLD)) patched = patched.replace(CAP_OLD, CAP_NEW)
  if (patched.includes(CLAMP_OLD)) patched = patched.replace(CLAMP_OLD, CLAMP_NEW)
  if (patched !== indexText) {
    writeFileSync(INDEX_TARGET, patched, 'utf8')
    console.log('  P4 输出上限      已应用（schema 与运行时 clamp 都放到 4096）')
  } else if (indexText !== '') {
    console.log('  P4 输出上限      锚点没找到，跳过')
  }
}

if (!existsSync(BACKUP)) {
  copyFileSync(TARGET, BACKUP)
  console.log('已备份原文件 → ' + BACKUP)
}
writeFileSync(TARGET, next, 'utf8')

const after = readFileSync(TARGET, 'utf8')
const okPrompt = after.includes(PROMPT_NEW)
const okExcerpt = after.includes('const spanChars = Math.min(Math.max(')
console.log('  P1 初学者提示词  ' + (okPrompt ? '已应用' : '失败'))
console.log('  P2 摘录范围      ' + (okExcerpt ? '已应用' : '失败'))
console.log('  P3 总开关        ' + (after.includes('globalThis.__dshNarratorOff === true') ? '已应用' : '失败'))
console.log('完成：重启 DSH 生效')
