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

    const sectionStyle = { padding: '8px 0 4px' }
    const toggleRowStyle = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      padding: '12px 0',
    }
    const toggleHintStyle = { fontSize: '12px', opacity: 0.6, lineHeight: '18px' }
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

    // 着色规则 v2（词表更全、颜色更多，但仍保证一行不会花到没法读）：
    // 1) 状态色五档：红=风险、绿=完成、琥珀=等待/待确认、青=验证/排查、蓝=进行中；
    // 2) 标识符四档：弱紫等宽=代码与文件、橙等宽=版本号、粉=配置/密钥/环境变量、加粗=数量；
    // 3) 每行最多 5 处强调（至多 2 个状态词 + 3 个标识符），其余保持正文色。
    const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    const PALETTE = {
      risk: { color: '#ef5350', fontWeight: 700 },
      done: { color: '#4caf50', fontWeight: 700 },
      wait: { color: '#ffb74d', fontWeight: 600 },
      verify: { color: '#4dd0e1', fontWeight: 600 },
      progress: { color: '#42a5f5', fontWeight: 600 },
      config: { color: '#f06292', fontWeight: 600 },
      ver: { color: '#ffa726', fontFamily: MONO },
      code: { color: '#b39ddb', fontFamily: MONO },
      num: { fontWeight: 700 },
    }
    // 顺序即优先级：同一位置先命中风险，再完成、等待、验证、进行中。
    const STATE_RULES = [
      ['risk', /失败|报错|错误|异常|崩溃|阻塞|超时|白屏|回滚|缺失|遗漏|偏差|不一致|未完成|不可用|不生效|无效|风险|冲突|拒绝|限流|弃用|卡住|挂了|打不开|不显示|无法启动/g],
      ['done', /完成|已修复|修复完成|通过|已确认|确认无误|就绪|成功|已恢复|已解决|已生效|已装好|已发布|已推送|已合并|已清理|已对齐|已上线|跑通|打通|搞定|修好|装好|部署完成/g],
      ['wait', /等待|待确认|待定|待办|待验证|待补|待测|挂起|暂停|冷却|排队|尚未|还没|暂缓|稍后/g],
      ['verify', /验证|核对|比对|检查|测试|复测|复验|自检|体检|回归|排查|定位|复现|断言|审计|确认|抽查/g],
      ['progress', /正在|下一步|接下来|继续|开始|准备|计划|进行中|处理中|即将|马上|着手|尝试|并行/g],
    ]
    const MEASURE_RULES = [
      ['code', /`[^`]{1,80}`/g],
      ['code', /[A-Za-z0-9_./-]+[.](?:js|mjs|cjs|ts|tsx|py|yml|yaml|json|md|ps1|cmd|vbs|exe|zstd|tgz|log)/g],
      ['ver', /v?[0-9]+[.][0-9]+[.][0-9]+(?:-[A-Za-z0-9.]+)?/g],
      ['config', /OPENCODE_[A-Z_]+|DSH_[A-Z_]+|API[ _]?[Kk]ey|apiKeyEnv|_authToken|凭据|密钥|环境变量|cordis[.]patch[.]yml|[.]npmrc|profile|依赖|插件/g],
      ['num', /[0-9]+(?:[.][0-9]+)?[ ]?(?:%|条|次|秒|毫秒|ms|s|分钟|小时|个|处|轮|行|步|项|段|份|倍|页|层|版|档|套|批|天|周|MB|KB|GB|tok|tokens|字)/g],
    ]

    /** 至多 max 个状态词，互不重叠；风险优先于完成、等待、验证、进行中。 */
    function stateHits(text, max) {
      const hits = []
      for (const [kind, pattern] of STATE_RULES) {
        pattern.lastIndex = 0
        let match
        let guard = 0
        // 防御：正则若因缺 g 标志而原地打转，最多扫 200 次就停，绝不让面板卡住界面线程。
        while ((match = pattern.exec(text)) !== null && guard < 200) {
          guard += 1
          if (pattern.lastIndex === match.index) pattern.lastIndex += 1
          const hit = { start: match.index, end: match.index + match[0].length, kind, text: match[0] }
          if (hits.some((other) => hit.start < other.end && other.start < hit.end)) continue
          hits.push(hit)
          if (hits.length >= max) break
        }
        if (hits.length >= max) break
      }
      return hits.sort((left, right) => left.start - right.start)
    }

    /** 至多 count 个“量/标识符”，跳过与状态词重叠的部分。 */
    function measureHits(text, states, count) {
      const hits = []
      for (const [kind, pattern] of MEASURE_RULES) {
        pattern.lastIndex = 0
        let match
        let guard = 0
        while ((match = pattern.exec(text)) !== null && guard < 200) {
          guard += 1
          const hit = { start: match.index, end: match.index + match[0].length, kind, text: match[0] }
          if (pattern.lastIndex === match.index) pattern.lastIndex += 1
          const overlaps = states.some((state) => hit.start < state.end && state.start < hit.end) ||
            hits.some((other) => hit.start < other.end && other.start < hit.end)
          if (overlaps) continue
          hits.push(hit)
          if (hits.length >= count) break
        }
        if (hits.length >= count) break
      }
      hits.sort((left, right) => left.start - right.start)
      return hits.slice(0, count)
    }

    /** 把一行切成「普通文本 / 强调片段」，强调点严格限量。 */
    function segments(text) {
      const states = stateHits(text, 2)
      const measures = measureHits(text, states, 3)
      const hits = states.concat(measures).sort((left, right) => left.start - right.start)
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

    /** 一个不会抛错的只读表单兜底：拿不到配置表单时也能把开关画出来。 */
    function fallbackForm(enabled) {
      const snapshot = { value: { enabled }, revision: 0, writable: false }
      return {
        subscribe: () => () => {},
        getSnapshot: () => snapshot,
        set: async () => {},
        mutate: async () => {},
      }
    }

    /** 设置页里的开关卡片：控制是否继续累积进度历史。 */
    function ProgressHistoryPanel(props) {
      const form = (props && props.form) || fallbackForm(true)
      const subscribe = React.useCallback(callback => form.subscribe(callback), [form])
      const snapshot = React.useSyncExternalStore(subscribe, () => form.getSnapshot())
      const enabled = (snapshot.value || {}).enabled !== false
      const readOnly = snapshot.writable === false
      const toggle = () => {
        if (readOnly) return
        void form.set('enabled', !enabled)
      }
      return React.createElement(
        'div',
        { style: sectionStyle },
        React.createElement('div', { style: { fontSize: '16px', fontWeight: 600, marginBottom: '4px' } }, '进度历史'),
        React.createElement('div', { style: toggleHintStyle },
          '在右侧栏记录 agent 的运行进度：每运行一段就多一条白话说明，方便回头看它做了什么。'),
        React.createElement(
          'div',
          { style: toggleRowStyle },
          React.createElement(
            'div',
            { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' } },
            React.createElement('span', { style: { fontSize: '14px', lineHeight: '22px' } }, '开启进度历史'),
            React.createElement('span', { style: toggleHintStyle },
              enabled
                ? '开启中：新的进度说明会继续累积。'
                : '已关闭：不再累积新条目（已有内容保留）。'),
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              role: 'switch',
              'aria-checked': enabled,
              'aria-label': '开启进度历史',
              disabled: readOnly,
              onClick: toggle,
              style: {
                flex: '0 0 auto',
                width: '36px',
                height: '20px',
                padding: 0,
                borderRadius: '10px',
                border: 'none',
                cursor: readOnly ? 'default' : 'pointer',
                background: enabled
                  ? 'var(--dsw-alias-state-business-primary, #4b6fff)'
                  : 'var(--dsw-alias-interactive-bg-hover, #d0d0d0)',
                position: 'relative',
                transition: 'background 120ms ease',
              },
            },
            React.createElement('span', {
              style: {
                position: 'absolute',
                top: '2px',
                left: enabled ? '18px' : '2px',
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: '#fff',
                transition: 'left 120ms ease',
              },
            }),
          ),
        ),
      )
    }

    /** 右侧栏页正文：时间正序、字号分档、重点着色。 */
    function ProgressHistoryBody(props) {
      // 实时数据源：会话库里的投影值（DSH 自己的面板都这么读，切换会话/新写入都会触发重渲染）。
      // useProjection 只作为兜底：它绑定的是「面板打开时那个会话」，会话切换后会读到旧值。
      const useSessions = props && typeof props.useSessions === 'function' ? props.useSessions : null
      const useProjection = props && typeof props.useProjection === 'function' ? props.useProjection : null
      const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : ''

      let fromStore
      try {
        if (useSessions && sessionId !== '') {
          fromStore = useSessions((state) => {
            const row = state && state.byId ? state.byId[sessionId] : null
            const values = row && row.projectionValues ? row.projectionValues : null
            return values ? values[PROJECTION] : undefined
          })
        }
      } catch (error) {
        fromStore = undefined
      }

      let fromProjection
      try {
        if (useProjection) fromProjection = useProjection(PROJECTION)
      } catch (error) {
        fromProjection = undefined
      }

      const value = fromStore !== undefined ? fromStore : fromProjection
      const projectionKnown = value !== undefined
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

      // 设置里的入口。命名空间 = cordis.patch.yml 里本插件的行 id（progress-history）。
      safe('settings section', () => {
        ctx.inject(['configForms'], configCtx => {
          const registry = configCtx && configCtx.configForms
          const form = registry && typeof registry.get === 'function'
            ? registry.get('progress-history')
            : undefined
          // 主入口：设置左侧导航里的独立分区（与「思考链翻译」同款）。
          configCtx.slots.inject('settings.section', () => configCtx.slots.register(
            { name: 'settings.section', id: 'progress-history', order: 70, label: '进度历史' },
            () => React.createElement(ProgressHistoryPanel, { form }),
          ))
          // 额外入口：设置 → 通用 里的一行开关。
          configCtx.slots.inject('settings.general.item', () => configCtx.slots.register(
            { name: 'settings.general.item', id: 'progress-history', order: 62 },
            () => React.createElement(ProgressHistoryPanel, { form }),
          ))
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
