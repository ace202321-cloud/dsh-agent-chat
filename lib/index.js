/**
 * @dsh-external/dsh-agent-chat — host 侧
 *
 * 职责：只读代理邮箱 `thread.md`，解析成结构化 JSON，供 client 面板消费。
 * 不写文件、不碰其他代理的状态 —— 单一真相源永远是 thread.md 本身。
 */
import fs from 'node:fs'
import path from 'node:path'

export const name = '@dsh-external/dsh-agent-chat'

/** 只依赖 webServer（挂一个只读 API） */
export const inject = ['webServer']

/** 邮箱根目录：可用配置覆盖，默认固定路径 */
const DEFAULT_MAILBOX = 'C:/Users/Lenovo/agent-mailbox'

/** 单条消息的标题行： ### [#2] CC · 2026-10-18 13:53 */
const HEAD_RE = /^###\s*\[#(\d+)\]\s*([^·\s]+)\s*·\s*(.+?)\s*$/

/**
 * 解析 thread.md。
 * 容错原则：任何一行解析失败都跳过，绝不让整个面板挂掉。
 */
function parseThread(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const msgs = []
  let cur = null

  for (const line of lines) {
    const m = HEAD_RE.exec(line)
    if (m) {
      if (cur) msgs.push(cur)
      cur = { n: Number(m[1]), sig: m[2], time: m[3].trim(), model: '', replyTo: null, body: [] }
      continue
    }
    if (!cur) continue

    // 元信息行
    const mM = /^\*\*模型\*\*\s*[：:]\s*(.*)$/.exec(line.trim())
    if (mM) { cur.model = mM[1].trim(); continue }
    const mR = /^\*\*回复给\*\*\s*[：:]\s*#?(\d+)/.exec(line.trim())
    if (mR) { cur.replyTo = Number(mR[1]); continue }

    cur.body.push(line)
  }
  if (cur) msgs.push(cur)

  // 去掉正文首尾空行
  for (const m of msgs) {
    while (m.body.length && !m.body[0].trim()) m.body.shift()
    while (m.body.length && !m.body[m.body.length - 1].trim()) m.body.pop()
    m.text = m.body.join('\n')
    delete m.body
  }
  return msgs
}

/** 安全读文件（不存在 / 空 / 读失败都返回空串） */
function safeRead(file) {
  try {
    if (!fs.existsSync(file)) return { ok: false, text: '', mtime: 0, size: 0, reason: 'missing' }
    const st = fs.statSync(file)
    return { ok: true, text: fs.readFileSync(file, 'utf8'), mtime: st.mtimeMs, size: st.size, reason: 'ok' }
  } catch (e) {
    return { ok: false, text: '', mtime: 0, size: 0, reason: String(e && e.message || e) }
  }
}

export function apply(ctx, config) {
  const mailbox = (config && config.mailbox) || DEFAULT_MAILBOX
  const threadFile = path.join(mailbox, 'thread.md')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/@dsh-external/dsh-agent-chat/api',
    handler: async (req, res) => {
      const r = safeRead(threadFile)
      const messages = parseThread(r.text)

      // 署名集合（按出现顺序，供前端做颜色分配）
      const sigs = []
      for (const m of messages) if (!sigs.includes(m.sig)) sigs.push(m.sig)

      const payload = JSON.stringify({
        ok: r.ok,
        reason: r.reason,
        file: threadFile,
        mtime: r.mtime,
        size: r.size,
        count: messages.length,
        signatures: sigs,
        messages,
      })

      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(payload)
    },
  }), '@dsh-external/dsh-agent-chat: api')
}
