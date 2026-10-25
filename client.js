/**
 * 进度历史（client 半边）：在 DSH 右侧栏注册一个「进度历史」页，
 * 读取宿主投影 `progressHistory`（来自 dsh-progress-summary 的播报记录）。
 *
 * 展示规则：
 * - 时间正序：最上面最老，最下面最新；新内容到达时自动滚到底部。
 * - 字号分档：最新一条 +2 号并加粗，次新 +1 号，其余基础字号。
 * - 重点着色：文件/标识符（紫）、数字与单位（加粗）、
 *   进展词（蓝）、完成词（绿）、风险词（红），降低阅读成本。
 *
 * 防御式写法：只用 createElement（无 JSX/构建），可选服务走 ctx.inject，
 * 任何一步失败都不抛错——客户端插件抛错会让整个窗口白屏。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-progress-summary-history',
  factory: (require) => {
    const React = require('react')

    const TYPE_ID = 'dsh-progress-history'
    const KIND = 'progress-history'
    const PROJECTION = 'progressHistory'

    const wrapStyle = {
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      padding: '12px 14px',
      height: '100%',
      overflowY: 'auto',
      fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
      lineHeight: '20px',
    }
    const rowStyle = { display: 'flex', gap: '8px', alignItems: 'baseline' }
    const timeStyle = {
      flex: '0 0 auto',
      color: 'var(--dsw-alias-label-secondary, #8b8f96)',
      fontVariantNumeric: 'tabular-nums',
      fontSize: '11px',
    }
    const emptyStyle = { color: 'var(--dsw-alias-label-secondary, #8b8f96)', padding: '8px 0' }

    const BASE_SIZE = 13
    const bodyStyle = {
      flex: '1 1 auto',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      fontSize: BASE_SIZE + 'px',
      lineHeight: '20px',
    }
    /** 越新越大：最新 +2 并加粗，次新 +1，其余基础字号。 */
    const tierStyle = (delta) => {
      if (delta === 0) {
        return { ...bodyStyle, fontSize: (BASE_SIZE + 2) + 'px', lineHeight: '24px', fontWeight: 600 }
      }
      if (delta === 1) {
        return { ...bodyStyle, fontSize: (BASE_SIZE + 1) + 'px', lineHeight: '22px' }
      }
      return bodyStyle
    }

    // 着色规则（扫读友好版）：
    // 1) 每行最多强调两处：一处“状态色”+ 一处“量/标识符”，其余保持正文色；
    // 2) 状态色只三种语义：蓝=进行中、绿=已完成、红=需注意；
    // 3) 标识符用等宽字形 + 弱紫，不抢主色；数字加粗，便于一眼看到量级。
    const PALETTE = {
      risk: { color: '#ef5350', fontWeight: 600 },
      done: { color: '#4caf50', fontWeight: 600 },
      progress: { color: '#42a5f5' },
      code: { color: '#b39ddb', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
      num: { fontWeight: 600 },
    }
    // 同一位置优先取风险，其次完成，最后进行中。
    const STATE_RULES = [
      ['risk', /失败|风险|阻塞|无法|报错|崩溃|错误|缺失|未完成|待确认|回滚|白屏|超时/g],
      ['done', /完成|已修复|通过|已确认|就绪|成功|恢复|已解决|已生效|已装好/g],
      ['progress', /正在|下一步|接下来|继续|开始|准备|计划|待办/g],
    ]
    const MEASURE_RULES = [
      ['code', /`[^`]{1,80}`/g],
      ['code', /[A-Za-z0-9_./-]+[.](?:js|mjs|cjs|ts|tsx|py|yml|yaml|json|md|ps1|cmd|vbs|exe|zstd)/g],
      ['num', /[0-9]+(?:[.][0-9]+)?[ ]?(?:%|条|次|秒|毫秒|ms|s|分钟|小时|个|处|轮|行|步|MB|KB|GB|tok|tokens)/g],
    ]
    /** 第一个命中的状态词（风险 > 完成 > 进行中，取文本中最靠前者）。 */
    function firstStateHit(text) {
      let best = null
      for (const [kind, pattern] of STATE_RULES) {
        pattern.lastIndex = 0
        const match = pattern.exec(text)
        if (!match) continue
        if (best === null || match.index < best.start) {
          best = { start: match.index, end: match.index + match[0].length, kind, text: match[0] }
        }
      }
      return best
    }

    /** 至多 count 个“量/标识符”，跳过与状态词重叠的部分。 */
    function measureHits(text, state, count) {
      const hits = []
      for (const [kind, pattern] of MEASURE_RULES) {
        pattern.lastIndex = 0
        let match
        let guard = 0
        // 防御：正则若因缺 g 标志而原地打转，这里最多扫 200 次就停，
        // 绝不让面板把界面线程卡死。
        while ((match = pattern.exec(text)) !== null && guard < 200) {
          guard += 1
          const hit = { start: match.index, end: match.index + match[0].length, kind, text: match[0] }
          if (pattern.lastIndex === match.index) pattern.lastIndex += 1
          const overlaps = (state !== null && hit.start < state.end && state.start < hit.end) ||
            hits.some((other) => hit.start < other.end && other.start < hit.end)
          if (overlaps) continue
          hits.push(hit)
        }
      }
      hits.sort((left, right) => left.start - right.start)
      return hits.slice(0, count)
    }

    /** 把一行切成「普通文本 / 强调片段」，强调点严格限量。 */
    function segments(text) {
      const state = firstStateHit(text)
      const measures = measureHits(text, state, 2)
      const hits = (state === null ? measures : measures.concat([state])).sort((left, right) => left.start - right.start)
      const parts = []
      let cursor = 0
      for (const hit of hits) {
        if (hit.start > cursor) parts.push({ text: text.slice(cursor, hit.start) })
        parts.push(hit)
        cursor = hit.end
      }
      if (cursor < text.length) parts.push({ text: text.slice(cursor) })
      return parts
    }

    /** 一行正文：普通片段原样，强调片段套颜色/字形。 */
    function renderLine(text, style, key) {
      const parts = segments(text)
      const children = parts.map((part, index) => {
        if (!part.kind) return part.text
        return React.createElement('span', { key: index, style: PALETTE[part.kind] }, part.text)
      })
      return React.createElement('span', { key, style }, children)
    }

    const pad = (n) => (n < 10 ? '0' + n : String(n))
    const absolute = (at) => {
      if (!at) return '--:--:--'
      const date = new Date(at)
      if (Number.isNaN(date.getTime())) return '--:--:--'
      return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
    }
    /** 相对时间更省阅读成本；精确时刻放在悬停提示里。 */
    const relative = (at) => {
      const value = Number(at)
      if (!value) return '--'
      const diff = Date.now() - value
      if (!Number.isFinite(diff) || diff < 0) return absolute(value)
      const minute = 60 * 1000
      if (diff < minute) return '刚刚'
      if (diff < 60 * minute) return Math.round(diff / minute) + ' 分钟前'
      if (diff < 24 * 60 * minute) return Math.round(diff / (60 * minute)) + ' 小时前'
      return Math.round(diff / (24 * 60 * minute)) + ' 天前'
    }

    /** 右侧栏页正文：时间正序、字号分档、重点着色。 */
    function ProgressHistoryBody(props) {
      const useProjection = props && typeof props.useProjection === 'function' ? props.useProjection : null
      let value
      let projectionKnown = false
      try {
        if (useProjection) {
          value = useProjection(PROJECTION)
          projectionKnown = value !== undefined
        }
      } catch (error) {
        value = undefined
      }
      const lines = (value && Array.isArray(value.lines)) ? value.lines : []
      const endRef = React.useRef(null)
      React.useEffect(() => {
        const node = endRef.current
        if (node && typeof node.scrollIntoView === 'function') {
          node.scrollIntoView({ block: 'end' })
        }
      }, [lines.length])

      if (lines.length === 0) {
        const message = projectionKnown
          ? '这条会话还没有进度播报。agent 每运行一段、新推理足够多时，dsh-progress-summary 就会写入一条。'
          : '读不到进度投影：请确认 dsh-progress-summary 已安装，并重启过一次。'
        return React.createElement(
          'div',
          { style: wrapStyle, 'data-progress-history': '' },
          React.createElement('div', { style: emptyStyle }, message),
        )
      }

      const children = []
      for (let i = 0; i < lines.length && i < 300; i += 1) {
        const item = lines[i] || {}
        const delta = lines.length - 1 - i
        const rowStyleNewest = delta === 0 ? { ...rowStyle, borderLeft: '2px solid #42a5f5', paddingLeft: '8px' } : rowStyle
        children.push(
          React.createElement('div', { key: String(item.at || i) + '-' + i, style: rowStyleNewest },
            React.createElement('span', { style: { ...timeStyle, cursor: 'default' }, title: absolute(item.at) }, relative(item.at)),
            renderLine(item.line || '', tierStyle(delta), 'l' + i),
          ),
        )
      }
      children.push(React.createElement('div', { key: 'end', ref: endRef, style: { height: '1px' } }))
      return React.createElement('div', { style: wrapStyle, 'data-progress-history': '' }, children)
    }

    /** tab 标题。 */
    function ProgressHistoryTitle() {
      return React.createElement('span', { 'data-progress-history-title': '' }, '进度历史')
    }

    function apply(ctx) {
      // 客户端插件抛错会让整个窗口起不来，所以每一步都自带兜底。
      const safe = (label, fn) => {
        try {
          fn()
        } catch (error) {
          try { console.warn('[progress-history] ' + label + ' failed', error) } catch { /* 忽略 */ }
        }
      }
      safe('slots registration', () => {
        ctx.inject(['slots'], (scope) => {
          safe('tab body slot', () => {
            scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register(
              { name: 'sidebar.right.pane.tab', key: TYPE_ID },
              ProgressHistoryBody,
            ))
          })
          safe('tab title slot', () => {
            scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register(
              { name: 'sidebar.right.pane.tab.title', key: TYPE_ID },
              ProgressHistoryTitle,
            ))
          })
        })
      })
      // 点播报行（composer 上方那条）直接打开本页：
      // 播报由 dsh-progress-summary 渲染，带稳定属性 [data-progress-summary]，
      // 这里用事件代理接管点击，不改第三方插件；属性若消失则点击自然失效。
      safe('bar click bridge', () => {
        ctx.inject(['sidebarRight'], (scope) => {
          const controller = scope.sidebarRight
          if (!controller || typeof controller.openTab !== 'function') return
          const onClick = (event) => {
            const target = event && event.target
            const bar = target && typeof target.closest === 'function' ? target.closest('[data-progress-summary]') : null
            if (!bar) return
            try {
              controller.openTab(KIND, { revealIfOpened: true })
            } catch (error) {
              try { console.warn('[progress-history] open tab failed', error) } catch { /* 忽略 */ }
            }
          }
          document.addEventListener('click', onClick)
          scope.effect(() => () => document.removeEventListener('click', onClick), 'progress-history bar click')
          // 可点的地方给个手型光标（仅限该属性，不影响别处）。
          const style = document.createElement('style')
          style.textContent = '[data-progress-summary]{cursor:pointer}'
          document.head.appendChild(style)
          scope.effect(() => () => style.remove(), 'progress-history bar cursor')
        })
      })

      safe('sidebar tab type', () => {
        ctx.inject(['sidebarRightTabs'], (scope) => {
          safe('tab type register', () => {
            scope.effect(() => scope.sidebarRightTabs.register({
              id: TYPE_ID,
              kind: KIND,
              priority: 'extension',
              title: () => '进度历史',
              guide: [{
                id: 'progress-history',
                kind: KIND,
                // 引导页会调用 entry.title() 与 entry.description?.()，必须是函数。
                title: () => '进度历史',
                description: () => '按时间顺序列出这条会话的进度播报',
              }],
            }), 'progress-history tab type')
          })
        })
      })
    }

    const module = { exports: {} }
    module.exports.name = 'dsh-progress-history'
    module.exports.inject = ['slots']
    module.exports.apply = apply
    module.exports.ProgressHistoryBody = ProgressHistoryBody
    return module.exports
  },
})
