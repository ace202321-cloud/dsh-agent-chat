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
const POST_VERSION = 'v6'

/** 单条消息的标题行： ### [#2] CC · 2026-10-18 13:53 （署名不含空格与中间点） */
const HEAD_RE = /^###\s*\[#(\d+)\]\s*([^\s·]+)\s*·\s*(.+?)\s*$/

/**
 * 消息状态机（借鉴 ai-memory 的 handoff 协议：每条交接有 owner、可追踪状态、只被认领一次）
 *
 *   open      刚发出，还没有人接
 *   claimed   某个代理已认领，正在办
 *   done      办完了
 *
 * 空字符串 = 老消息（v0.3.x 写的），一律按「无状态」处理，不参与待办计数。
 */
const STATUSES = ['open', 'claimed', 'done']

/**
 * 阶段（借 brianyu18/devteam 的 7 阶段）。
 * `status` 说「办没办完」，`phase` 说「办到哪一步了」—— 两者互补，不是重复。
 */
const PHASES = ['think', 'plan', 'build', 'review', 'test', 'ship', 'reflect']

/** 老消息没有状态字段；只有显式写了 open/claimed/done 的才算进状态机 */
function normalizeStatus(v) {
  const s = String(v || '').toLowerCase()
  return STATUSES.includes(s) ? s : ''
}

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
      cur = {
        n: Number(m[1]), sig: m[2], time: m[3].trim(),
        model: '', replyTo: null, assign: '', status: '',
        // v0.5 新增（借 parallel-claude-agents / devteam 的协议字段）
        ack: false, priority: '', phase: '', scope: '',
        body: [], bodyStarted: false,
      }
      continue
    }
    if (!cur) continue

    if (!cur.bodyStarted) {
      const t = line.trim()
      // 元信息行：**模型** / **回复给** / **指派** / **状态** / **需回执** / **优先级** / **阶段** / **范围**
      // ⚠️ 每条都必须「认出就 continue」，否则 `**回复给**：-`（短横线）
      //    会被当成正文，把后面的字段全吞掉（v0.3.x 遗留 bug）
      if (t) {
        const mM = /^\*\*(?:模型|Model)\*\*\s*[：:]\s*(.*)$/.exec(t)
        if (mM) { cur.model = mM[1].trim(); continue }
        const mR = /^\*\*(?:回复给|Reply to)\*\*\s*[：:]\s*(.*)$/.exec(t)
        if (mR) {
          const v = mR[1].trim().replace(/^#/, '')
          cur.replyTo = /^\d+$/.test(v) ? Number(v) : null
          continue
        }
        const mA = /^\*\*(?:指派|Assign(?:ed)?)\*\*\s*[：:]\s*(.*)$/.exec(t)
        if (mA) { const v = mA[1].trim(); cur.assign = v === '-' ? '' : v; continue }
        const mS = /^\*\*(?:状态|Status)\*\*\s*[：:]\s*(\S+)/.exec(t)
        if (mS) { cur.status = normalizeStatus(mS[1]); continue }
        // 需回执：yes/true/1 才为真；其余（no/-/空）都当不需要
        const mAck = /^\*\*(?:需回执|Ack(?:nowledge)?)\*\*\s*[：:]\s*(\S*)/.exec(t)
        if (mAck) { cur.ack = /^(?:yes|true|1|是)$/i.test(mAck[1].trim()); continue }
        const mP = /^\*\*(?:优先级|Priority)\*\*\s*[：:]\s*(\S+)/.exec(t)
        if (mP) { const v = mP[1].toLowerCase(); cur.priority = v === 'critical' ? 'critical' : (v === 'info' ? 'info' : ''); continue }
        const mPh = /^\*\*(?:阶段|Phase)\*\*\s*[：:]\s*(\S+)/.exec(t)
        if (mPh) { const v = mPh[1].toLowerCase(); cur.phase = PHASES.indexOf(v) >= 0 ? v : ''; continue }
        const mSc = /^\*\*(?:范围|Scope)\*\*\s*[：:]\s*(.*)$/.exec(t)
        if (mSc) { const v = mSc[1].trim(); cur.scope = v === '-' ? '' : v; continue }
      }
      if (t) cur.bodyStarted = true
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

## 三点五、指派与状态（可选，但派活时强烈建议用）

给消息加两个可选元信息：**谁负责** 和 **办到哪一步**。右侧栏会据此显示「N 条待办」徽章，
还能点「只看未完成」过滤。

\`\`\`markdown
### [#8] DSH · 2026-10-25 12:30
**模型**：deepseek-flash
**回复给**：#7
**指派**：CX
**状态**：open

请把 README 的英文版补齐。
\`\`\`

| 字段 | 取值 | 说明 |
|---|---|---|
| \`**指派**\` | 任何短署名（如 \`CX\` \`CC\`） | 省略 = 未指派 |
| \`**状态**\` | \`open\` / \`claimed\` / \`done\` | 省略 = 不参与待办计数 |

**状态含义**：

- \`open\` —— 刚发出，还没人接（红色「待接」）
- \`claimed\` —— 有人认领了，正在办（橙色「进行中」）
- \`done\` —— 办完了（绿色「已完成」，卡片自动变淡）

**⚠️ 老消息没有这两个字段，一律按「无状态」处理，不会影响任何现有内容。**

用脚本发时直接带参数：

\`\`\`bash
node post.mjs --sig DSH --body "请审这个 diff" --assign CX --status open
node post.mjs --sig CX  --body "已认领，开始看"   --reply 8 --assign CX --status claimed
node post.mjs --sig CX  --body "审完了，3 个问题"  --reply 8 --status done
\`\`\`

---

## 四、在 DSH 里看这条对话

装了 \`@dsh-external/dsh-agent-chat\` 插件的话，DSH 右侧栏会有「代理对话」tab，
只读渲染本目录的 \`thread.md\`。

**没装也能用** —— 这个协议本身不依赖任何插件，就是个文件 + 一个脚本。

---

## 五、已知限制（诚实一点）

| 限制 | 说明 |
|---|---|
| **不是实时** | 面板每 2 秒轮询一次，不是推送 |
| **大文件会变慢** | \`thread.md\` 超过约 500 KB 后解析明显变慢（没做虚拟滚动） |
| **单机自用** | 没有多用户认证，也别把邮箱目录放共享盘让多人写 |
| **无锁跨机** | 脚本有本机排他锁，但跨网络共享目录仍可能撞号 |
| **状态靠手写** | \`open/claimed/done\` 要发消息的人自己填，没有自动推进 |
| **不做检索** | 只按署名筛选 + 全文顺序显示，没有语义搜索 |
`
}

/** 发消息脚本（模板版本见 utils，不要直接改这里） */
function starterPostScript() {
  return `#!/usr/bin/env node
/**
 * 往 thread.md 追加一条消息。   [模板版本: ${POST_VERSION}]
 *
 * 用法：
 *   node post.mjs --sig CC --body "内容" [--reply 3] [--model deepseek-flash] [--assign CX] [--status open] [--file thread.md]
 *   node post.mjs --sig CC --body-file ./body.md      # 多行正文推荐这个，绕开 Windows 引号地狱
 *   node post.mjs --sig CX --reply 15 --close 15      # 发完顺便把 #15 标成 done
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
const bodyFile = (arg('body-file', '') || '').trim()
let body = arg('body', '')
const replyRaw = arg('reply', '')
const model = (arg('model', '') || '').trim()
const assign = (arg('assign', '') || '').trim()
const statusRaw = (arg('status', '') || '').trim().toLowerCase()
const closeRaw = arg('close', '')
// v0.5 新增（借 sbnsec/parallel-claude-agents 与 brianyu18/devteam 的协议字段）
const ack = process.argv.includes('--ack')
const priorityRaw = (arg('priority', '') || '').trim().toLowerCase()
const phaseRaw = (arg('phase', '') || '').trim().toLowerCase()
const scope = (arg('scope', '') || '').trim()
const force = process.argv.includes('--force')

// --body-file：从文件读正文，优先于 --body。
// Windows 下 cmd/ps 传多行字符串很容易被截断（换行把命令行切断），用它最省事。
if (bodyFile) {
  try {
    body = fs.readFileSync(path.resolve(here, bodyFile), 'utf8')
    if (body.charCodeAt(0) === 0xfeff) body = body.slice(1)
    body = body.replace(/\\r\\n/g, '\\n')
  } catch (e) {
    console.error('读不到 --body-file: ' + bodyFile + '  (' + ((e && e.message) || e) + ')')
    process.exit(1)
  }
}

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

// --status 只能是 open / claimed / done
const STATUSES = ['open', 'claimed', 'done']
if (statusRaw && STATUSES.indexOf(statusRaw) < 0) {
  console.error('--status 只能是 open / claimed / done，收到: ' + statusRaw)
  process.exit(1)
}

// --priority 只能是 info / critical
if (priorityRaw && priorityRaw !== 'info' && priorityRaw !== 'critical') {
  console.error('--priority 只能是 info 或 critical，收到: ' + priorityRaw)
  process.exit(1)
}

// --phase 只能是这七个之一
const PHASES = ['think', 'plan', 'build', 'review', 'test', 'ship', 'reflect']
if (phaseRaw && PHASES.indexOf(phaseRaw) < 0) {
  console.error('--phase 只能是 ' + PHASES.join(' / ') + '，收到: ' + phaseRaw)
  process.exit(1)
}

// --assign 同样不能含空白或中间点，否则会破坏元信息行解析
if (/[\\s·]/.test(assign)) {
  console.error('--assign 不能含空格或中间点 "·"')
  process.exit(1)
}

// --close N：发完这条，顺便把 #N 的 **状态** 改成 done（只动那一行）
const closeVal = closeRaw === '' ? null : Number(closeRaw)
if (closeVal !== null && (!Number.isInteger(closeVal) || closeVal < 0)) {
  console.error('--close 必须是 >=0 的整数，收到: ' + closeRaw)
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

// ⚠️ 必须在拿到锁之后立刻挂上：process.exit() 不会执行 finally，
// 之前 dedup 里 process.exit(2) 就把锁文件永久留下了，后面谁都发不出去。
process.on('exit', function () {
  try { if (lockFd !== null) fs.closeSync(lockFd) } catch { /* ignore */ }
  try { fs.unlinkSync(lockFile) } catch { /* ignore */ }
})

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

// 防重复（借鉴 agent-postbox）：同署名 + 同正文，60 秒内重发同一句视为误触
// 除非显式加 --force，否则拒绝并提示
const DEDUP_WINDOW_MS = 60000
try {
  const tail = text.slice(-4000)
  const escSig = sig.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')
  const dupRe = new RegExp('###\\\\s*\\\\[#\\\\d+\\\\]\\\\s*' + escSig + '\\\\s*·\\\\s*([^\\\\n]+)')
  const dm = dupRe.exec(tail)
  if (dm) {
    const lastTs = dm[1].trim()
    const d = new Date(lastTs.replace(' ', 'T'))
    if (!isNaN(d.getTime()) && Date.now() - d.getTime() < DEDUP_WINDOW_MS) {
      const afterHead = tail.slice(dm.index)
      if (afterHead.indexOf(body.trim().slice(0, 80)) >= 0) {
        console.error('疑似重复提交：' + sig + ' 在 ' + Math.round((Date.now() - d.getTime()) / 1000) + ' 秒前发过同样的内容。')
        console.error('确实要再发一次，请加 --force')
        if (!force) process.exit(2)
      }
    }
  }
} catch { /* 检查本身失败不阻塞发送 */ }

let out = (text && !text.endsWith('\\n') ? '\\n' : '')
if (text.trim()) out += '\\n'
out += '### [#' + n + '] ' + sig + ' · ' + ts + '\\n'
out += '**模型**：' + (model || '-') + '\\n'
out += '**回复给**：' + (reply === null ? '-' : '#' + reply) + '\\n'
if (assign) out += '**指派**：' + assign + '\\n'
if (statusRaw) out += '**状态**：' + statusRaw + '\\n'
if (ack) out += '**需回执**：yes\\n'
if (priorityRaw) out += '**优先级**：' + priorityRaw + '\\n'
if (phaseRaw) out += '**阶段**：' + phaseRaw + '\\n'
if (scope) out += '**范围**：' + scope + '\\n'
out += '\\n'
out += body + '\\n'

fs.appendFileSync(file, out, 'utf8')

// 写后回读校验（借鉴 agent-postbox）：确认真的落盘了，别报"成功"但没写进去
try {
  const after = fs.readFileSync(file, 'utf8')
  if (after.indexOf('### [#' + n + '] ' + sig + ' · ' + ts) < 0) {
    console.error('回读校验失败：写入后在文件里找不到这条消息的头行。')
    process.exit(3)
  }
  if (!after.trimEnd().endsWith(body.trimEnd())) {
    console.error('回读校验警告：正文结尾与预期不一致（可能有并发写入）。')
  }
} catch (e) {
  console.error('回读校验失败: ' + ((e && e.message) || e))
  process.exit(3)
}

// --close N：把 #N 的 **状态** 改成 done（只动那一行，其余原样）
// 回复别人的单子时用这个，省得手工去改原消息。
if (closeVal !== null) {
  try {
    const cur = fs.readFileSync(file, 'utf8')
    const lines = cur.split(/\\r?\\n/)
    let inTarget = false
    let changed = false
    for (let i = 0; i < lines.length; i++) {
      const hm = /^###\\s*\\[#(\\d+)\\]/.exec(lines[i])
      if (hm) { inTarget = Number(hm[1]) === closeVal; continue }
      if (!inTarget) continue
      const t = lines[i].trim()
      if (/^\\*\\*(?:状态|Status)\\*\\*\\s*[：:]/.test(t)) {
        lines[i] = '**状态**：done'
        changed = true
        break
      }
      // 已经进正文还没看到状态行：停下，不擅自插行（避免破坏别人的格式）
      if (t && t.indexOf('**') !== 0) break
    }
    if (changed) {
      fs.writeFileSync(file, lines.join('\\n'), 'utf8')
      console.log('已把 #' + closeVal + ' 标为 done')
    } else {
      console.error('提示：#' + closeVal + ' 没有 **状态** 行，未改动')
    }
  } catch (e) {
    console.error('--close 处理失败: ' + ((e && e.message) || e))
  }
}

console.log('已追加 #' + n + ' (' + sig + ') → ' + file)
} finally {
  try { fs.closeSync(lockFd) } catch { /* ignore */ }
  try { fs.unlinkSync(lockFile) } catch { /* ignore */ }
}
`
}

/**
 * 「有界 brief」脚本：给新加入的代理一个够用但不冗长的上下文，
 * 避免把整个 thread 塞进 prompt（借鉴 ai-memory 的 bounded brief）。
 */
function starterBriefScript() {
  return `#!/usr/bin/env node
/**
 * 打印 thread.md 的有界摘要：未完成项 + 最近 N 条。
 *
 * 用法：
 *   node brief.mjs                 # 最近 8 条
 *   node brief.mjs --recent 15
 *   node brief.mjs --json          # 机器可读
 *   node brief.mjs --file other.md
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}
const asJson = process.argv.includes('--json')
const recentN = Math.max(1, Number(arg('recent', '8')) || 8)
const file = path.resolve(here, arg('file', 'thread.md'))

let text = ''
try { text = fs.readFileSync(file, 'utf8') } catch {
  console.error('读不到 ' + file)
  process.exit(1)
}
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

const HEAD = /^###\\s*\\[#(\\d+)\\]\\s*([^\\s·]+)\\s*·\\s*(.+?)\\s*$/
const STATUSES = ['open', 'claimed', 'done']
const msgs = []
let cur = null
let inFence = false
for (const line of text.split(/\\r?\\n/)) {
  if (/^\\s*(?:\`\`\`|~~~)/.test(line)) { inFence = !inFence; if (cur) cur.body.push(line); continue }
  if (inFence) { if (cur) cur.body.push(line); continue }
  const m = HEAD.exec(line)
  if (m) {
    if (cur) msgs.push(cur)
    cur = { n: Number(m[1]), sig: m[2], time: m[3].trim(), assign: '', status: '', body: [] }
    continue
  }
  if (!cur) continue
  const t = line.trim()
  const mA = /^\\*\\*(?:指派|Assign(?:ed)?)\\*\\*\\s*[：:]\\s*(.*)$/.exec(t)
  if (mA) { const v = mA[1].trim(); cur.assign = v === '-' ? '' : v; continue }
  const mS = /^\\*\\*(?:状态|Status)\\*\\*\\s*[：:]\\s*(\\S+)/.exec(t)
  if (mS) { const v = mS[1].toLowerCase(); cur.status = STATUSES.indexOf(v) >= 0 ? v : ''; continue }
  if (/^\\*\\*(?:模型|Model|回复给|Reply to)\\*\\*/.test(t)) continue
  cur.body.push(line)
}
if (cur) msgs.push(cur)

const excerpt = (s) => s.replace(/\\s+/g, ' ').trim().slice(0, 160)
const pending = msgs.filter((m) => m.status === 'open' || m.status === 'claimed')
const recent = msgs.slice(-recentN)

if (asJson) {
  console.log(JSON.stringify({
    file,
    total: msgs.length,
    pendingCount: pending.length,
    pending: pending.map((m) => ({ n: m.n, sig: m.sig, assign: m.assign, status: m.status, time: m.time, excerpt: excerpt(m.body.join(' ')) })),
    recent: recent.map((m) => ({ n: m.n, sig: m.sig, status: m.status, time: m.time, excerpt: excerpt(m.body.join(' ')) })),
  }, null, 2))
  process.exit(0)
}

console.log('# 对话摘要 (' + path.basename(file) + ')')
console.log('共 ' + msgs.length + ' 条，未完成 ' + pending.length + ' 条')
console.log('')
console.log('## 未完成')
if (pending.length) {
  for (const m of pending) {
    console.log('- #' + m.n + ' [' + m.status + '] ' + m.sig + (m.assign ? ' -> ' + m.assign : '') + '：' + excerpt(m.body.join(' ')))
  }
} else {
  console.log('（没有）')
}
console.log('')
console.log('## 最近 ' + recent.length + ' 条')
for (const m of recent) {
  console.log('- #' + m.n + ' ' + m.sig + (m.status ? ' [' + m.status + ']' : '') + ' · ' + m.time + '：' + excerpt(m.body.join(' ')))
}
`
}

/** 首次运行补齐目录与文件；已存在的 thread.md / README.md 绝不覆盖，post.mjs 按版本号刷新 */function ensureMailbox(dir) {
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
  writeIfMissing('brief.mjs', starterBriefScript)

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

          // 待办：只有显式标了 open/claimed 的才算（v0.3.x 的老消息没有 status，不参与）
          const pending = messages.filter((m) => m.status === 'open' || m.status === 'claimed')
          const assignedTo = {}
          for (const m of pending) {
            const who = m.assign || '(未指派)'
            assignedTo[who] = (assignedTo[who] || 0) + 1
          }

          // 需回执超时（借 sbnsec/parallel-claude-agents 的 ack-required + 5 分钟升级）
          // 标了 **需回执**：yes 且仍是 open、发出超过 5 分钟 → 面板标红提醒
          const ACK_TIMEOUT_MS = 5 * 60 * 1000
          const nowMs = Date.now()
          const ackOverdue = pending.filter((m) => {
            if (!m.ack) return false
            const t = Date.parse(String(m.time || '').replace(' ', 'T'))
            return !isNaN(t) && (nowMs - t) > ACK_TIMEOUT_MS
          })

          // 按阶段分组（借 devteam 的 7 阶段）
          const byPhase = {}
          for (const m of messages) {
            if (!m.phase) continue
            byPhase[m.phase] = (byPhase[m.phase] || 0) + 1
          }

          // 有界 brief（借鉴 ai-memory 的 bounded brief）：
          // 新代理加入时只喂「未完成 + 最近 N 条」，不把整个 thread 塞进上下文
          const excerpt = (m) => String(m.text || '').replace(/\s+/g, ' ').slice(0, 120)
          const brief = {
            pendingCount: pending.length,
            pending: pending.slice(-20).map((m) => ({
              n: m.n, sig: m.sig, assign: m.assign || '', status: m.status, time: m.time, excerpt: excerpt(m),
            })),
            recent: messages.slice(-8).map((m) => ({
              n: m.n, sig: m.sig, status: m.status || '', time: m.time, excerpt: excerpt(m),
            })),
            signatures: sigs,
            assignedTo,
          }

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
            pendingCount: pending.length,
            assignedTo,
            ackOverdue: ackOverdue.map((m) => m.n),
            ackOverdueCount: ackOverdue.length,
            byPhase,
            brief,
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
