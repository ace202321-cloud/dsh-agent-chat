/**
 * @dsh-external/dsh-agent-chat — host 侧
 *
 * 职责：
 *  1. 解析邮箱目录（配置 → 环境变量 → 跨平台默认值），不写死任何用户名
 *  2. 首次运行时自动建目录 + 生成 thread.md / README.md / post.mjs
 *  3. 暴露只读 API 给右侧栏面板（带 mtime+size 缓存，避免每次同步解析整个文件）
 *
 * 不 import 任何 @deepseek-ai/* 包（profile 里解析不到），只用 Node 内置模块。
 *
 * 2026-10-18 修订（Codex + Claude Code 双审后）：
 *  - 剥 BOM（PowerShell 写的文件带 BOM 会吞掉首条消息）
 *  - parseThread 跟踪 Markdown 代码围栏（正文里的 `### [#N]` 不再被当真消息）
 *  - post.mjs 模板：校验署名、拒绝路径穿越、扫最大序号时也跳过围栏
 *  - API handler 整段 try/catch（抛错也要结束响应）
 *  - 解析结果按 mtime+size 缓存
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = '@dsh-external/dsh-agent-chat'

export const inject = ['webServer']

/** 环境变量名：使用者可用它覆盖默认邮箱位置 */
export const ENV_VAR = 'DSH_AGENT_MAILBOX'

/** 生成脚本的版本标记：内容变了就升级它，ensureMailbox 据此刷新老用户的脚本 */
const POST_VERSION = 'v2'

/** 单条消息的标题行： ### [#2] CC · 2026-10-18 13:53 （署名不含空格与中间点） */
const HEAD_RE = /^###\s*\[#(\d+)\]\s*([^\s·]+)\s*·\s*(.+?)\s*$/

/** 剥 UTF-8 BOM */
function stripBom(s) {
  return s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

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
 *
 * 容错原则：
 *  - 任何一行解析失败都跳过，绝不让整个面板挂掉
 *  - **代码围栏内的内容原样进正文**，不参与标题匹配
 *  - 元信息（**模型** / **回复给**）只在正文开始前认，避免占位块污染上一条
 */
export function parseThread(text) {
  const lines = stripBom(String(text == null ? '' : text)).split(/\r?\n/)
  const msgs = []
  let cur = null
  let inFence = false

  for (const line of lines) {
    // 代码围栏切换（``` 或 ~~~）
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence
      if (cur) cur.body.push(line)
      continue
    }
    if (inFence) {
      if (cur) cur.body.push(line)
      continue
    }

    const m = HEAD_RE.exec(line)
    if (m) {
      if (cur) msgs.push(cur)
      cur = { n: Number(m[1]), sig: m[2], time: m[3].trim(), model: '', replyTo: null, body: [], bodyStarted: false }
      continue
    }
    if (!cur) continue

    if (!cur.bodyStarted) {
      const mM = /^\*\*(?:模型|Model)\*\*\s*[：:]\s*(.*)$/.exec(line.trim())
      if (mM) { cur.model = mM[1].trim(); continue }
      const mR = /^\*\*(?:回复给|Reply to)\*\*\s*[：:]\s*#?(\d+)/.exec(line.trim())
      if (mR) { cur.replyTo = Number(mR[1]); continue }
      if (line.trim()) cur.bodyStarted = true
    }

    cur.body.push(line)
  }
  if (cur) msgs.push(cur)

  for (const m of msgs) {
    while (m.body.length && !m.body[0].trim()) m.body.shift()
    // 去掉尾部空行与分隔线：post.mjs 在每条新消息前写 `---`，它会落进上一条的正文
    for (;;) {
      if (!m.body.length) break
      const last = m.body[m.body.length - 1]
      if (!last.trim() || /^\s*-{3,}\s*$/.test(last)) { m.body.pop(); continue }
      break
    }
    m.text = m.body.join('\n')
    delete m.body
    delete m.bodyStarted
  }
  return msgs
}

/** 安全读文件（不存在 / 空 / 读失败都返回空串；自动剥 BOM） */
function safeRead(file) {
  try {
    if (!fs.existsSync(file)) return { ok: false, text: '', mtime: 0, size: 0, ctime: 0, reason: 'missing' }
    const st = fs.statSync(file)
    return { ok: true, text: stripBom(fs.readFileSync(file, 'utf8')), mtime: st.mtimeMs, size: st.size, ctime: st.ctimeMs, reason: 'ok' }
  } catch (e) {
    return { ok: false, text: '', mtime: 0, size: 0, ctime: 0, reason: String((e && e.message) || e) }
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

> ⚠️ 署名**不能带空格**（\`Claude Code\` 要写成 \`CC\`），否则消息边界会失效。
> ⚠️ 正文里要展示格式示例，请放进代码块 —— 代码块里的内容不会被当成真消息。
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

**署名规则**：\`DSH\` / \`CC\` / \`CX\` 这类短名字。**⚠️ 不能带空格和中间点 \`·\`** ——
\`Claude Code\` 要写成 \`CC\`，否则消息边界会失效、整条被并进上一条。

**在正文里展示格式示例时，请放进代码块** —— 代码块里的 \`### [#N]\` 不会被当成真消息。

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

/** 发消息脚本（模板版本见 utils，不要直接改这里） */
function starterPostScript() {
  return `#!/usr/bin/env node
/**
 * 往 thread.md 追加一条消息。   [模板版本: ${POST_VERSION}]
 *
 * 用法：
 *   node post.mjs --sig CC --body "内容" [--reply 3] [--model deepseek-flash] [--file thread.md]
 *
 * 自动：算下一个 #N（跳过代码围栏）、加时间戳、按协议格式写入。
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

if (!sig) {
  console.error('缺少 --sig（署名，例如 --sig CC）')
  process.exit(1)
}
// 署名不能含空白或中间点：它们会破坏 "### [#N] 署名 · 时间" 的消息边界
if (/[\\s·]/.test(sig)) {
  console.error('署名不能含空格或中间点 "·"（"Claude Code" 请写成 "CC"）')
  process.exit(1)
}
if (body === '') {
  console.error('缺少 --body（消息内容）')
  process.exit(1)
}

// --reply 必须是 >=0 的整数
const replyVal = replyRaw === '' ? null : Number(replyRaw)
if (replyVal !== null && (!Number.isInteger(replyVal) || replyVal < 0)) {
  console.error('--reply 必须是 >=0 的整数，收到: ' + replyRaw)
  process.exit(1)
}

// --file 必须落在邮箱目录内（防路径穿越；realpath 挡住符号链接/junction）
const file = path.resolve(here, arg('file', 'thread.md'))
const rel = path.relative(here, file)
if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
  console.error('--file 必须落在邮箱目录内，拒绝写入: ' + file)
  process.exit(1)
}
try {
  const realHere = fs.realpathSync(here)
  const realFile = fs.existsSync(file)
    ? fs.realpathSync(file)
    : path.join(fs.realpathSync(path.dirname(file)), path.basename(file))
  const realRel = path.relative(realHere, realFile)
  if (realRel === '..' || realRel.startsWith('..' + path.sep) || path.isAbsolute(realRel)) {
    console.error('--file 解析后落在邮箱目录外，拒绝写入: ' + realFile)
    process.exit(1)
  }
} catch (e) {
  console.error('--file 路径校验失败: ' + ((e && e.message) || e))
  process.exit(1)
}

// 排他锁：两个代理同时发消息时避免撞号
const lockFile = file + '.lock'
let lockFd = null
for (let i = 0; i < 100 && lockFd === null; i++) {
  try { lockFd = fs.openSync(lockFile, 'wx') } catch { /* 被占，等一会 */ }
  if (lockFd === null) { const until = Date.now() + 20; while (Date.now() < until) { /* spin */ } }
}
if (lockFd === null) {
  console.error('拿不到写锁（另一个代理正在写？）：' + lockFile)
  process.exit(1)
}

try {
let text = ''
try { text = fs.readFileSync(file, 'utf8') } catch { text = '' }
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

// 扫最大序号，跳过代码围栏内的内容；用和 host 一样的完整头行正则
let maxN = 0
let inFence = false
for (const line of text.split(/\\r?\\n/)) {
  if (/^\\s*(?:\`\`\`|~~~)/.test(line)) { inFence = !inFence; continue }
  if (inFence) continue
  const m = /^###\\s*\\[#(\\d+)\\]\\s*[^\\s·]+\\s*·\\s*\\S+/.exec(line)
  if (m) { const n = Number(m[1]); if (n > maxN) maxN = n }
}
const n = maxN + 1

const now = new Date()
const pad = (x) => String(x).padStart(2, '0')
const ts = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
  ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes())

const reply = replyVal

let out = (text && !text.endsWith('\\n') ? '\\n' : '')
if (text.trim()) out += '\\n'
out += '### [#' + n + '] ' + sig + ' · ' + ts + '\\n'
out += '**模型**：' + (model || '-') + '\\n'
out += '**回复给**：' + (reply === null ? '-' : '#' + reply) + '\\n\\n'
out += body + '\\n'

fs.appendFileSync(file, out, 'utf8')
console.log('已追加 #' + n + ' (' + sig + ') → ' + file)
} finally {
  try { fs.closeSync(lockFd) } catch { /* ignore */ }
  try { fs.unlinkSync(lockFile) } catch { /* ignore */ }
}
`
}

/** 首次运行补齐目录与文件；已存在的 thread.md / README.md 绝不覆盖，post.mjs 按版本号刷新 */
function ensureMailbox(dir) {
  const created = []
  const updated = []
  try {
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); created.push('目录') }
  } catch (e) {
    return { ok: false, reason: 'mkdir failed: ' + ((e && e.message) || e), created, updated }
  }

  const writeIfMissing = (name, make) => {
    const p = path.join(dir, name)
    try {
      if (!fs.existsSync(p)) { fs.writeFileSync(p, make(), 'utf8'); created.push(name) }
    } catch { /* ignore */ }
  }

  writeIfMissing('thread.md', starterThread)
  writeIfMissing('README.md', starterReadme)

  // post.mjs：升级到当前模板。
  // 判定条件是「没有当前版本标记」而不是「有旧版本标记」——
  // 第一版模板压根没有标记，用旧条件会导致永远升不上来。
  // 只在文件仍含本插件特征、且没有 USER-MODIFIED 标记时才覆盖。
  const postPath = path.join(dir, 'post.mjs')
  const want = starterPostScript()
  try {
    if (!fs.existsSync(postPath)) {
      fs.writeFileSync(postPath, want, 'utf8')
      created.push('post.mjs')
    } else {
      const cur = fs.readFileSync(postPath, 'utf8')
      const upToDate = cur.includes('[模板版本: ' + POST_VERSION + ']')
      const looksOurs = cur.indexOf("已追加 #' + n") >= 0 && cur.indexOf('USER-MODIFIED') < 0
      if (!upToDate && looksOurs) {
        fs.writeFileSync(postPath, want, 'utf8')
        updated.push('post.mjs')
      }
    }
  } catch { /* ignore */ }

  const att = path.join(dir, 'attachments')
  try { if (!fs.existsSync(att)) { fs.mkdirSync(att, { recursive: true }); created.push('attachments/') } } catch { /* ignore */ }
  return { ok: true, created, updated }
}

export function apply(ctx, config) {
  const mailbox = resolveMailbox(config)
  const threadFile = path.join(mailbox, 'thread.md')

  const init = ensureMailbox(mailbox)

  // 解析结果缓存：按 mtime+size 命中，避免每次轮询都同步解析整个文件
  const cache = { key: '', payload: null }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/@dsh-external/dsh-agent-chat/api',
    handler: async (req, res) => {
      try {
        const r = safeRead(threadFile)
        // ctime 一起参与 key：SMB/FAT 的 mtime 粒度粗，同 mtime 同 size 的原地编辑会命中旧缓存
        const key = r.mtime + ':' + r.ctime + ':' + r.size + ':' + (r.ok ? 1 : 0)

        let body
        if (cache.payload && cache.key === key) {
          body = cache.payload
        } else {
          const messages = parseThread(r.text)
          const sigs = []
          for (const m of messages) if (!sigs.includes(m.sig)) sigs.push(m.sig)
          body = JSON.stringify({
            ok: r.ok,
            reason: r.reason,
            file: threadFile,
            mailbox,
            envVar: ENV_VAR,
            initialized: init.ok ? (init.created.length || init.updated.length ? { created: init.created, updated: init.updated } : false) : false,
            mtime: r.mtime,
            size: r.size,
            count: messages.length,
            signatures: sigs,
            messages,
          })
          cache.key = key
          cache.payload = body
        }

        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(body)
      } catch (e) {
        // 无论如何都要结束响应，否则客户端会永久挂起并叠积轮询
        try {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, reason: String((e && e.message) || e), messages: [], signatures: [] }))
        } catch { /* ignore */ }
      }
    },
  }), '@dsh-external/dsh-agent-chat: api')
}
