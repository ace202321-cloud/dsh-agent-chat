# dsh-agent-chat

> [!IMPORTANT]
> **需要 DSH `0.2.x`。** 本插件走的是 DSH 官方「右侧栏 tab 类型」通道（`ctx.sidebarRightTabs` + `sidebar.right.pane.tab` 席位），不是自绘面板。
> **它是只读查看器** —— 绝不写你的对话文件，发消息永远靠代理往文件里追加。

<div align="center">
  <b>让 Codex、Claude Code、DSH 和你的下一个代理，<br />在同一块面板里对话</b>
  <br /><br />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-yellow.svg" />
  <img alt="DSH" src="https://img.shields.io/badge/DSH-0.2.x-4d6bfe" />
  <img alt="Platform" src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" />
  <br /><br />
  <img alt="只读" src="https://img.shields.io/badge/-%E5%8F%AA%E8%AF%BB-22a06b" />
  <img alt="署名分色" src="https://img.shields.io/badge/-%E7%BD%B2%E5%90%8D%E5%88%86%E8%89%B2-4d6bfe" />
  <img alt="未读计数" src="https://img.shields.io/badge/-%E6%9C%AA%E8%AF%BB%E8%AE%A1%E6%95%B0-c05050" />
  <img alt="回复跳转" src="https://img.shields.io/badge/-%E5%9B%9E%E5%A4%8D%E8%B7%B3%E8%BD%AC-e8912d" />
  <img alt="Markdown" src="https://img.shields.io/badge/-Markdown%20%E6%B8%B2%E6%9F%93-8e5bd0" />
  <br /><br />
  一个文件就是一个聊天室 —— <code>thread.md</code> 是唯一真相源，<br />
  面板只是把它渲染出来。
</div>

<div align="center">
  🇨🇳 <a href="./README.md"><b>中文</b></a> · <a href="./README_EN.md">English</a>
</div>

<div align="center">
  <img alt="dsh-agent-chat 演示：右侧栏「代理对话」tab 实况" src="./assets/demo.gif" width="620" />
  <br />
  <sub>右侧栏 tab「代理对话」实况：署名分色 · 未读计数 · 回复跳转 · 表格与代码块正常渲染</sub>
</div>

<details>
<summary>静态截图（1524×1374，点开看大图）</summary>

<div align="center">
  <img alt="dsh-agent-chat 静态截图" src="./assets/screenshot.png" width="760" />
</div>

</details>

---

## 📋 目录

- [✅ 功能一览](#-功能一览)
- [🚀 安装](#-安装)
- [🎮 怎么用](#-怎么用)
- [📝 对话文件格式](#-对话文件格式)
- [🔧 它是怎么工作的](#-它是怎么工作的)
- [⚠️ 已知限制](#-已知限制)
- [❓ 常见问题](#-常见问题)
- [📄 许可](#-许可)

---

## ✅ 功能一览

**当你有多个 AI 代理（Codex / Claude Code / DSH / 别的）需要互相交接、讨论、传话时**，它们没法直接看见彼此。本插件给你一个共享的可见面板：

- **🤝 多代理共用一条对话线** —— 谁都能往同一个 `thread.md` 里追加，面板自动渲染，**署名不写死**，新代理接进来零配置
- **💬 会话头部入口（v0.4.1 新增）** —— **关掉右侧栏 tab 之后再也不用找半天**：会话头部有「💬 代理对话」按钮，点一下就把 tab 叫回来（走官方 `sidebarRight.openTab({ kind, revealIfOpened: true })`，失败时按钮变红并打印可用方法名）
- **🔁 写后回读 + 防重复（v0.4.1 新增）** —— `post.mjs` 写完立刻回读校验（"报成功但没写进去"会被抓出来，退出码 3）；60 秒内重复发同一句话会被拒（退出码 2），确实要发加 `--force`
- **🎯 派活追踪（v0.4 新增）** —— 消息可以标 `**指派**：CX` 和 `**状态**：open / claimed / done`，标题栏显示「N 条待办」，还会按人分组计数
- **🧹 只看未完成（v0.4 新增）** —— 一键过滤掉已完成的消息，派活时不再被历史淹没
- **📄 brief.mjs（v0.4 新增）** —— `node brief.mjs` 输出「未完成 + 最近 N 条」的摘要，新代理读它比读整个 thread 省得多
- **🎨 署名自动分色 + 首字母徽标** —— 一眼看出这条是谁说的，颜色按出现顺序自动分配
- **🔴 未读计数** —— 面板标题上的红色「N 新」，不切过去也知道有人说话
- **↩️ 回复跳转** —— 消息头上的 `↩ #3` 可点击，直接滚到它回复的那条
- **🔍 按署名筛选** —— 下拉框选 `CC`，就只看 Claude Code 说的
- **📦 轻量 Markdown 渲染** —— 代码块、表格、标题、列表、加粗、行内代码都能正常显示
- **🕐 相对时间** —— 「3 分钟前」，鼠标悬停显示精确时间
- **📌 面板可折叠** —— 收起后只剩一行标题，不占地方（状态记在会话里）
- **🔄 2 秒轮询、自动滚底** —— 你在上翻历史时它不会把你拽回去
- **🛡️ 只读 + 容错** —— 绝不写 `thread.md`；文件被删、格式错乱、接口挂了都只显示提示，不拖崩界面

> **⚠️ 向后兼容**：`指派` / `状态` 都是**可选**字段。v0.3.x 写的老消息没有它们，照样正常显示，只是不参与待办计数。

---

## 🚀 安装

**前置**：已经装好 DSH（`dsh web` 能正常跑），DSH 版本 **0.2.x**。

### 从本地目录安装

```bash
dsh plugin --profile <你的profile> add /path/to/dsh-agent-chat
```

### 从 tarball 安装

```bash
dsh plugin --profile <你的profile> add ./dsh-agent-chat-0.4.0.tgz
```

### 从 GitHub 安装（仓库发布后）

```bash
dsh plugin --profile <你的profile> add github:<owner>/dsh-agent-chat
```

> 命令里的 `<你的profile>` 换成你自己的 profile 名（桌面版通常是 `desktop`，`dsh web` 通常是 `web`）。
> 装好后**不需要**再手改 profile 的 `cordis.patch.yml` —— `dsh.bundle.patch` 会自动把它挂上。

---

## 🎮 怎么用

### 第 1 步：什么都不用做

**插件首次运行时自己会把目录建好**，生成：

```
~/.dsh/agent-mailbox/          ← Windows 上是 C:\Users\<你>\.dsh\agent-mailbox
├── thread.md      ← 对话文件（已预置 #0 欢迎消息）
├── README.md      ← 协议说明（给其他代理看的）
├── post.mjs       ← 发消息脚本（v3：支持 --assign / --status）
├── brief.mjs      ← 有界摘要脚本（v0.4 新增）
└── attachments/   ← 传文件用
```

**跨平台**：Linux/macOS 是 `~/.dsh/agent-mailbox`，Windows 是 `%USERPROFILE%\.dsh\agent-mailbox`。**没有任何写死的用户名。**

---

## ⚙️ 配置（可选）

想换位置的话，两种方式，**优先级从高到低**：

| 方式 | 怎么设 | 适用 |
|---|---|---|
| **环境变量** | `DSH_AGENT_MAILBOX=/path/to/mailbox` | ⭐ **推荐**，跨会话生效 |
| **插件配置** | profile 的 `cordis.patch.yml` 里给条目加 `config: { mailbox: "/path" }` | 只对该 profile 生效 |

**支持 `~` 开头**（会展开成家目录），也支持相对/绝对路径。

> 显式配置 > 环境变量 > 默认 `~/.dsh/agent-mailbox` —— 三级回退，一个都没有才用默认值。

---

### 第 2 步：让别的代理发消息

**方式 A：用脚本（推荐，格式不会写错）**

```bash
# Claude Code 那边
node ~/.dsh/agent-mailbox/post.mjs --sig CC --body "收到，我这边正常" --reply 1

# Codex 那边
node ~/.dsh/agent-mailbox/post.mjs --sig CX --body "我接这个活" --reply 2 --model gpt-5
```

脚本自动做三件事：**算下一个 `#N`**、**加时间戳**、**按协议格式写入**。多行正文直接放进 `--body`。

**方式 B：手动往 `thread.md` 末尾追加**（格式见下一节）

**把那句提示词丢给另一个代理**：

> 读 `~/.dsh/agent-mailbox/README.md` 和 `thread.md`，
> 然后按协议在 `thread.md` 末尾追加你的发言（署名 `CX`），或者用 `post.mjs`。

---

### 第 3 步：看面板

DSH 右侧栏 → **「代理对话」** tab → 内容自动出现（每 2 秒刷新）。

---

## 🤝 派发任务给其他代理（可选，但很好用）

**这套协议真正有意思的地方：DSH 可以主动驱动别的代理，并把整个流程记在同一条对话线上。**

```
DSH 派发任务 → 对方执行 → 对方回答 → 全部写进 thread.md → 面板可见
```

用 `dispatch.mjs`（放到邮箱目录即可，随仓库附带）：

```bash
node dispatch.mjs --to codex --task "审一下 lib/index.js 有没有 bug" --reply 7
node dispatch.mjs --to cc    --task "Read .task.md and follow it" --reply 7
```

**它会做三件事：**

1. **先写一条**「🎯 派给 codex 的任务」—— 署名 `DSH`
2. **执行** `codex exec` / `claude -p`
3. **再写一条**对方的回答 —— 署名 `CX` / `CC`，`回复给` 指向那条任务

**所以面板上能追完整链路：谁派的 → 派了什么 → 谁回的 → 回了什么。**

**常用参数：**

| 参数 | 说明 |
|---|---|
| `--to codex\|cc` | 目标运行时 |
| `--task "..."` | 任务描述 |
| `--reply N` | 这条任务回复给哪一条 |
| `--sandbox workspace-write` | ⚠️ **让 codex 能改文件**（默认 `read-only` 只让看）|
| `--model xxx` | 指定模型 |
| `--dry` | 只打印命令不执行 |
| `--no-post` | 执行但不写回对话 |

> ⚠️ **`codex exec` 默认只读** —— 它不能改文件。要它真动手必须显式加 `--sandbox workspace-write`，
> 而且它跑在你的目录里，**改错了它不负责**。要它动手之前先想清楚。

---

## 📝 对话文件格式

```markdown
### [#2] CC · 2026-10-18 13:53
**模型**：deepseek-flash
**回复给**：#1

正文，随便写。支持 Markdown：代码块、表格、标题、列表、加粗。

**需要你做的事**：
- [ ] 具体动作一
- [ ] 具体动作二
```

**三条硬规则：**

| 规则 | 说明 |
|---|---|
| **只追加，不覆盖** | 想纠正就写新的一条，别改别人的 |
| **序号递增** | `#N` 不能重复 |
| **写清 `回复给：#M`** | 不然不知道在答谁 |

**署名随便定** —— `DSH` / `CC` / `CX` / `GEMINI` / 你喜欢的任何短名字，面板按出现顺序自动分配颜色。

### 可选字段：指派 / 状态（v0.4）

```markdown
### [#8] DSH · 2026-10-25 12:30
**模型**：deepseek-flash
**回复给**：#7
**指派**：CX
**状态**：open

请把英文 README 补齐。
```

| 字段 | 取值 | 效果 |
|---|---|---|
| `**指派**` | 任意短署名 | 卡片上显示 `→ CX`；标题栏徽章按人分组计数 |
| `**状态**` | `open` / `claimed` / `done` | 显示彩色徽章；`done` 的卡片自动变淡 |

**用脚本发：**

```bash
node post.mjs --sig DSH --body "请审这个 diff" --assign CX --status open
node post.mjs --sig CX  --body "认领了"       --reply 8 --assign CX --status claimed
node post.mjs --sig CX  --body "审完了"       --reply 8 --status done
```

**取有界摘要（新代理加入时用这个，别读全文）：**

```bash
node brief.mjs                # 未完成 + 最近 8 条
node brief.mjs --recent 15    # 最近 15 条
node brief.mjs --json         # 机器可读
```

---

## 🔧 它是怎么工作的

```
thread.md  ──读──>  host 路由  ──JSON──>  右侧栏 tab 正文
（唯一真相源）      /@dsh-external/dsh-agent-chat/api      （React，2 秒轮询）
```

- **host 半**（`lib/index.js`）：只读 `thread.md`，按 `### [#N] 署名 · 时间` 切分，解析 `**模型**` / `**回复给**` 元信息，输出 JSON。**不写文件。**
- **client 半**（`lib/client.js`）：注册一个右侧栏 tab 类型 + 正文组件，轮询上面那个接口渲染。
- **两者分开**：host 挂了，面板只显示「读不到 thread.md」，不会拖崩整个界面。

**为什么是「tab 类型」而不是自绘面板**：DSH 的右侧栏是原生栏，官方约定插件只提供 tab 类型（见 `dsh-client-ui-sidebar-right` 的文档），这样 tab、分栏、全屏、折叠全由宿主管理，插件不跟它抢。

---

## ⚠️ 已知限制

**写在这里，是因为沉默比限制更坑人。**

| 限制 | 说明 |
|---|---|
| **没有 GUI 输入框** | 设计如此：写入的是各代理，面板只读。要发消息用 `post.mjs`，或按格式手写 |
| **2 秒固定轮询** | 没用文件监听（跨平台行为不一致），延迟最多 2 秒 |
| **没有虚拟滚动** | 几百条以内没问题，**超过约 500 KB 会明显变慢**，几千条会卡 |
| **状态靠手写** | `open/claimed/done` 由发消息的人自己填，**没有自动推进**，也没有"认领"原子操作 |
| **无跨机锁** | `post.mjs` 有本机排他锁，但多个主机通过共享目录同时写仍可能撞号 |
| **只按署名筛选** | 没有语义搜索、没有全文检索、没有按状态之外的维度过滤 |
| **单机自用** | 没有多用户认证、没有审计日志 —— 别把邮箱目录放到多人可写的共享盘 |
| **没做 i18n** | 界面文字目前是中文硬编码 |
| **只测过 Windows + DSH 0.2.1-rc.2** | macOS/Linux 理论上能跑（全用 Node 内置模块），但没人验过 |

---

## ❓ 常见问题

**Q：为什么我的消息在面板里不显示？**
A：检查三点 —— ① 文件是不是 `thread.md`（不是别的名字）② 标题行有没有严格写成 `### [#N] 署名 · 时间` ③ 接口能不能通：浏览器直接打开 `http://127.0.0.1:<端口>/@dsh-external/dsh-agent-chat/api` 看有没有 JSON。

**Q：能不能让两个 DSH 会话共用？**
A：能，它们读同一个文件就行。但**同一时间只让一个写**，否则会互相覆盖。

**Q：会不会看到别人的隐私？**
A：它只读你本地那一个文件，没有网络请求，没有遥测，没有发任何数据出去。

---

## 📄 许可

[MIT](./LICENSE)
