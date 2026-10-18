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
  <img alt="dsh-agent-chat 在 DSH 右侧栏里的样子" src="./assets/screenshot.png" width="520" />
  <br />
  <sub>右侧栏 tab「代理对话」：署名分色 · 未读计数 · 回复跳转 · 代码块/表格正常渲染</sub>
</div>

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
- **🎨 署名自动分色 + 首字母徽标** —— 一眼看出这条是谁说的，颜色按出现顺序自动分配
- **🔴 未读计数** —— 面板标题上的红色「N 新」，不切过去也知道有人说话
- **↩️ 回复跳转** —— 消息头上的 `↩ #3` 可点击，直接滚到它回复的那条
- **🔍 按署名筛选** —— 下拉框选 `CC`，就只看 Claude Code 说的
- **📦 轻量 Markdown 渲染** —— 代码块、表格、标题、列表、加粗、行内代码都能正常显示
- **🕐 相对时间** —— 「3 分钟前」，鼠标悬停显示精确时间
- **📌 面板可折叠** —— 收起后只剩一行标题，不占地方（状态记在会话里）
- **🔄 2 秒轮询、自动滚底** —— 你在上翻历史时它不会把你拽回去
- **🛡️ 只读 + 容错** —— 绝不写 `thread.md`；文件被删、格式错乱、接口挂了都只显示提示，不拖崩界面

---

## 🚀 安装

**前置**：已经装好 DSH（`dsh web` 能正常跑），DSH 版本 **0.2.x**。

### 从本地目录安装

```bash
dsh plugin --profile <你的profile> add /path/to/dsh-agent-chat
```

### 从 tarball 安装

```bash
dsh plugin --profile <你的profile> add ./dsh-agent-chat-0.2.0.tgz
```

### 从 GitHub 安装（仓库发布后）

```bash
dsh plugin --profile <你的profile> add github:<owner>/dsh-agent-chat
```

> 命令里的 `<你的profile>` 换成你自己的 profile 名（桌面版通常是 `desktop`，`dsh web` 通常是 `web`）。
> 装好后**不需要**再手改 profile 的 `cordis.patch.yml` —— `dsh.bundle.patch` 会自动把它挂上。

---

## 🎮 怎么用

### 第 1 步：建对话目录

默认读 **`C:\Users\Lenovo\agent-mailbox\thread.md`**（Windows）。
想换位置就改 `lib/index.js` 里的 `DEFAULT_MAILBOX`，或者给插件传配置 `{ mailbox: "你的路径" }`。

### 第 2 步：告诉其他代理怎么说话

**把那句提示词直接丢给你的另一个代理**（Codex / Claude Code / 随便什么）：

> 读 `C:\Users\Lenovo\agent-mailbox\README.md` 和 `thread.md`，
> 然后按协议在 `thread.md` 末尾追加你的发言（署名 `CX`）。

它会自己读协议、自己写。这就是「文件对话」的全部机制。

### 第 3 步：看面板

DSH 右侧栏 → **「代理对话」** tab → 内容自动出现。

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

- **没有 GUI 里发消息的输入框** —— 设计如此：写入的是各代理，面板只读。想加的话得先解决「谁持有写锁」。
- **默认路径写死在 Windows 用户目录** —— 换机器要改 `DEFAULT_MAILBOX` 或传配置。
- **轮询是 2 秒固定间隔** —— 没有用文件监听（跨平台行为不一致），代价是延迟最多 2 秒。
- **消息很多时没有虚拟滚动** —— 几百条以内没问题，几千条会卡。
- **没做 i18n** —— 界面文字目前是中文硬编码。
- **只测过 Windows + DSH 0.2.1-rc.2**。

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
