# AGENTS.md instructions

<INSTRUCTIONS>
1. 所有回复中，除非必要关键字外，都是用中文
2. jdk17路径：C:\dev\devtool\jdk-17.0.18
3. 以后每次执行 `go build` 生成 exe 文件时，文件名在现有命名基础上追加时间戳，格式为 `yyyy-MM-dd-HH-mm-ss`
4. 每次改动后同步到AGENTS.md.目的是让下一个会话快速了解当前项目
5. 当前前端终端区已有“终端 / Codex”双视图：旧终端逻辑保留，Codex 视图只包装同一终端会话的 Codex CLI 交互，界面为独立聊天消息流，不显示终端路径、prompt、状态行等终端信息。
6. 每次新增功能前都从主分支切新功能分支开发；功能完成后自动运行测试、自动 build、自动按时间戳打包 exe；验证通过后在该功能分支自动 commit 并 push。只有当用户明确回复“满意、没有问题”后，才把功能分支合并回 main/master 分支。
7. Codex 聊天视图发送时采用“先 paste，短延迟后 Enter”的交互式提交方式，避免 Codex CLI TUI 未接收完输入就吞掉提交；聊天 UI 当前为深色工业工作台风格，消息按左右列对齐，不再漂浮到画布中央。
8. Codex 聊天输出不要逐 chunk 直接追加到气泡；当前实现按会话维护原始终端输出缓冲，重新解析整段缓冲后替换 assistant 消息内容，用 `terminalOutputToCodexReplyText` 处理 carriage return、清行、光标移动和 Codex TUI 的 Working 状态/碎片，避免把终端重绘过程展示给用户。
9. Codex 视图采用终端屏幕文本投影方式，保留换行、缩进和 Codex 状态行，只隐藏交互输入框占位（如 `> Implement {feature}`）、当前用户输入回显、路径/prompt 等终端外壳；assistant 空内容不渲染，且不再显示自定义流式光标。
10. Codex 视图的实时映射必须以“当前用户本次输入”为边界：App 当前使用 `terminalOutputToCodexTurnLiveText` 和 `terminalOutputHasCodexTurnEndPrompt`，从最后一次 activePrompt 输入锚点之后开始投影，并在下一次输入框/占位 prompt 前截断；这样保留本轮思考、搜索、工具状态和最终回答，但不把历史回答或下一次输入框混入当前 assistant 气泡。
11. Codex 实时输出不能用最后一帧屏幕直接覆盖 assistant 内容；当前使用 `mergeCodexTurnLiveText` 合并新快照，忙碌状态行（如 `Working (0s)` 到 `Working (1s)`）原位更新，后续 Thinking/Searching/工具输出/最终回答继续追加。同时 `terminalOutputHasCodexTurnEndPrompt` 在最后可见内容仍是 busy status 时不能结束本轮。
12. Codex 新界面实时映射的数据源使用整个终端会话 raw buffer（`terminalRawBySession`），不要只用提交后的 active reply 增量；Codex TUI 的光标重绘依赖历史屏幕状态，单独增量会导致只能解析到重复 `Working`。合并逻辑还要避免“下一帧包含 busy 状态和回答正文时提前只更新状态并丢正文”。
13. Codex 新界面现在优先读取同一终端会话的 xterm 已渲染 buffer 作为权威屏幕快照，再用当前用户输入锚点切出本轮输出；Codex 视图下会保留隐藏的 xterm host 作为同步数据源，但界面不显示任何终端内容。xterm 快照有内容时直接替换当前 assistant 气泡，避免最终回答出现后仍残留旧 `Working` 状态。
14. Codex 聊天同步有真实浏览器 e2e 覆盖：`npm test` 会运行 `test/codexChat.e2e.mjs`，打开构建后的前端、mock Wails 终端会话、通过 Codex 输入框发送消息，并模拟 Codex CLI 先输出 `◦ Working` 再整屏重绘最终回答；测试要求聊天气泡实时更新为最终回答且不残留旧 `Working`。
15. Codex 聊天映射不能在找不到当前用户输入锚点时退回解析整屏终端内容；只能映射当前 activePrompt 之后的本轮输出，或同样能按 activePrompt 切片的 active raw buffer。`PS ...> codex`、`OpenAI Codex`、`model/directory/permissions`、`Tip:` 等 Codex/终端外壳必须始终过滤，避免启动 banner、终端 prompt、历史搜索状态污染当前气泡。长回复结束使用短延迟 finalize 等最后一帧，不允许用无锚点整屏 fallback 解决截断问题。
16. README 打包说明已改为通用 PowerShell 命令：优先使用 PATH 中的 `wails`，没有则执行 `go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.1`，再从 `GOBIN` 或 `GOPATH\bin` 定位 `wails.exe`，避免依赖本机固定绝对路径。
17. 终端输出期间不要再向 xterm 额外写入隐藏/显示光标 ANSI，也不要用 `terminal-output-active` 隐藏光标；这会在 Codex TUI 控制序列分块时打断清屏/光标移动，导致滚动或方向键后画面错位、光标消失。Codex 忙碌状态识别已覆盖 `Inspecting` 等状态词，避免运行中误判本轮结束；e2e 会模拟滚动和上下方向键后继续同步最终回答。
