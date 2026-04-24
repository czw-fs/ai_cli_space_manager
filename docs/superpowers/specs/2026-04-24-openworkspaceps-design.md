# OpenWorkspacePS 设计规格

日期：2026-04-24

## 目标

构建一个可在 Windows 11 上一键运行的 Wails 桌面工具，用于管理多个工作目录，并通过固定或自定义打开方式快速打开目录。

工具应生成可执行文件，配置文件与 exe 位于同级目录。程序启动不依赖配置文件；配置文件只用于持久化用户修改。

## 技术方案

采用 Wails + Go + React/TypeScript。

Go 后端负责：

- 定位 exe 所在目录。
- 读取、创建、保存 exe 同级 `config.json`。
- 解析配置中的相对路径。
- 打开 Windows 文件夹。
- 以管理员模式启动 PowerShell 7。
- 执行自定义命令模板。
- 向前端返回明确的错误信息。

React/TypeScript 前端负责：

- 主窗口布局。
- 目录列表、分组视图、平铺视图。
- 搜索和筛选。
- 新增、编辑、删除目录。
- 新增、编辑、删除分组。
- 新增、编辑、删除自定义打开方式。
- 弹窗表单、确认框和错误提示。
- 不同窗口大小下的响应式布局。

## 主界面

主界面采用侧边栏 + 表格列表布局。

左侧为分组栏：

- 显示“全部目录”和用户分组。
- 每个分组显示目录数量。
- 支持新增、编辑、删除分组。
- 支持隐藏和重新展开。

右侧为工作区：

- 顶部工具栏包含搜索框、当前分组筛选、打开方式管理、新增分组、新增目录。
- 视图切换支持“分组”和“平铺”两种模式。
- 主列表显示名称、分组、路径、打开方式、更多操作。
- 每行目录提供固定打开按钮和更多工具入口。

## 响应式布局

窗口大小变化时，界面必须自动调整，不能出现控件重叠或文字挤出。

大窗口：

- 展示完整侧边栏、路径列和常用打开按钮。

中等窗口：

- 长路径使用省略号。
- 打开按钮保持稳定宽度。
- 次要内容收缩但不覆盖相邻元素。

小窗口：

- 侧边栏可收起。
- 列表区域允许横向滚动。
- 次要打开方式折叠到“更多工具”。
- 顶部工具栏允许换行或分组排列。

## 配置文件

配置文件名为 `config.json`，位于 exe 同级目录。

程序启动规则：

- 如果 `config.json` 不存在，程序使用内置默认配置启动。
- 没有配置文件时，用户仍可正常使用工具。
- 用户新增、编辑、删除目录、分组或打开方式时，自动创建并保存 `config.json`。
- 如果 `config.json` 存在但格式错误，前端提示错误，用户可选择继续使用默认配置或重置配置文件。

路径规则：

- 目录路径支持绝对路径和相对路径。
- 相对路径以 exe 所在目录作为基准解析。
- 保存时保留用户输入的路径文本，不强制转成绝对路径。

建议配置结构：

```json
{
  "groups": [
    {
      "id": "work",
      "name": "工作项目"
    }
  ],
  "directories": [
    {
      "id": "open-workspace-ps",
      "name": "open_workspase_ps",
      "path": ".\\open_workspase_ps",
      "groupId": "work"
    }
  ],
  "customOpeners": [
    {
      "id": "idea",
      "name": "IDEA",
      "commandTemplate": "\"C:\\Program Files\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe\" \"{path}\""
    }
  ]
}
```

## 打开方式

内置打开方式：

1. 管理员 PowerShell 7
2. Windows 文件夹
3. 自定义工具

管理员 PowerShell 7 使用固定路径：

```text
C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.1.0_x64__8wekyb3d8bbwe\pwsh.exe
```

启动要求：

- 必须以管理员模式启动。
- 工作目录必须设置为用户选中的目录。
- 如果固定路径不存在，提示 PowerShell 7 路径不可用，不影响其他打开方式。

Windows 文件夹：

- 使用系统资源管理器打开选中的目录。

自定义工具：

- 使用命令模板。
- `{path}` 替换为解析后的目录绝对路径。
- 示例：

```text
"C:\Program Files\JetBrains\IntelliJ IDEA\bin\idea64.exe" "{path}"
```

## 错误处理

目录不存在：

- 阻止打开操作。
- 显示目录不存在提示。
- 提供编辑目录路径入口。

配置读取失败：

- 显示配置错误。
- 允许继续使用默认配置。
- 允许重置并生成新的配置文件。

自定义命令执行失败：

- 显示打开方式名称、命令模板和失败原因。
- 不影响其他目录和其他打开方式。

PowerShell 7 启动失败：

- 显示固定路径和失败原因。
- 提醒该操作需要管理员权限。

## 前后端接口

Go 后端向前端暴露以下能力：

- `GetAppState()`：返回目录、分组、打开方式和配置状态。
- `SaveAppState(state)`：保存用户修改。
- `OpenDirectory(directoryId)`：用 Windows 文件夹打开目录。
- `OpenPowerShellAdmin(directoryId)`：用管理员 PowerShell 7 打开目录。
- `OpenWithCustomTool(directoryId, openerId)`：用自定义打开方式打开目录。
- `ValidatePath(path)`：验证目录路径是否存在。
- `ResolvePath(path)`：返回基于 exe 目录解析后的绝对路径。

## 数据模型

目录：

- `id`
- `name`
- `path`
- `groupId`

分组：

- `id`
- `name`

自定义打开方式：

- `id`
- `name`
- `commandTemplate`

配置状态：

- `configExists`
- `configPath`
- `configError`
- `usingDefaults`

## 验证要求

实现完成后至少验证：

- 无 `config.json` 时程序可启动。
- 新增目录后自动创建 `config.json`。
- 相对路径按 exe 同级目录解析。
- Windows 文件夹打开目录成功。
- 管理员 PowerShell 7 使用固定路径启动。
- 自定义 IDEA 命令模板可执行。
- 损坏的 `config.json` 不会导致程序崩溃。
- 主窗口在大、中、小尺寸下不出现重叠。
- 侧边栏可隐藏和展开。
- 分组视图和平铺视图可切换。

## 非目标

本版本不实现云同步、多用户配置、插件系统、命令执行历史、目录图标自动识别。

## 实现验证

- `go test ./...`：通过。
- `npm run build --prefix frontend`：通过。
- `C:\dev\com\goProject\bin\wails.exe build`：通过，生成 `build/bin/OpenWorkspacePS.exe`。
- 无 `config.json` 启动逻辑：后端测试覆盖缺失配置时使用默认状态。
- 首次保存自动创建 `config.json`：后端测试覆盖。
- 相对路径按 exe 同级目录解析：后端测试覆盖。
- 损坏的 `config.json` 不会导致程序崩溃：后端测试覆盖。
- 响应式布局：前端构建通过，样式包含侧栏收起、小窗口横向滚动和按钮稳定宽度规则。
