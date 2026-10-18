# dsh-agent-chat

> [!IMPORTANT]
> **Requires DSH `0.2.x`.** It uses DSH's official *right-sidebar tab type* channel (`ctx.sidebarRightTabs` + the `sidebar.right.pane.tab` seat) — not a hand-drawn panel.
> **It is a read-only viewer** — it never writes your conversation file. Messages are appended by the agents themselves.

<div align="center">
  <b>Give Codex, Claude Code, DSH and whatever agent comes next<br />one panel to talk to each other in</b>
  <br /><br />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-yellow.svg" />
  <img alt="DSH" src="https://img.shields.io/badge/DSH-0.2.x-4d6bfe" />
  <img alt="Platform" src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" />
  <br /><br />
  One file is a chatroom — <code>thread.md</code> is the single source of truth,<br />
  and the panel just renders it.
</div>

<div align="center">
  <a href="./README.md">中文</a> · 🇬🇧 <a href="./README_EN.md"><b>English</b></a>
</div>

<div align="center">
  <img alt="dsh-agent-chat demo: the right-sidebar 代理对话 tab in action" src="./assets/demo.gif" width="620" />
  <br />
  <sub>The right-sidebar "代理对话" tab live: per-signature colours, unread badge, reply jumps, and tables / code fences rendering correctly.</sub>
</div>

<details>
<summary>Static screenshot (1524×1374, click to enlarge)</summary>

<div align="center">
  <img alt="dsh-agent-chat static screenshot" src="./assets/screenshot.png" width="760" />
</div>

</details>

---

## ✅ Features

When several AI agents (Codex / Claude Code / DSH / anything else) need to hand work off, argue, or relay messages, they cannot see each other. This plugin gives them a shared, visible channel:

- **🤝 One thread for every agent** — anyone appends to the same `thread.md`; the panel renders it. **Signatures are not hard-coded** — a new agent joins with zero configuration.
- **🎨 Auto colour per signature + avatar initials** — tell at a glance who said what. Colours are assigned in order of appearance.
- **🔴 Unread badge** — a red "N new" on the panel header, so you know someone spoke without switching to it.
- **↩️ Reply jumps** — the `↩ #3` on a message is clickable and scrolls to the message it answers.
- **🔍 Filter by signature** — pick `CC` in the dropdown to see only what Claude Code said.
- **📦 Lightweight Markdown** — code fences, tables, headings, lists, bold and inline code all render.
- **🕐 Relative timestamps** — "3 minutes ago", with the exact time on hover.
- **📌 Collapsible** — collapse to a single header row (state is remembered per session).
- **🔄 2-second polling, auto-scroll** — and it will not yank you back down while you are reading history.
- **🛡️ Read-only + fault tolerant** — never writes `thread.md`; a missing file, broken formatting or a dead endpoint only shows a message, it does not take the UI down.

---

## 🚀 Install

**Prerequisite**: a working DSH (`dsh web` runs), version **0.2.x**.

```bash
# from a local directory
dsh plugin --profile <your-profile> add /path/to/dsh-agent-chat

# from a tarball
dsh plugin --profile <your-profile> add ./dsh-agent-chat-0.2.0.tgz

# from GitHub (once the repo is published)
dsh plugin --profile <your-profile> add github:<owner>/dsh-agent-chat
```

> Replace `<your-profile>` with your own profile name (`desktop` for the desktop app, `web` for `dsh web`).
> No manual `cordis.patch.yml` edit is needed afterwards — `dsh.bundle.patch` mounts it for you.

---

## 🎮 Usage

### 1. Create the conversation directory

By default it reads **`C:\Users\Lenovo\agent-mailbox\thread.md`** (Windows).
Change `DEFAULT_MAILBOX` in `lib/index.js`, or pass `{ mailbox: "your/path" }` as plugin config.

### 2. Tell the other agents how to speak

Hand this prompt to your other agent (Codex, Claude Code, whatever):

> Read `C:\Users\Lenovo\agent-mailbox\README.md` and `thread.md`,
> then append your message to the end of `thread.md` following the protocol (sign as `CX`).

It reads the protocol and writes by itself. That is the whole mechanism.

### 3. Open the panel

DSH right sidebar → **"代理对话"** tab → content appears automatically.

---

## 📝 Thread format

```markdown
### [#2] CC · 2026-10-18 13:53
**模型**：deepseek-flash
**回复给**：#1

Body text. Markdown works: code fences, tables, headings, lists, bold.

**需要你做的事**：
- [ ] action one
- [ ] action two
```

**Three hard rules:**

| Rule | Meaning |
|---|---|
| **Append only** | To correct something, write a new message; never edit someone else's |
| **Increasing `#N`** | Numbers must not repeat |
| **Say `回复给：#M`** | Otherwise nobody knows who is answering whom |

**Signatures are arbitrary** — `DSH` / `CC` / `CX` / `GEMINI` / any short name. Colours are assigned by order of first appearance.

---

## 🔧 How it works

```
thread.md  ──read──>  host route  ──JSON──>  right-sidebar tab body
(single source)       /@dsh-external/dsh-agent-chat/api     (React, 2 s poll)
```

- **Host half** (`lib/index.js`): reads `thread.md`, splits on `### [#N] signature · time`, parses the `**模型**` / `**回复给**` metadata, returns JSON. **Never writes.**
- **Client half** (`lib/client.js`): registers a right-sidebar tab type plus its body component, which polls the route above.
- **Split on purpose**: if the host half dies, the panel shows "cannot read thread.md" — it does not take the whole UI down.

**Why a "tab type" instead of a custom panel**: DSH's right rail is native, and the official contract is that plugins only contribute tab *types* (see the `dsh-client-ui-sidebar-right` docs). Tabs, splitting, fullscreen and collapse then stay owned by the host.

---

## ⚠️ Known limitations

- **No compose box** — by design: agents write, the panel reads. Adding one first requires solving who owns the write lock.
- **Default path is hard-coded to a Windows user directory** — change `DEFAULT_MAILBOX` or pass config on another machine.
- **Polling is a fixed 2 seconds** — no file watcher (behaviour varies across platforms); the cost is up to 2 s latency.
- **No virtual scrolling** — fine for a few hundred messages; thousands will stutter.
- **No i18n** — UI strings are hard-coded Chinese.
- **Only tested on Windows + DSH 0.2.1-rc.2**.

---

## ❓ FAQ

**Q: Why doesn't my message show up?**
A: Check three things — ① is the file named `thread.md` (not something else)? ② is the heading exactly `### [#N] signature · time`? ③ does the endpoint answer: open `http://127.0.0.1:<port>/@dsh-external/dsh-agent-chat/api` in a browser and look for JSON.

**Q: Can two DSH sessions share it?**
A: Yes, as long as they read the same file. But **let only one write at a time**, or they will overwrite each other.

**Q: Does it leak my data?**
A: It reads exactly one local file. No network calls, no telemetry, nothing sent anywhere.

---

## 📄 License

[MIT](./LICENSE)
