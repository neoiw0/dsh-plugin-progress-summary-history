/**
 * 进度历史（host 半边）：把第三方插件写下的 `plugin:progress-summary/line`
 * 记录折成一个会话级投影 `progressHistory`，供右侧栏面板读取。
 *
 * 只读：不写会话、不改别人的记录、不注入任何面向模型的内容。
 */
import { appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'progress-history'

/** 只依赖投影注册表；缺失时本插件不激活，也不会拖累启动。 */
export const inject = ['sessionProjections']

const RECORD = 'plugin:progress-summary/line'
const MAX_LINES = 200
const LOG = join(homedir(), '.dsh', 'progress-history.log')

function note(message) {
  try {
    appendFileSync(LOG, new Date().toISOString() + ' ' + message + '\n')
  } catch {
    /* 诊断失败绝不影响宿主 */
  }
}

const schema = { parse: value => value }

export function apply(ctx) {
  note('apply projection progressHistory')
  ctx.sessionProjections.register({
    key: 'progressHistory',
    stateVersion: 1,
    stateSchema: schema,
    init: () => ({ lines: [], latest: '', updatedAt: 0 }),
    apply: (state, event) => {
      if (event.type !== RECORD) return state
      const data = event.data || {}
      const text = typeof data.line === 'string' ? data.line.trim() : ''
      if (!text) return state
      const at = Number(event.time || data.at || Date.now())
      const lines = state.lines.concat([{ at, line: text, state: data.state || '' }])
      if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES)
      return { lines, latest: text, updatedAt: at }
    },
    // 没有 wire 声明，投影只在宿主内部折叠、不会推给客户端：
    // 面板会一直读不到值。这与上游 progress-summary 的写法保持一致。
    wire: {
      viewSchema: schema,
      view: state => state,
    },
  })
}
