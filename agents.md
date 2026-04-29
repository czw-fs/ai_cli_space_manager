# AGENTS.md instructions for C:\dev\testproject\open_workspase_ps

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
