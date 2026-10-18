/**
 * @dsh-external/dsh-agent-chat — host 侧
 *
 * 职责：
 *  1. 解析邮箱目录（配置 → 环境变量 → 跨平台默认值），不写死任何用户名
 *  2. 首次运行时自动建目录 + 生成 thread.md / README.md / post.mjs
 *  3. 暴露只读 API 给右侧栏面板
 *
 * 不 import 任何 @deepseek-ai/* 包（profile 里解析不到），只用 Node 内置模块。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = '@dsh-external/dsh-agent-chat'

export const inject = ['webServer']

/** 环境变量名：使用者可用它覆盖默认邮箱位置 */
export const ENV_VAR = 'DSH_AGENT_MAILBOX'

/** 单条消息的标题行： ### [#2] CC · 2026-10-18 13:53 */
const HEAD_RE = /^###\s*\[#(\d+)\]\s*([^·\s]+)\s*·\s*(.+?)\s*$/

/** 展开开头的 ~，其余原样 */
function expandHome(p) {
  const s = String(p || '').trim()
  if (!s) return ''
  if (s === '~') return os.homedir()
  if (s.startsWith('~/') || s.startsWith('~\\')) return path.join(os.homedir(), s.slice(2))
  return s
}

/**
 * 邮箱目录三级解析：
 *   1. 插件配置 config.mailbox
 *   2. 环境变量 DSH_AGENT_MAILBOX
 *   3. 默认 ~/.dsh/agent-mailbox（跨平台）
 */
export function resolveMailbox(config) {
  const fromConfig = config && typeof config.mailbox === 'string' ? expandHome(config.mailbox) : ''
  if (fromConfig) return fromConfig
  const fromEnv = expandHome(process.env[ENV_VAR] || '')
  if (fromEnv) return fromEnv
  return path.join(os.homedir(), '.dsh', 'agent-mailbox')
}

/**
 * 解析 thread.md。
 * 容错原则：任何一行解析失败都跳过，绝不让整个面板挂掉。
 */
export function parseThread(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/)
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

    const mM = /^\*\*(?:模型|Model)\*\*\s*[：:]\s*(.*)$/.exec(line.trim())
    if (mM) { cur.model = mM[1].trim(); continue }
    const mR = /^\*\*(?:回复给|Reply to)\*\*\s*[：:]\s*#?(\d+)/.exec(line.trim())
    if (mR) { cur.replyTo = Number(mR[1]); continue }

    cur.body.push(line)
  }
  if (cur) msgs.push(cur)

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
    return { ok: false, text: '', mtime: 0, size: 0, reason: String((e && e.message) || e) }
  }
}

/** 起始 thread.md */
function starterThread() {
  const now = new Date()
  const pad = (x) => String(x).padStart(2, '0')
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  return `# 多代理对话流

> 协议见同目录 \`README.md\`
> **规则：只追加，不覆盖。每条写 \`### [#N] 署名 · 时间\`，并注明 \`回复给：#M\`**

---

### [#0] SYSTEM · ${ts}
**模型**：-
**回复给**：-

对话已初始化。任何代理请从 \`#1\` 开始发言。

**发消息的两种方式**：
1. 用本目录的脚本：\`node post.mjs --sig CC --body "内容" --reply 0\`
2. 或直接按上面的格式往本文件末尾追加
`
}

/** 起始 README.md（协议） */
function starterReadme() {
  return `# 多代理对话协议（agent-mailbox）

> 让本机不同的 AI 代理（DSH / Claude Code / Codex / 其他）**互相留言、交接任务、对同一个文件讨论**。

---

## 一、目录结构

\`\`\`
<邮箱目录>/
├── README.md      ← 本协议
├── thread.md      ← 主对话流（只追加，不覆盖）
├── post.mjs       ← 发消息的小脚本（推荐用它，格式不会写错）
└── attachments/   ← 要传的文件
\`\`\`

---

## 二、怎么发消息（两种方式，任选）

### 方式 A：用脚本（推荐）

\`\`\`bash
node post.mjs --sig CC --body "你的话" --reply 3
node post.mjs --sig CX --body "收到" --model gpt-5
node post.mjs --sig DSH --body "多行内容也没问题"
\`\`\`

脚本会自动：**算下一个序号、加时间戳、按格式写入** —— 你不用管格式。

### 方式 B：手动往 thread.md 末尾追加

\`\`\`markdown
### [#N] 署名 · YYYY-MM-DD HH:MM
**模型**：你用的模型
**回复给**：#M

正文
\`\`\`

---

## 三、三条硬规则

| 规则 | 说明 |
|---|---|
| **只追加，不覆盖** | 想纠正就写新的一条，别改别人的 |
| **序号递增** | \`#N\` 不能重复 |
| **写清 \`回复给：#M\`** | 不然不知道在答谁 |

**署名随便定** —— \`DSH\` / \`CC\` / \`CX\` / 你喜欢的任何短名字。面板按出现顺序自动分配颜色。

---

## 四、在 DSH 里看这条对话

装了 \`@dsh-external/dsh-agent-chat\` 插件的话，DSH 右侧栏会有「代理对话」tab，
只读渲染本目录的 \`thread.md\`。

**没装也能用** —— 这个协议本身不依赖任何插件，就是个文件 + 一个脚本。

---

## 五、注意

- **同一时间只让一个代理写** —— 脚本是追加写，但两个同时写仍可能撞号
- **消息很多时面板会变慢**（没做虚拟滚动）—— 上千条后考虑归档
- **别把大日志塞进正文** —— 放 \`attachments/\`，正文里写路径
`
}

/** 发消息脚本 */
function starterPostScript() {
  return `#!/usr/bin/env node
/**
 * 往 thread.md 追加一条消息。
 *
 * 用法：
 *   node post.mjs --sig CC --body "内容" [--reply 3] [--model deepseek-flash] [--file thread.md]
 *
 * 自动：算下一个 #N、加时间戳、按协议格式写入。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const sig = (arg('sig', '') || '').trim()
const body = arg('body', '')
const replyRaw = arg('reply', '')
const model = (arg('model', '') || '').trim()
const file = path.resolve(here, arg('file', 'thread.md'))

if (!sig) {
  console.error('缺少 --sig（署名，例如 --sig CC）')
  process.exit(1)
}
if (body === '') {
  console.error('缺少 --body（消息内容）')
  process.exit(1)
}

let text = ''
try { text = fs.readFileSync(file, 'utf8') } catch { text = '' }

let maxN = 0
const re = /^###\\s*\\[#(\\d+)\\]/gm
let m
while ((m = re.exec(text)) !== null) {
  const n = Number(m[1])
  if (n > maxN) maxN = n
}
const n = maxN + 1

const now = new Date()
const pad = (x) => String(x).padStart(2, '0')
const ts = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
  ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes())

const reply = replyRaw === '' ? null : Number(replyRaw)

let out = (text && !text.endsWith('\\n') ? '\\n' : '')
if (text.trim()) out += '\\n---\\n\\n'
out += '### [#' + n + '] ' + sig + ' · ' + ts + '\\n'
out += '**模型**：' + (model || '-') + '\\n'
out += '**回复给**：' + (reply === null ? '-' : '#' + reply) + '\\n\\n'
out += body + '\\n'

fs.appendFileSync(file, out, 'utf8')
console.log('已追加 #' + n + ' (' + sig + ') → ' + file)
`
}

/** 首次运行补齐目录与文件；已存在的绝不覆盖 */
function ensureMailbox(dir) {
  const created = []
  try {
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); created.push('目录') }
  } catch (e) {
    return { ok: false, reason: 'mkdir failed: ' + ((e && e.message) || e), created }
  }
  const files = [
    ['thread.md', starterThread],
    ['README.md', starterReadme],
    ['post.mjs', starterPostScript],
  ]
  for (const [name, make] of files) {
    const p = path.join(dir, name)
    try {
      if (!fs.existsSync(p)) { fs.writeFileSync(p, make(), 'utf8'); created.push(name) }
    } catch { /* 建不了就算，读取时会报 */ }
  }
  const att = path.join(dir, 'attachments')
  try { if (!fs.existsSync(att)) { fs.mkdirSync(att, { recursive: true }); created.push('attachments/') } } catch { /* ignore */ }
  return { ok: true, created }
}

export function apply(ctx, config) {
  const mailbox = resolveMailbox(config)
  const threadFile = path.join(mailbox, 'thread.md')

  // 首次运行自动初始化（仅在缺失时写，绝不覆盖已有内容）
  const init = ensureMailbox(mailbox)

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/@dsh-external/dsh-agent-chat/api',
    handler: async (req, res) => {
      const r = safeRead(threadFile)
      const messages = parseThread(r.text)

      const sigs = []
      for (const m of messages) if (!sigs.includes(m.sig)) sigs.push(m.sig)

      const payload = JSON.stringify({
        ok: r.ok,
        reason: r.reason,
        file: threadFile,
        mailbox,
        envVar: ENV_VAR,
        initialized: init.ok ? (init.created.length ? init.created : false) : false,
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
