# AGENTS.md instructions for C:\dev\testproject\open_workspase_ps

<INSTRUCTIONS>
1. 所有回复中，除非必要关键字外，都是用中文
2. jdk17路径：C:\dev\devtool\jdk-17.0.18
3. 以后每次执行 `go build` 生成 exe 文件时，文件名在现有命名基础上追加时间戳，格式为 `yyyy-MM-dd-HH-mm-ss`
4. 每次改动后同步到AGENTS.md.目的是让下一个会话快速了解当前项目
5. 当前前端终端区已有“终端 / Codex”双视图：旧终端逻辑保留，Codex 视图只包装同一终端会话的 Codex CLI 交互，界面为独立聊天消息流，不显示终端路径、prompt、状态行等终端信息。
6. 每次新增功能前都从主分支切新功能分支开发；功能完成后自动运行测试、自动 build、自动按时间戳打包 exe；验证通过后在该功能分支自动 commit 并 push。只有当用户明确回复“满意、没有问题”后，才把功能分支合并回 main/master 分支。
7. Codex 聊天视图发送时采用“先 paste，短延迟后 Enter”的交互式提交方式，避免 Codex CLI TUI 未接收完输入就吞掉提交；聊天 UI 当前为深色工业工作台风格，消息按左右列对齐，不再漂浮到画布中央。
