#!/usr/bin/env node
/**
 * 发布前自检：语法 + 假加载器 + 渲染冒烟。
 * 这三步能挡住「客户端 bundle 语法错误」这一类会让 DSH 整个窗口起不来的事故。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
// `@deepseek-ai/schemastery` 由 DSH 运行时提供，本地仓库里没有。
// 先放一个最小垫片，保证 index.js 的静态 import 能解析（只覆盖本项目用到的 API）。
const shimDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@deepseek-ai', 'schemastery')
if (!existsSync(shimDir)) {
  mkdirSync(shimDir, { recursive: true })
  writeFileSync(join(shimDir, 'index.js'), [
    'function field(defaultValue) {',
    '  const schema = function (value) { return value === undefined ? defaultValue : value }',
    '  schema.default = (value) => field(value)',
    '  schema.volatile = () => schema',
    '  return schema',
    '}',
    'const z = {',
    '  boolean: () => field(false),',
    '  string: () => field(""),',
    '  number: () => field(0),',
    '  object: (shape) => {',
    '    const schema = function (value) {',
    '      const input = value || {}',
    '      const output = {}',
    '      for (const key of Object.keys(shape)) output[key] = shape[key](input[key])',
    '      return output',
    '    }',
    '    return schema',
    '  },',
    '}',
    'export default z',
    '',
  ].join(String.fromCharCode(10)))
  writeFileSync(join(shimDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/schemastery', version: '0.0.0-shim', main: 'index.js' }, null, 2))
}


const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const fail = (msg) => { console.error('FAIL ' + msg); process.exitCode = 1 }
const ok = (msg) => console.log('ok   ' + msg)

// 1) 语法：裸换行/坏转义在单引号字符串里会在这里被抓住
for (const file of ['index.js', 'client.js', 'scripts/check.mjs']) {
  try {
    execFileSync(process.execPath, ['--check', join(root, file)], { stdio: 'pipe' })
    ok('syntax ' + file)
  } catch (error) {
    fail('syntax ' + file + '\n' + (error.stderr?.toString() || error.message))
  }
}

// 2) 客户端假加载器：模拟 window.__ModuleLoader__ + require('react')
const code = readFileSync(join(root, 'client.js'), 'utf8')
const captured = {}
globalThis.window = { __ModuleLoader__: { load: (def) => { captured.def = def } } }
try {
  new Function('window', code)(globalThis.window)
  ok('client bundle evaluates')
} catch (error) {
  fail('client bundle threw: ' + error.message)
}
const def = captured.def
if (!def || !def.factory) fail('client bundle did not call __ModuleLoader__.load')
else ok('client registers module id ' + def.id)

// 3) 渲染冒烟：空状态 / 有数据 / 缺 useProjection 三条路径都不许抛
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useRef: (initial) => ({ current: initial ?? null }),
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useState: (initial) => [initial, () => {}],
}
let module = null
try {
  module = def.factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  })
  ok('factory ran; exports ' + Object.keys(module).join(','))
} catch (error) {
  fail('factory threw: ' + error.message)
}
if (module) {
  const cases = [
    ['empty projection', { useProjection: () => undefined }],
    ['two lines', { useProjection: () => ({ lines: [{ at: 1, line: 'a' }, { at: 2, line: 'b' }] }) }],
    ['no hook', {}],
    ['hook throws', { useProjection: () => { throw new Error('boom') } }],
  ]
  for (const [label, props] of cases) {
    try {
      const tree = module.ProgressHistoryBody(props)
      if (!tree) fail('render(' + label + ') returned nothing')
      else ok('render ' + label)
    } catch (error) {
      fail('render(' + label + ') threw: ' + error.message)
    }
  }
  // 4) apply 在缺服务/抛错的 ctx 上不许把错误抛给启动器
  for (const [label, ctx] of [
    ['full ctx', { inject: (names, cb) => cb({ slots: { inject: () => {}, register: () => {} }, sidebarRightTabs: { register: () => () => {} }, effect: (fn) => fn() }) }],
    ['broken ctx', { inject: () => { throw new Error('missing service') } }],
  ]) {
    try {
      module.apply(ctx)
      ok('apply survives ' + label)
    } catch (error) {
      fail('apply threw on ' + label + ': ' + error.message)
    }
  }
}

// 4.5) 强调上限：一行最多 5 处（至多 2 状态 + 3 量/标识符），且必须至少命中 1 处
if (module) {
  const flatten = (node, out = []) => {
    if (Array.isArray(node)) { for (const item of node) flatten(item, out); return out }
    if (!node || typeof node !== 'object') return out
    out.push(node)
    flatten(node.children, out)
    return out
  }
  const line = '已完成 3 项修复并补齐 cordis.patch.yml 配置，剩余 2 处风险待确认，正在复验'
  const tree = module.ProgressHistoryBody({ useProjection: () => ({ lines: [{ at: Date.now(), line }] }) })
  // 行结构：div > [时间 span, 正文 span]，正文 span 的 children 里才是强调片段
  const rows = []
  const walk = (node) => {
    if (Array.isArray(node)) { for (const item of node) walk(item); return }
    if (!node || typeof node !== 'object') return
    if (node.type === 'div' && Array.isArray(node.children) && node.children.length === 2 &&
        node.children[0] && node.children[0].type === 'span') rows.push(node)
    walk(node.children)
  }
  walk(tree)
  if (rows.length !== 1) fail('expected exactly 1 rendered row, got ' + rows.length)
  else {
    const body = rows[0].children[1]
    const parts = Array.isArray(body.children[0]) ? body.children[0] : (body.children || [])
    const emphasised = parts.filter((node) => node && node.type === 'span')
    if (emphasised.length > 5) fail('too many emphasised fragments: ' + emphasised.length + ' (max 5 per line)')
    else if (emphasised.length < 1) fail('no emphasised fragment on a line that has keywords')
    else ok('emphasis cap respected (' + emphasised.length + ' fragments: ' +
      emphasised.map((node) => (node.children || []).join('')).join(' / ') + ')')
  }
}

// 4.6) 点 bar 打开页签：点击代理必须调用 sidebarRight.openTab
if (module) {
  const listeners = []
  const styleNodes = []
  const fakeDocument = {
    addEventListener: (type, handler) => listeners.push({ type, handler }),
    removeEventListener: () => {},
    createElement: () => ({ textContent: '', remove: () => styleNodes.pop() }),
    head: { appendChild: (node) => styleNodes.push(node) },
  }
  const previous = globalThis.document
  globalThis.document = fakeDocument
  const calls = []
  try {
    module.apply({
      inject: (names, callback) => {
        if (names.includes('sidebarRight')) {
          callback({ sidebarRight: { openTab: (kind, options) => calls.push({ kind, options }) }, effect: () => {} })
        }
      },
    })
    const click = listeners.find((item) => item.type === 'click')
    if (!click) fail('bar click: no click listener registered')
    else {
      click.handler({ target: { closest: (selector) => (selector === '[data-progress-summary]' ? {} : null) } })
      if (calls.length === 1 && calls[0].kind === 'progress-history') ok('bar click opens the panel tab')
      else fail('bar click did not call openTab(' + JSON.stringify(calls) + ')')
      click.handler({ target: { closest: () => null } })
      if (calls.length === 1) ok('bar click ignores unrelated clicks')
      else fail('unrelated click also opened the tab')
    }
  } finally {
    globalThis.document = previous
  }
}

// 4.7) 静态契约：这些正是 2026-10-24 两次启动失败的根因，必须在安装前拦住
{
  const pkgName = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name
  const clientSrc = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const patchSrc = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const indexSrc = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

  const loaderId = (clientSrc.match(/__ModuleLoader__\.load\(\{[^}]*?id:\s*'([^']+)'/) || [])[1]
  if (loaderId === pkgName) ok('loader id equals package name (' + pkgName + ')')
  else fail('loader id "' + loaderId + '" != package name "' + pkgName + '" (会触发 duplicate factory registration)')

  const patchName = (patchSrc.match(/^\s*-\s*insert:[\s\S]*?name:\s*'?([^'\r\n]+)'?/m) || [])[1]
  if (patchName && patchName.trim() === pkgName) ok('cordis patch row name equals package name')
  else fail('cordis patch row name "' + (patchName || '').trim() + '" != package name "' + pkgName + '"')

  if (/wire:\s*\{/.test(indexSrc)) ok('projection declares wire (否则宿主不外发，面板读不到)')
  else fail('projection is missing wire: { viewSchema, view } — 客户端拿不到值')
}

// 5) 宿主投影折叠
try {
  const host = await import(pathToFileURL(join(root, 'index.js')).href)
  let registered = null
  host.apply({ sessionProjections: { register: (d) => { registered = d } } })
  let state = registered.init()
  state = registered.apply(state, { type: 'plugin:progress-summary/line', time: 1, data: { line: 'x', state: 'running' } })
  state = registered.apply(state, { type: 'assistant/message', time: 2, data: {} })
  if (state.lines.length !== 1) fail('host fold expected 1 line, got ' + state.lines.length)
  else ok('host projection folds one line and ignores others')
} catch (error) {
  fail('host projection threw: ' + error.message)
}


// 6) 引导入口契约：title / description 必须是函数（DSH 会直接调用它们）
if (module) {
  const captured = []
  const registry = {
    register: (definition) => {
      captured.push(definition)
      return () => {}
    },
  }
  const ctx = {
    inject: (names, cb) => cb({
      slots: { inject: () => {}, register: () => {} },
      sidebarRightTabs: registry,
      effect: (fn) => fn(),
    }),
  }
  try {
    module.apply(ctx)
    const def = captured[0]
    if (!def) fail('no tab type was registered')
    else if (typeof def.title !== 'function') fail('tab type title must be a function')
    else if (!Array.isArray(def.guide) || def.guide.length === 0) fail('no guide entry registered')
    else {
      const entry = def.guide[0]
      if (typeof entry.title !== 'function') fail('guide entry title must be a function')
      else if (entry.description !== undefined && typeof entry.description !== 'function') {
        fail('guide entry description must be a function (DSH calls entry.description())')
      } else ok('guide entry contract: title() and description() callable')
    }
  } catch (error) {
    fail('apply threw while registering the tab type: ' + error.message)
  }
}

process.exit(process.exitCode ?? 0)
