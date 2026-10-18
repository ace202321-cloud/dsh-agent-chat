/**
 * @dsh-external/dsh-agent-chat — client 侧（右侧栏 tab 类型）
 *
 * 官方架构：右侧栏是 DSH 原生栏，插件"只提供 tab 类型"。
 * 所以本插件走两阶段注册（照抄官方 ui-sidebar-documentpreview 的公开路径）：
 *   阶段 1  ctx.sidebarRightTabs.register({ id, kind, title, keepMounted })
 *   阶段 2  ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, Body)
 *
 * 只读渲染 agent-mailbox/thread.md：
 *   署名分色 / 未读计数 / 回复跳转 / 按署名筛选 / 折叠 / 自动滚底 / 相对时间
 *   轻量 markdown（代码块 · 表格 · 标题 · 列表 · 加粗 · 行内代码）
 */
import * as React from 'react'

export const inject = ['slots', 'sidebarRightTabs']

const API = '/@dsh-external/dsh-agent-chat/api'
const POLL_MS = 2000

export const TAB_ID = '@dsh-external/dsh-agent-chat'
export const TAB_KIND = 'agent-chat'
export const TAB_TITLE = '代理对话'

const PALETTE = ['#4e8cff', '#e8912d', '#22a06b', '#c05050', '#8e5bd0', '#0aa3a3', '#b8781a', '#5a6b7b']

interface Msg {
  n: number
  sig: string
  time: string
  model?: string
  replyTo?: number | null
  text: string
}

interface Payload {
  ok: boolean
  reason?: string
  file?: string
  mtime?: number
  count?: number
  signatures?: string[]
  messages?: Msg[]
}

const h = React.createElement

function esc(s: any): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c: string) {
    const map: any = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return map[c]
  })
}

function colorOf(sig: string, sigs: string[]): string {
  const i = sigs.indexOf(sig)
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length]
}

function relTime(t: string, now: number): string {
  const d = new Date(t)
  if (isNaN(d.getTime())) return t
  const sec = Math.floor((now - d.getTime()) / 1000)
  if (sec < 60) return '刚刚'
  if (sec < 3600) return Math.floor(sec / 60) + ' 分钟前'
  if (sec < 86400) return Math.floor(sec / 3600) + ' 小时前'
  return Math.floor(sec / 86400) + ' 天前'
}

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code style="background:#f0f2f4;border-radius:3px;padding:1px 4px;font-size:12px">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function md(text: string): string {
  const out: string[] = []
  const lines = String(text == null ? '' : text).split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++ }
      i++
      out.push('<pre style="background:#f6f8fa;border:1px solid #e1e4e8;border-radius:6px;padding:8px;overflow:auto;font-size:12px;margin:6px 0"><code>' + esc(buf.join('\n')) + '</code></pre>')
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++ }
      const cells = rows.map(function (r) { return r.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim() }) })
      const body = cells.filter(function (r) { return !r.every(function (c) { return /^:?-{2,}:?$/.test(c) }) })
      if (body.length) {
        const head = body[0]
        const rest = body.slice(1)
        out.push(
          '<table style="border-collapse:collapse;width:100%;font-size:12px;margin:6px 0"><thead><tr>' +
          head.map(function (c) { return '<th style="border:1px solid #d0d7de;background:#f3f5f7;padding:4px 6px;text-align:left">' + inline(c) + '</th>' }).join('') +
          '</tr></thead><tbody>' +
          rest.map(function (r) { return '<tr>' + r.map(function (c) { return '<td style="border:1px solid #d0d7de;padding:4px 6px">' + inline(c) + '</td>' }).join('') + '</tr>' }).join('') +
          '</tbody></table>'
        )
      }
      continue
    }
    if (/^\s*-{3,}\s*$/.test(line)) { out.push('<hr style="border:none;border-top:1px solid #e1e4e8;margin:8px 0">'); i++; continue }
    const hh = /^(#{1,6})\s+(.*)$/.exec(line)
    if (hh) {
      const lv = hh[1].length
      const sizes = [18, 16, 15, 14, 13, 12]
      out.push('<div style="font-weight:700;font-size:' + (sizes[lv - 1] || 12) + 'px;margin:10px 0 4px;color:#1f3b63">' + inline(hh[2]) + '</div>')
      i++
      continue
    }
    const li = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (li) {
      const buf: string[] = [li[1]]
      i++
      while (i < lines.length) {
        const m2 = /^\s*[-*+]\s+(.*)$/.exec(lines[i])
        if (!m2) break
        buf.push(m2[1]); i++
      }
      out.push('<ul style="margin:4px 0 4px 18px;padding:0">' + buf.map(function (b) { return '<li style="margin:2px 0">' + inline(b) + '</li>' }).join('') + '</ul>')
      continue
    }
    if (!line.trim()) { i++; continue }
    out.push('<div style="margin:3px 0">' + inline(line) + '</div>')
    i++
  }
  return out.join('')
}

/** 右侧栏 tab 正文 */
function AgentChatBody(_props: any): any {
  const [data, setData] = React.useState<any>({ ok: true, messages: [], signatures: [] })
  const [collapsed, setCollapsed] = React.useState(false)
  const [filterSig, setFilterSig] = React.useState('')
  const [now, setNow] = React.useState(Date.now())
  const lastCountRef = React.useRef(0)
  const listRef = React.useRef<any>(null)
  const nearBottomRef = React.useRef(true)

  React.useEffect(function () {
    let alive = true
    let timer: any = null
    const tick = async (): Promise<void> => {
      try {
        const r = await fetch(API, { cache: 'no-store' })
        const j = r.ok ? await r.json() : { ok: false, reason: 'HTTP ' + r.status, messages: [], signatures: [] }
        if (alive) { setData(j); setNow(Date.now()) }
      } catch (e: any) {
        if (alive) setData({ ok: false, reason: String((e && e.message) || e), messages: [], signatures: [] })
      }
    }
    void tick()
    timer = setInterval(function () { void tick() }, POLL_MS)
    return function () { alive = false; if (timer) clearInterval(timer) }
  }, [])

  const msgs: Msg[] = Array.isArray(data.messages) ? data.messages : []
  const sigs: string[] = Array.isArray(data.signatures) ? data.signatures : []
  const shown = filterSig ? msgs.filter(function (m) { return m.sig === filterSig }) : msgs

  let maxN = 0
  for (const m of msgs) if ((m.n || 0) > maxN) maxN = m.n || 0
  let unread = 0
  for (const m of msgs) if ((m.n || 0) > lastCountRef.current) unread++

  React.useEffect(function () {
    const el = listRef.current
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight
    lastCountRef.current = maxN
  })

  const onScroll = function (): void {
    const el = listRef.current
    if (!el) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  const header = h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 10px',
      borderBottom: '1px solid #e1e4e8', background: '#fff', flex: 'none', flexWrap: 'wrap',
    },
  },
    h('span', { style: { fontWeight: 700, fontSize: '13px', color: '#1f3b63' } }, '代理对话'),
    unread > 0 ? h('span', {
      style: { background: '#c05050', color: '#fff', borderRadius: '9px', padding: '1px 7px', fontSize: '11px' },
    }, unread + ' 新') : null,
    h('span', { style: { flex: 1 } }),
    h('select', {
      value: filterSig,
      onChange: function (e: any) { setFilterSig(e.target.value) },
      style: { fontSize: '11px', border: '1px solid #d0d7de', borderRadius: '4px', padding: '2px 4px' },
    },
      h('option', { value: '' }, '全部'),
      sigs.map(function (s) { return h('option', { key: s, value: s }, s) }),
    ),
    h('button', {
      onClick: function () { setCollapsed(!collapsed) },
      style: { fontSize: '11px', border: '1px solid #d0d7de', background: '#fff', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', marginLeft: '4px' },
    }, collapsed ? '展开' : '收起'),
  )

  let listChildren: any
  if (collapsed) {
    listChildren = null
  } else if (!data.ok) {
    listChildren = h('div', { style: { padding: '12px', color: '#c05050', fontSize: '12px' } },
      '读不到 thread.md（' + (data.reason || '未知') + '）',
      h('br'),
      h('span', { style: { color: '#888' } }, data.file || ''),
    )
  } else if (!shown.length) {
    listChildren = h('div', { style: { padding: '12px', color: '#888', fontSize: '12px' } }, '暂无消息')
  } else {
    listChildren = shown.map(function (m) {
      const c = colorOf(m.sig, sigs)
      const isNew = (m.n || 0) > lastCountRef.current
      return h('div', {
        key: m.n,
        id: 'agent-chat-msg-' + m.n,
        style: {
          borderLeft: '3px solid ' + c,
          background: isNew ? '#fffdf3' : '#fff',
          borderRadius: '4px', margin: '6px 0', padding: '6px 8px',
          boxShadow: '0 1px 2px rgba(0,0,0,.05)',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#666', marginBottom: '4px', flexWrap: 'wrap' } },
          h('span', {
            style: {
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '18px', height: '18px', borderRadius: '50%',
              background: c, color: '#fff', fontSize: '10px', fontWeight: 700,
            },
          }, String(m.sig || '?').slice(0, 2)),
          h('span', { style: { fontWeight: 700, color: '#333' } }, '#' + m.n + ' ' + m.sig),
          h('span', { title: m.time }, relTime(m.time, now)),
          m.replyTo != null ? h('a', {
            onClick: function () {
              const target = document.getElementById('agent-chat-msg-' + m.replyTo)
              if (target && (target as any).scrollIntoView) (target as any).scrollIntoView({ behavior: 'smooth', block: 'center' })
            },
            style: { color: c, textDecoration: 'underline', cursor: 'pointer' },
          }, '\u21a9 #' + m.replyTo) : null,
          m.model ? h('span', { style: { color: '#aaa' } }, '(' + String(m.model).slice(0, 28) + ')') : null,
        ),
        h('div', {
          style: { fontSize: '12.5px', lineHeight: 1.65, color: '#222' },
          dangerouslySetInnerHTML: { __html: md(m.text || '') },
        }),
      )
    })
  }

  const list = h('div', {
    ref: listRef,
    onScroll: onScroll,
    style: {
      flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 10px',
      display: collapsed ? 'none' : 'block',
    },
  }, listChildren)

  return h('div', {
    style: {
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
      fontFamily: 'system-ui,-apple-system,"Segoe UI",sans-serif', background: '#fafbfc',
    },
  }, header, list)
}

export function apply(ctx: any): void {
  // 阶段 1：声明 tab 类型
  ctx.effect(function () {
    return ctx.sidebarRightTabs.register({
      id: TAB_ID,
      kind: TAB_KIND,
      title: function () { return TAB_TITLE },
      keepMounted: true,
    })
  }, 'dsh-agent-chat: tab type')

  // 阶段 2：注册正文
  ctx.effect(function () {
    return ctx.slots.inject('sidebar.right.pane.tab', function () {
      return ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, AgentChatBody)
    })
  }, 'dsh-agent-chat: tab body')

  // 首次进入时把它开出来（用户不用去找）
  ctx.effect(function () {
    try {
      ctx.sidebarRight.openTab(TAB_KIND)
    } catch (e) {
      // 侧栏还没就绪就等下次；不因为开不出面板而崩掉插件
    }
    return function () {}
  }, 'dsh-agent-chat: open')
}
