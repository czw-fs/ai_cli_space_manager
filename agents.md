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
18. Codex 视图当前对 activePrompt 做锚点匹配时会同时兼容用户气泡保留的 `>`/`›` prompt 符号和终端屏幕中的缩进续行，避免真实 Codex 输入如 `› URL + 中文问题` 匹配失败导致 assistant 气泡不同步；Codex 交互提交延迟为 180ms，用来避开 Codex TUI Windows paste-burst 的 Enter 换行抑制窗口。Codex 有 streaming 回复时 Ctrl+C 会从聊天区/全局键盘兜底转发 `\x03` 到同一 PTY；xterm 忙碌光标只通过 `terminal-codex-busy` CSS 隐藏，终端真实输入或切换会清除该 class。
19. Codex 聊天输入固定为 `Enter` 发送、`Shift+Enter` 换行，不再跟随终端 composer 的“回车换行”设置；`buildCodexPrompt` 对只有附件的输入不再生成前导空行，避免 activePrompt 锚点失败。Codex 映射测试已新增 10+ 个场景，覆盖附件-only prompt、长多行/路径 prompt、正文里的 `> npm test`/Markdown 引用、ANSI 清行重绘、下一轮 prompt 截断、busy 状态不提前结束、最终回答替换 stale Working；浏览器 e2e 会用真实键盘 Enter 发送，并验证 Shift+Enter、Ctrl+C、滚动和方向键后的同步。
20. Codex 终端映射改为“上下文过滤、不按下一条 prompt 硬截断”：`> Find and fix...`、`> Implement...`、`gpt-x · path` 等 TUI 输入框/状态行只过滤自身，后续真实输出必须继续映射，避免停在 `Considering ... esc to interrupt`。忙碌/等待状态识别不再依赖固定词表，凡含 `esc to interrupt`、计时括号、尾部进度数字或省略号形态都按运行中处理；若 xterm 当前屏幕因重绘/滚动丢失 activePrompt，只允许退到本轮 active raw buffer 的 scoped 映射，不解析历史整屏。测试新增 `codexLiveMapping.generated.test.ts`，包含 50+ 动态状态和 prompt 后继续输出场景；e2e 复现截图里的 `Considering file output issues` 后继续输出最终回答。Codex streaming 期间 `terminal-codex-busy` 不再因滚动、焦点或方向键输入被清除，避免 xterm 光标闪烁。
21. Codex streaming 写入真实 xterm 时必须在 `terminal.write` flush 后调用 `scrollToBottom()`，否则用户滚动后 Codex TUI 的全屏重绘会落进 scrollback，表现为终端里重复出现多段 `Working + > Use /skills + gpt-x · path` 和大片空白。`test/codexChat.e2e.mjs` 已用 `https://github.com/carlini/printf-tac-toe` 多行 prompt 增加 50 帧真实 xterm 可见区域压力测试：每 5 帧先滚动终端，再模拟 Codex 状态/全屏重绘，断言可见区域始终 pinned 到最新 `terminal-stress-frame-50`，且同屏不会堆叠多个 Codex prompt。
22. Codex 视图已升级为统一“终端聊天”投影层：聊天模式可在 `PowerShell` / `Codex` 间切换，右侧统一显示用户输入，左侧显示系统输出。Codex 模式继续复用 activePrompt + xterm screen snapshot 映射；PowerShell 模式不要靠 prompt 正则切回合，而是由 `frontend/src/terminalChat.ts` 构造带 `OWPS_START:<turnId>` / `OWPS_END:<turnId>:<exitCode>` 的 OSC marker 命令，前端按 turnId 聚合输出、过滤 marker 和 shell prompt，并展示 completed/failed/interrupted 与退出码。直接在真实 xterm 手打的交互程序仍属于终端视图，不强行聊天化。
23. 终端聊天测试覆盖要求：`npm test` 会运行 `test/terminalChat.generated.test.ts`，当前生成 157 个 PowerShell marker/ANSI/进度条/跨 chunk/失败退出码/长输出/中文路径/噪声 prompt 场景，并在测试中强制校验不少于 100 个场景；`test/codexChat.e2e.mjs` 还会通过真实浏览器点击“内嵌终端 -> Codex -> PowerShell/Codex 模式”，验证 PowerShell 成功、失败、Ctrl+C 中断，Codex Enter/Shift+Enter、滚动、方向键、隐藏 xterm 光标和 `printf-tac-toe` 压力帧同步。
