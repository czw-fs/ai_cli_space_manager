# OpenWorkspacePS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Windows 11 可运行的 Wails 桌面 exe，用于管理目录分组，并通过管理员 PowerShell 7、文件夹、自定义工具打开目录。

**Architecture:** Go 后端负责配置持久化、路径解析和进程启动；React/TypeScript 前端负责状态编辑、响应式桌面布局和用户交互。配置文件位于 exe 同级目录；不存在配置文件时应用用默认状态启动，首次用户修改时创建 `config.json`。

**Tech Stack:** Go 1.22、Wails v2、React、TypeScript、Vite、CSS Grid/Flexbox、Go `testing`。

---

## File Structure

- Create: `go.mod`、`wails.json`、`main.go`、`app.go`：Wails 应用入口、窗口配置和前后端绑定。
- Create: `internal/config/config.go`：配置数据模型、默认状态、读取、保存、路径解析。
- Create: `internal/config/config_test.go`：配置读取、缺失配置、损坏配置、相对路径解析、保存行为测试。
- Create: `internal/opener/opener.go`：文件夹打开、管理员 PowerShell 7 打开、自定义命令模板执行。
- Create: `internal/opener/opener_test.go`：打开命令构造、目录校验、模板替换测试。
- Create: `frontend/package.json`、`frontend/src/main.tsx`、`frontend/src/App.tsx`：React 前端入口和主界面。
- Create: `frontend/src/types.ts`：前端共享类型。
- Create: `frontend/src/api.ts`：Wails 绑定适配层。
- Create: `frontend/src/styles.css`：完整响应式布局样式。
- Create: `frontend/src/App.test.tsx`：前端关键交互测试。
- Modify: `docs/superpowers/specs/2026-04-24-openworkspaceps-design.md`：实现完成后补充验证结果。

---

### Task 1: Bootstrap Wails Project

**Files:**
- Create: `go.mod`
- Create: `wails.json`
- Create: `main.go`
- Create: `app.go`
- Create: `frontend/package.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/styles.css`

- [ ] **Step 1: Initialize git repository**

Run:

```powershell
git init
```

Expected: repository initialized in `C:\dev\testproject\open_workspase_ps`.

- [ ] **Step 2: Install Wails CLI when missing**

Run:

```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

Expected: `wails.exe` is available from the Go bin directory after PATH refresh or direct invocation.

- [ ] **Step 3: Scaffold React/TypeScript Wails app in a temporary child directory**

Run:

```powershell
wails init -n OpenWorkspacePS -t react-ts
```

Expected: `OpenWorkspacePS` directory contains a Wails React/TypeScript project.

- [ ] **Step 4: Move scaffolded project files to repository root**

Run:

```powershell
Get-ChildItem -LiteralPath .\OpenWorkspacePS -Force | Move-Item -Destination . -Force
Remove-Item -LiteralPath .\OpenWorkspacePS -Recurse -Force
```

Expected: root contains `go.mod`, `wails.json`, `main.go`, `app.go`, and `frontend`.

- [ ] **Step 5: Set application metadata**

Modify `wails.json` so the app name is stable:

```json
{
  "$schema": "https://wails.io/schemas/config.v2.json",
  "name": "OpenWorkspacePS",
  "outputfilename": "OpenWorkspacePS",
  "frontend:install": "npm install",
  "frontend:build": "npm run build",
  "frontend:dev:watcher": "npm run dev",
  "frontend:dev:serverUrl": "auto",
  "author": {
    "name": "",
    "email": ""
  }
}
```

- [ ] **Step 6: Run initial build checks**

Run:

```powershell
go test ./...
```

Expected: PASS.

Run:

```powershell
npm install --prefix frontend
npm run build --prefix frontend
```

Expected: Vite build succeeds.

- [ ] **Step 7: Commit bootstrap**

Run:

```powershell
git add .
git commit -m "chore: bootstrap wails project"
```

Expected: commit created.

---

### Task 2: Implement Config Model and Persistence

**Files:**
- Create: `internal/config/config.go`
- Create: `internal/config/config_test.go`

- [ ] **Step 1: Write failing config tests**

Create `internal/config/config_test.go`:

```go
package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMissingConfigUsesDefaults(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	state, err := store.Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if state.Config.ConfigExists {
		t.Fatalf("ConfigExists = true, want false")
	}
	if !state.Config.UsingDefaults {
		t.Fatalf("UsingDefaults = false, want true")
	}
	if len(state.Groups) != 0 || len(state.Directories) != 0 {
		t.Fatalf("default state should start empty")
	}
	if len(state.CustomOpeners) != 1 {
		t.Fatalf("default custom openers = %d, want 1", len(state.CustomOpeners))
	}
	if state.CustomOpeners[0].Name != "IDEA" {
		t.Fatalf("default opener name = %q, want IDEA", state.CustomOpeners[0].Name)
	}
}

func TestSaveCreatesConfigNextToExeDir(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	state := DefaultState(dir)
	state.Groups = []Group{{ID: "work", Name: "工作项目"}}
	state.Directories = []Directory{{ID: "repo", Name: "repo", Path: ".\\repo", GroupID: "work"}}

	if err := store.Save(state); err != nil {
		t.Fatalf("Save returned error: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatalf("config.json not created: %v", err)
	}
	if len(content) == 0 {
		t.Fatalf("config.json is empty")
	}
}

func TestLoadInvalidConfigReturnsDefaultStateWithError(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte("{bad-json"), 0644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	store := NewStore(dir)
	state, err := store.Load()
	if err == nil {
		t.Fatalf("Load error = nil, want parse error")
	}
	if !state.Config.ConfigExists {
		t.Fatalf("ConfigExists = false, want true")
	}
	if !state.Config.UsingDefaults {
		t.Fatalf("UsingDefaults = false, want true")
	}
	if state.Config.ConfigError == "" {
		t.Fatalf("ConfigError is empty")
	}
}

func TestResolvePathUsesExeDirForRelativePath(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	got := store.ResolvePath(".\\projects\\api")
	want := filepath.Join(dir, "projects", "api")
	if got != want {
		t.Fatalf("ResolvePath = %q, want %q", got, want)
	}
}

func TestResolvePathKeepsAbsolutePath(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)
	absolute := filepath.Join(dir, "repo")

	got := store.ResolvePath(absolute)
	if got != absolute {
		t.Fatalf("ResolvePath = %q, want %q", got, absolute)
	}
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
go test ./internal/config -run Test -v
```

Expected: FAIL because `NewStore`, `DefaultState`, and types are not defined.

- [ ] **Step 3: Implement config package**

Create `internal/config/config.go`:

```go
package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const ConfigFileName = "config.json"

type Group struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Directory struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Path    string `json:"path"`
	GroupID string `json:"groupId"`
}

type CustomOpener struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	CommandTemplate string `json:"commandTemplate"`
}

type ConfigStatus struct {
	ConfigExists  bool   `json:"configExists"`
	ConfigPath    string `json:"configPath"`
	ConfigError   string `json:"configError"`
	UsingDefaults bool   `json:"usingDefaults"`
}

type AppState struct {
	Groups        []Group        `json:"groups"`
	Directories   []Directory    `json:"directories"`
	CustomOpeners []CustomOpener `json:"customOpeners"`
	Config        ConfigStatus   `json:"config"`
}

type Store struct {
	exeDir     string
	configPath string
}

func NewStore(exeDir string) *Store {
	return &Store{
		exeDir:     exeDir,
		configPath: filepath.Join(exeDir, ConfigFileName),
	}
}

func DefaultState(exeDir string) AppState {
	return AppState{
		Groups:      []Group{},
		Directories: []Directory{},
		CustomOpeners: []CustomOpener{
			{
				ID:              "idea",
				Name:            "IDEA",
				CommandTemplate: "\"C:\\Program Files\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe\" \"{path}\"",
			},
		},
		Config: ConfigStatus{
			ConfigExists:  false,
			ConfigPath:    filepath.Join(exeDir, ConfigFileName),
			ConfigError:   "",
			UsingDefaults: true,
		},
	}
}

func (s *Store) Load() (AppState, error) {
	state := DefaultState(s.exeDir)
	state.Config.ConfigPath = s.configPath

	data, err := os.ReadFile(s.configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return state, nil
		}
		state.Config.ConfigError = err.Error()
		return state, err
	}

	state.Config.ConfigExists = true
	if err := json.Unmarshal(data, &state); err != nil {
		state = DefaultState(s.exeDir)
		state.Config.ConfigExists = true
		state.Config.ConfigPath = s.configPath
		state.Config.ConfigError = err.Error()
		state.Config.UsingDefaults = true
		return state, err
	}

	if state.Groups == nil {
		state.Groups = []Group{}
	}
	if state.Directories == nil {
		state.Directories = []Directory{}
	}
	if state.CustomOpeners == nil {
		state.CustomOpeners = []CustomOpener{}
	}
	state.Config.ConfigExists = true
	state.Config.ConfigPath = s.configPath
	state.Config.ConfigError = ""
	state.Config.UsingDefaults = false
	return state, nil
}

func (s *Store) Save(state AppState) error {
	state.Config.ConfigExists = true
	state.Config.ConfigPath = s.configPath
	state.Config.ConfigError = ""
	state.Config.UsingDefaults = false

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.configPath, data, 0644)
}

func (s *Store) ResolvePath(input string) string {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return s.exeDir
	}
	if filepath.IsAbs(trimmed) {
		return filepath.Clean(trimmed)
	}
	return filepath.Clean(filepath.Join(s.exeDir, trimmed))
}

func (s *Store) ValidatePath(input string) bool {
	info, err := os.Stat(s.ResolvePath(input))
	return err == nil && info.IsDir()
}
```

- [ ] **Step 4: Run config tests**

Run:

```powershell
go test ./internal/config -run Test -v
```

Expected: PASS.

- [ ] **Step 5: Commit config package**

Run:

```powershell
git add internal/config
git commit -m "feat: add config persistence"
```

Expected: commit created.

---

### Task 3: Implement Directory Openers

**Files:**
- Create: `internal/opener/opener.go`
- Create: `internal/opener/opener_test.go`

- [ ] **Step 1: Write failing opener tests**

Create `internal/opener/opener_test.go`:

```go
package opener

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type recordedCommand struct {
	name string
	args []string
	dir  string
}

type fakeRunner struct {
	commands []recordedCommand
}

func (f *fakeRunner) Start(name string, args []string, dir string) error {
	f.commands = append(f.commands, recordedCommand{name: name, args: args, dir: dir})
	return nil
}

func TestOpenFolderUsesExplorer(t *testing.T) {
	dir := t.TempDir()
	runner := &fakeRunner{}
	service := NewService(runner)

	if err := service.OpenFolder(dir); err != nil {
		t.Fatalf("OpenFolder returned error: %v", err)
	}
	if len(runner.commands) != 1 {
		t.Fatalf("commands = %d, want 1", len(runner.commands))
	}
	if runner.commands[0].name != "explorer.exe" {
		t.Fatalf("command = %q, want explorer.exe", runner.commands[0].name)
	}
	if runner.commands[0].args[0] != dir {
		t.Fatalf("explorer arg = %q, want %q", runner.commands[0].args[0], dir)
	}
}

func TestOpenFolderRejectsMissingDirectory(t *testing.T) {
	runner := &fakeRunner{}
	service := NewService(runner)

	err := service.OpenFolder(filepath.Join(t.TempDir(), "missing"))
	if err == nil {
		t.Fatalf("OpenFolder error = nil, want error")
	}
	if len(runner.commands) != 0 {
		t.Fatalf("commands = %d, want 0", len(runner.commands))
	}
}

func TestOpenPowerShellAdminUsesRunAs(t *testing.T) {
	dir := t.TempDir()
	pwsh := filepath.Join(dir, "pwsh.exe")
	if err := os.WriteFile(pwsh, []byte(""), 0644); err != nil {
		t.Fatalf("write pwsh: %v", err)
	}
	runner := &fakeRunner{}
	service := NewService(runner)

	if err := service.OpenPowerShellAdmin(dir, pwsh); err != nil {
		t.Fatalf("OpenPowerShellAdmin returned error: %v", err)
	}
	if len(runner.commands) != 1 {
		t.Fatalf("commands = %d, want 1", len(runner.commands))
	}
	cmd := runner.commands[0]
	if cmd.name != "powershell.exe" {
		t.Fatalf("command = %q, want powershell.exe", cmd.name)
	}
	joined := strings.Join(cmd.args, " ")
	for _, part := range []string{"Start-Process", "-Verb", "RunAs", pwsh, dir} {
		if !strings.Contains(joined, part) {
			t.Fatalf("args %q do not contain %q", joined, part)
		}
	}
}

func TestCustomTemplateReplacesPath(t *testing.T) {
	dir := t.TempDir()
	runner := &fakeRunner{}
	service := NewService(runner)

	template := `"C:\Program Files\JetBrains\IntelliJ IDEA\bin\idea64.exe" "{path}"`
	if err := service.OpenCustom(dir, template); err != nil {
		t.Fatalf("OpenCustom returned error: %v", err)
	}
	if len(runner.commands) != 1 {
		t.Fatalf("commands = %d, want 1", len(runner.commands))
	}
	if runner.commands[0].name != "cmd.exe" {
		t.Fatalf("command = %q, want cmd.exe", runner.commands[0].name)
	}
	joined := strings.Join(runner.commands[0].args, " ")
	if !strings.Contains(joined, dir) {
		t.Fatalf("args %q do not contain directory %q", joined, dir)
	}
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
go test ./internal/opener -run Test -v
```

Expected: FAIL because opener service is not defined.

- [ ] **Step 3: Implement opener service**

Create `internal/opener/opener.go`:

```go
package opener

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

const DefaultPowerShell7Path = `C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.1.0_x64__8wekyb3d8bbwe\pwsh.exe`

type Runner interface {
	Start(name string, args []string, dir string) error
}

type ExecRunner struct{}

func (ExecRunner) Start(name string, args []string, dir string) error {
	cmd := exec.Command(name, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	return cmd.Start()
}

type Service struct {
	runner Runner
}

func NewService(runner Runner) *Service {
	if runner == nil {
		runner = ExecRunner{}
	}
	return &Service{runner: runner}
}

func (s *Service) OpenFolder(dir string) error {
	if err := requireDirectory(dir); err != nil {
		return err
	}
	return s.runner.Start("explorer.exe", []string{dir}, "")
}

func (s *Service) OpenPowerShellAdmin(dir string, pwshPath string) error {
	if err := requireDirectory(dir); err != nil {
		return err
	}
	if _, err := os.Stat(pwshPath); err != nil {
		return fmt.Errorf("PowerShell 7 路径不可用：%s: %w", pwshPath, err)
	}

	command := fmt.Sprintf(
		"Start-Process -FilePath %s -ArgumentList '-NoLogo','-NoExit' -WorkingDirectory %s -Verb RunAs",
		powershellQuote(pwshPath),
		powershellQuote(dir),
	)
	return s.runner.Start("powershell.exe", []string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command}, "")
}

func (s *Service) OpenCustom(dir string, commandTemplate string) error {
	if err := requireDirectory(dir); err != nil {
		return err
	}
	command := strings.ReplaceAll(commandTemplate, "{path}", dir)
	if strings.TrimSpace(command) == "" {
		return fmt.Errorf("自定义打开方式命令为空")
	}
	return s.runner.Start("cmd.exe", []string{"/C", "start", "", command}, dir)
}

func requireDirectory(dir string) error {
	info, err := os.Stat(dir)
	if err != nil {
		return fmt.Errorf("目录不存在：%s: %w", dir, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("路径不是目录：%s", dir)
	}
	return nil
}

func powershellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}
```

- [ ] **Step 4: Run opener tests**

Run:

```powershell
go test ./internal/opener -run Test -v
```

Expected: PASS.

- [ ] **Step 5: Commit opener package**

Run:

```powershell
git add internal/opener
git commit -m "feat: add directory openers"
```

Expected: commit created.

---

### Task 4: Wire Wails Backend API

**Files:**
- Modify: `app.go`
- Modify: `main.go`

- [ ] **Step 1: Replace `app.go` with backend API**

Use this `app.go`:

```go
package main

import (
	"context"
	"os"
	"path/filepath"

	appconfig "OpenWorkspacePS/internal/config"
	"OpenWorkspacePS/internal/opener"
)

type App struct {
	ctx    context.Context
	store  *appconfig.Store
	opener *opener.Service
	state  appconfig.AppState
}

func NewApp() *App {
	exeDir := exeDirectory()
	store := appconfig.NewStore(exeDir)
	state, _ := store.Load()
	return &App{
		store:  store,
		opener: opener.NewService(nil),
		state:  state,
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) GetAppState() appconfig.AppState {
	state, err := a.store.Load()
	if err != nil {
		a.state = state
		return state
	}
	a.state = state
	return state
}

func (a *App) SaveAppState(state appconfig.AppState) error {
	if err := a.store.Save(state); err != nil {
		return err
	}
	a.state = state
	return nil
}

func (a *App) OpenDirectory(directoryID string) error {
	dir, err := a.resolveDirectory(directoryID)
	if err != nil {
		return err
	}
	return a.opener.OpenFolder(dir)
}

func (a *App) OpenPowerShellAdmin(directoryID string) error {
	dir, err := a.resolveDirectory(directoryID)
	if err != nil {
		return err
	}
	return a.opener.OpenPowerShellAdmin(dir, opener.DefaultPowerShell7Path)
}

func (a *App) OpenWithCustomTool(directoryID string, openerID string) error {
	dir, err := a.resolveDirectory(directoryID)
	if err != nil {
		return err
	}
	for _, item := range a.state.CustomOpeners {
		if item.ID == openerID {
			return a.opener.OpenCustom(dir, item.CommandTemplate)
		}
	}
	return appError("未找到打开方式：" + openerID)
}

func (a *App) ValidatePath(pathValue string) bool {
	return a.store.ValidatePath(pathValue)
}

func (a *App) ResolvePath(pathValue string) string {
	return a.store.ResolvePath(pathValue)
}

func (a *App) resolveDirectory(directoryID string) (string, error) {
	a.state = a.GetAppState()
	for _, dir := range a.state.Directories {
		if dir.ID == directoryID {
			return a.store.ResolvePath(dir.Path), nil
		}
	}
	return "", appError("未找到目录：" + directoryID)
}

type appError string

func (e appError) Error() string {
	return string(e)
}

func exeDirectory() string {
	exe, err := os.Executable()
	if err != nil {
		wd, _ := os.Getwd()
		return wd
	}
	return filepath.Dir(exe)
}
```

- [ ] **Step 2: Ensure Wails startup calls `startup`**

Confirm `main.go` passes the app instance to Wails and calls `startup`:

```go
package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:  "OpenWorkspacePS",
		Width:  1120,
		Height: 720,
		MinWidth:  860,
		MinHeight: 560,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup: app.startup,
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
```

- [ ] **Step 3: Run backend tests**

Run:

```powershell
go test ./...
```

Expected: PASS.

- [ ] **Step 4: Generate Wails bindings**

Run:

```powershell
wails generate module
```

Expected: `frontend/wailsjs` contains generated bindings for backend methods.

- [ ] **Step 5: Commit backend API**

Run:

```powershell
git add app.go main.go frontend/wailsjs internal
git commit -m "feat: expose workspace backend api"
```

Expected: commit created.

---

### Task 5: Implement Frontend Types and API Adapter

**Files:**
- Create: `frontend/src/types.ts`
- Create: `frontend/src/api.ts`

- [ ] **Step 1: Create frontend types**

Create `frontend/src/types.ts`:

```ts
export type Group = {
  id: string;
  name: string;
};

export type DirectoryItem = {
  id: string;
  name: string;
  path: string;
  groupId: string;
};

export type CustomOpener = {
  id: string;
  name: string;
  commandTemplate: string;
};

export type ConfigStatus = {
  configExists: boolean;
  configPath: string;
  configError: string;
  usingDefaults: boolean;
};

export type AppState = {
  groups: Group[];
  directories: DirectoryItem[];
  customOpeners: CustomOpener[];
  config: ConfigStatus;
};

export type ViewMode = "grouped" | "flat";

export const emptyState: AppState = {
  groups: [],
  directories: [],
  customOpeners: [],
  config: {
    configExists: false,
    configPath: "",
    configError: "",
    usingDefaults: true,
  },
};
```

- [ ] **Step 2: Create API adapter**

Create `frontend/src/api.ts`:

```ts
import type { AppState } from "./types";
import {
  GetAppState,
  OpenDirectory,
  OpenPowerShellAdmin,
  OpenWithCustomTool,
  SaveAppState,
  ValidatePath,
} from "../wailsjs/go/main/App";

export const api = {
  getAppState(): Promise<AppState> {
    return GetAppState() as Promise<AppState>;
  },
  saveAppState(state: AppState): Promise<void> {
    return SaveAppState(state);
  },
  openDirectory(directoryId: string): Promise<void> {
    return OpenDirectory(directoryId);
  },
  openPowerShellAdmin(directoryId: string): Promise<void> {
    return OpenPowerShellAdmin(directoryId);
  },
  openWithCustomTool(directoryId: string, openerId: string): Promise<void> {
    return OpenWithCustomTool(directoryId, openerId);
  },
  validatePath(path: string): Promise<boolean> {
    return ValidatePath(path);
  },
};
```

- [ ] **Step 3: Run TypeScript build**

Run:

```powershell
npm run build --prefix frontend
```

Expected: build succeeds.

- [ ] **Step 4: Commit frontend API**

Run:

```powershell
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat: add frontend api adapter"
```

Expected: commit created.

---

### Task 6: Implement Responsive React Interface

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Replace `frontend/src/App.tsx`**

Use this component:

```tsx
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { AppState, CustomOpener, DirectoryItem, Group, ViewMode } from "./types";
import { emptyState } from "./types";
import "./styles.css";

type DialogMode = "directory" | "group" | "opener" | null;

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function App() {
  const [state, setState] = useState<AppState>(emptyState);
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grouped");
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [editingDirectory, setEditingDirectory] = useState<DirectoryItem | null>(null);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [editingOpener, setEditingOpener] = useState<CustomOpener | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.getAppState().then(setState).catch((error) => setMessage(String(error)));
  }, []);

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const directory of state.directories) {
      counts.set(directory.groupId, (counts.get(directory.groupId) ?? 0) + 1);
    }
    return counts;
  }, [state.directories]);

  const filteredDirectories = useMemo(() => {
    const value = query.trim().toLowerCase();
    return state.directories.filter((directory) => {
      const group = state.groups.find((item) => item.id === directory.groupId);
      const matchGroup = selectedGroup === "all" || directory.groupId === selectedGroup;
      const matchText =
        value === "" ||
        directory.name.toLowerCase().includes(value) ||
        directory.path.toLowerCase().includes(value) ||
        (group?.name.toLowerCase().includes(value) ?? false);
      return matchGroup && matchText;
    });
  }, [query, selectedGroup, state.directories, state.groups]);

  const persist = async (next: AppState) => {
    setState(next);
    await api.saveAppState(next);
    setMessage("已保存到 exe 同级 config.json");
  };

  const saveDirectory = async (directory: DirectoryItem) => {
    const exists = state.directories.some((item) => item.id === directory.id);
    const next = {
      ...state,
      directories: exists
        ? state.directories.map((item) => (item.id === directory.id ? directory : item))
        : [...state.directories, directory],
    };
    await persist(next);
    setDialog(null);
    setEditingDirectory(null);
  };

  const saveGroup = async (group: Group) => {
    const exists = state.groups.some((item) => item.id === group.id);
    const next = {
      ...state,
      groups: exists ? state.groups.map((item) => (item.id === group.id ? group : item)) : [...state.groups, group],
    };
    await persist(next);
    setDialog(null);
    setEditingGroup(null);
  };

  const saveOpener = async (opener: CustomOpener) => {
    const exists = state.customOpeners.some((item) => item.id === opener.id);
    const next = {
      ...state,
      customOpeners: exists
        ? state.customOpeners.map((item) => (item.id === opener.id ? opener : item))
        : [...state.customOpeners, opener],
    };
    await persist(next);
    setDialog(null);
    setEditingOpener(null);
  };

  const removeDirectory = async (id: string) => {
    await persist({ ...state, directories: state.directories.filter((item) => item.id !== id) });
  };

  const openAction = async (action: () => Promise<void>) => {
    try {
      await action();
      setMessage("打开命令已发送");
    } catch (error) {
      setMessage(String(error));
    }
  };

  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
      <header className="titlebar">
        <span className="window-dot" />
        <span className="window-dot" />
        <span className="window-dot" />
        <strong>OpenWorkspacePS</strong>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-head">
            <span>分组</span>
            <button className="icon-button" title="隐藏侧边栏" onClick={() => setSidebarOpen(false)}>‹</button>
          </div>
          <button className={selectedGroup === "all" ? "nav-item active" : "nav-item"} onClick={() => setSelectedGroup("all")}>
            <span>全部目录</span><span>{state.directories.length}</span>
          </button>
          {state.groups.map((group) => (
            <button key={group.id} className={selectedGroup === group.id ? "nav-item active" : "nav-item"} onClick={() => setSelectedGroup(group.id)}>
              <span>{group.name}</span><span>{groupCounts.get(group.id) ?? 0}</span>
            </button>
          ))}
        </aside>

        {!sidebarOpen && (
          <button className="expand-sidebar" title="展开侧边栏" onClick={() => setSidebarOpen(true)}>›</button>
        )}

        <main className="main-panel">
          <section className="toolbar">
            <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索名称、分组或路径" />
            <select value={selectedGroup} onChange={(event) => setSelectedGroup(event.target.value)}>
              <option value="all">全部目录</option>
              {state.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
            <button onClick={() => { setDialog("opener"); setEditingOpener(null); }}>打开方式</button>
            <button onClick={() => { setDialog("group"); setEditingGroup(null); }}>新增分组</button>
            <button className="primary" onClick={() => { setDialog("directory"); setEditingDirectory(null); }}>新增目录</button>
          </section>

          <section className="viewbar">
            <div className="segmented">
              <button className={viewMode === "grouped" ? "active" : ""} onClick={() => setViewMode("grouped")}>分组</button>
              <button className={viewMode === "flat" ? "active" : ""} onClick={() => setViewMode("flat")}>平铺</button>
            </div>
            <span>{filteredDirectories.length} 个目录，{state.customOpeners.length} 个自定义打开方式</span>
          </section>

          {state.config.configError && <div className="alert">配置读取失败：{state.config.configError}</div>}
          {message && <div className="status-message">{message}</div>}

          <section className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>分组</th>
                  <th>路径</th>
                  <th>打开方式</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredDirectories.map((directory) => {
                  const group = state.groups.find((item) => item.id === directory.groupId);
                  return (
                    <tr key={directory.id}>
                      <td className="strong">{directory.name}</td>
                      <td><span className="tag">{group?.name || "未分组"}</span></td>
                      <td className="path-cell">{directory.path}</td>
                      <td>
                        <div className="row-actions">
                          <button className="soft-primary" onClick={() => openAction(() => api.openPowerShellAdmin(directory.id))}>管理员 PowerShell 7</button>
                          <button onClick={() => openAction(() => api.openDirectory(directory.id))}>文件夹</button>
                          {state.customOpeners.slice(0, 1).map((opener) => (
                            <button key={opener.id} onClick={() => openAction(() => api.openWithCustomTool(directory.id, opener.id))}>{opener.name}</button>
                          ))}
                          {state.customOpeners.length > 1 && <button>更多工具</button>}
                        </div>
                      </td>
                      <td>
                        <div className="mini-actions">
                          <button onClick={() => { setEditingDirectory(directory); setDialog("directory"); }}>编辑</button>
                          <button onClick={() => removeDirectory(directory.id)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </main>
      </div>

      <footer className="statusbar">
        <span>PowerShell 7：C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.1.0_x64__8wekyb3d8bbwe\pwsh.exe</span>
        <span>配置：{state.config.configPath || "exe 同级 config.json"}</span>
      </footer>

      {dialog === "directory" && (
        <DirectoryDialog
          directory={editingDirectory}
          groups={state.groups}
          onCancel={() => setDialog(null)}
          onSave={saveDirectory}
        />
      )}
      {dialog === "group" && (
        <GroupDialog
          group={editingGroup}
          onCancel={() => setDialog(null)}
          onSave={saveGroup}
        />
      )}
      {dialog === "opener" && (
        <OpenerDialog
          opener={editingOpener}
          onCancel={() => setDialog(null)}
          onSave={saveOpener}
        />
      )}
    </div>
  );
}

function DirectoryDialog({ directory, groups, onCancel, onSave }: { directory: DirectoryItem | null; groups: Group[]; onCancel: () => void; onSave: (directory: DirectoryItem) => void }) {
  const [name, setName] = useState(directory?.name ?? "");
  const [path, setPath] = useState(directory?.path ?? "");
  const [groupId, setGroupId] = useState(directory?.groupId ?? groups[0]?.id ?? "");
  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={(event) => { event.preventDefault(); onSave({ id: directory?.id ?? newId("dir"), name, path, groupId }); }}>
        <h2>{directory ? "编辑目录" : "新增目录"}</h2>
        <label>名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label>路径<input value={path} onChange={(event) => setPath(event.target.value)} required /></label>
        <label>分组<select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">未分组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <div className="modal-actions"><button type="button" onClick={onCancel}>取消</button><button className="primary" type="submit">保存</button></div>
      </form>
    </div>
  );
}

function GroupDialog({ group, onCancel, onSave }: { group: Group | null; onCancel: () => void; onSave: (group: Group) => void }) {
  const [name, setName] = useState(group?.name ?? "");
  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={(event) => { event.preventDefault(); onSave({ id: group?.id ?? newId("group"), name }); }}>
        <h2>{group ? "编辑分组" : "新增分组"}</h2>
        <label>名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <div className="modal-actions"><button type="button" onClick={onCancel}>取消</button><button className="primary" type="submit">保存</button></div>
      </form>
    </div>
  );
}

function OpenerDialog({ opener, onCancel, onSave }: { opener: CustomOpener | null; onCancel: () => void; onSave: (opener: CustomOpener) => void }) {
  const [name, setName] = useState(opener?.name ?? "");
  const [commandTemplate, setCommandTemplate] = useState(opener?.commandTemplate ?? "\"C:\\Program Files\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe\" \"{path}\"");
  return (
    <div className="modal-backdrop">
      <form className="modal wide" onSubmit={(event) => { event.preventDefault(); onSave({ id: opener?.id ?? newId("opener"), name, commandTemplate }); }}>
        <h2>{opener ? "编辑打开方式" : "新增打开方式"}</h2>
        <label>名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label>命令模板<input value={commandTemplate} onChange={(event) => setCommandTemplate(event.target.value)} required /></label>
        <div className="modal-actions"><button type="button" onClick={onCancel}>取消</button><button className="primary" type="submit">保存</button></div>
      </form>
    </div>
  );
}

export default App;
```

- [ ] **Step 2: Replace `frontend/src/styles.css`**

Use the responsive CSS from the approved visual design, with these required rules:

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif; background: #edf1f6; color: #172033; }
button, input, select { font: inherit; }
.app-shell { height: 100vh; min-width: 720px; display: grid; grid-template-rows: 42px 1fr 34px; background: #f8fafc; }
.titlebar { display: flex; align-items: center; gap: 10px; padding: 0 14px; background: #f3f6fa; border-bottom: 1px solid #d9e2ee; }
.window-dot { width: 8px; height: 8px; border-radius: 50%; background: #94a3b8; }
.workspace { min-height: 0; display: grid; grid-template-columns: 176px 1fr; }
.sidebar-closed .workspace { grid-template-columns: 0 1fr; }
.sidebar { min-width: 0; overflow: hidden; background: #f4f7fb; border-right: 1px solid #d9e2ee; padding: 14px 10px; }
.sidebar-closed .sidebar { padding: 0; border-right: 0; }
.sidebar-head { display: flex; align-items: center; justify-content: space-between; padding: 0 6px 10px 8px; color: #64748b; font-size: 12px; font-weight: 700; }
.icon-button, .expand-sidebar { width: 28px; height: 28px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #475569; }
.expand-sidebar { position: absolute; top: 56px; left: 10px; z-index: 2; }
.nav-item { width: 100%; height: 34px; border: 0; border-radius: 6px; background: transparent; display: flex; align-items: center; justify-content: space-between; padding: 0 9px; color: #334155; }
.nav-item.active { background: #e6edf7; color: #0f172a; font-weight: 650; }
.main-panel { min-width: 0; padding: 14px 16px 16px; display: grid; grid-template-rows: auto auto auto 1fr; gap: 12px; }
.toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) 150px 112px 100px 100px; gap: 8px; align-items: center; }
.toolbar input, .toolbar select, .toolbar button { height: 34px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #334155; padding: 0 10px; min-width: 0; }
.primary { border-color: #1d4ed8 !important; background: #2563eb !important; color: #fff !important; font-weight: 650; }
.viewbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #64748b; font-size: 13px; }
.segmented { display: inline-flex; height: 30px; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; background: #fff; }
.segmented button { min-width: 64px; border: 0; border-left: 1px solid #e2e8f0; background: #fff; color: #64748b; }
.segmented button:first-child { border-left: 0; }
.segmented button.active { background: #edf2f7; color: #0f172a; font-weight: 650; }
.alert, .status-message { border-radius: 6px; padding: 8px 10px; font-size: 13px; }
.alert { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; }
.status-message { background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; }
.table-wrap { min-height: 0; overflow: auto; border: 1px solid #d9e2ee; border-radius: 8px; background: #fff; }
table { width: 100%; min-width: 980px; border-collapse: collapse; }
th, td { height: 54px; padding: 8px 12px; border-bottom: 1px solid #eef2f7; text-align: left; font-size: 13px; white-space: nowrap; }
th { height: 38px; background: #f8fafc; color: #64748b; font-size: 12px; }
.strong { font-weight: 700; color: #111827; }
.tag { display: inline-flex; height: 24px; align-items: center; padding: 0 8px; border-radius: 5px; background: #edf2f7; color: #475569; }
.path-cell { max-width: 320px; overflow: hidden; text-overflow: ellipsis; font-family: Consolas, "Cascadia Mono", monospace; font-size: 12px; color: #475569; }
.row-actions { display: grid; grid-template-columns: 150px 74px 74px 96px; gap: 6px; }
.row-actions button, .mini-actions button { height: 28px; border: 1px solid #cbd5e1; border-radius: 5px; background: #fff; color: #334155; font-size: 12px; white-space: nowrap; }
.row-actions .soft-primary { border-color: #9bb7e5; background: #f4f8ff; color: #1d4ed8; font-weight: 650; }
.mini-actions { display: flex; gap: 6px; }
.statusbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 14px; border-top: 1px solid #d9e2ee; background: #f8fafc; color: #64748b; font-size: 12px; overflow: hidden; }
.statusbar span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.modal-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, .28); display: flex; align-items: center; justify-content: center; padding: 20px; }
.modal { width: min(420px, 100%); background: #fff; border: 1px solid #d9e2ee; border-radius: 8px; padding: 18px; box-shadow: 0 18px 44px rgba(15, 23, 42, .18); }
.modal.wide { width: min(680px, 100%); }
.modal h2 { margin: 0 0 14px; font-size: 18px; }
.modal label { display: grid; gap: 6px; margin-bottom: 12px; font-size: 13px; color: #334155; }
.modal input, .modal select { height: 34px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0 10px; min-width: 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.modal-actions button { height: 34px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; padding: 0 14px; }
@media (max-width: 1040px) {
  .toolbar { grid-template-columns: minmax(180px, 1fr) 140px 100px 96px; }
  .toolbar button:nth-of-type(1) { grid-column: span 1; }
  .row-actions { grid-template-columns: 150px 74px 96px; }
  .row-actions button:nth-child(3) { display: none; }
}
@media (max-width: 820px) {
  .app-shell { min-width: 640px; }
  .workspace { grid-template-columns: 0 1fr; }
  .sidebar { padding: 0; border-right: 0; }
  .toolbar { grid-template-columns: 1fr 1fr; }
  .viewbar { align-items: flex-start; flex-direction: column; }
  table { min-width: 900px; }
}
```

- [ ] **Step 3: Run frontend build**

Run:

```powershell
npm run build --prefix frontend
```

Expected: build succeeds.

- [ ] **Step 4: Commit UI**

Run:

```powershell
git add frontend/src/App.tsx frontend/src/styles.css
git commit -m "feat: build responsive workspace manager ui"
```

Expected: commit created.

---

### Task 7: Build and Verify Executable

**Files:**
- Modify: `docs/superpowers/specs/2026-04-24-openworkspaceps-design.md`

- [ ] **Step 1: Run full tests**

Run:

```powershell
go test ./...
```

Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run:

```powershell
npm run build --prefix frontend
```

Expected: build succeeds.

- [ ] **Step 3: Build Windows exe**

Run:

```powershell
wails build
```

Expected: `build/bin/OpenWorkspacePS.exe` exists.

- [ ] **Step 4: Verify no-config startup**

Run:

```powershell
Remove-Item -LiteralPath .\build\bin\config.json -Force -ErrorAction SilentlyContinue
Start-Process -FilePath .\build\bin\OpenWorkspacePS.exe
```

Expected: app opens without `config.json`; status bar shows exe 同级配置路径.

- [ ] **Step 5: Verify config creation**

In the app:

1. Add group `工作项目`.
2. Add directory `open_workspase_ps` with path `..\..\`.
3. Close app.

Run:

```powershell
Test-Path .\build\bin\config.json
```

Expected: `True`.

- [ ] **Step 6: Verify responsive layout**

Manually resize the app to wide, medium, and narrow widths.

Expected:

- No text overlaps adjacent controls.
- Sidebar hides and expands.
- Table scrolls horizontally in narrow width.
- Long path values use ellipsis.
- Open buttons remain clickable.

- [ ] **Step 7: Verify opening actions**

In the app:

1. Click `文件夹` for an existing directory.
2. Click `IDEA` for an existing directory.
3. Click `管理员 PowerShell 7` for an existing directory.

Expected:

- Explorer opens the directory.
- IDEA receives the selected path through `{path}`.
- PowerShell 7 triggers Windows administrator elevation prompt and opens in selected directory.

- [ ] **Step 8: Record verification result in spec**

Append this section to `docs/superpowers/specs/2026-04-24-openworkspaceps-design.md`:

```markdown
## 实现验证

- `go test ./...`：通过。
- `npm run build --prefix frontend`：通过。
- `wails build`：通过，生成 `build/bin/OpenWorkspacePS.exe`。
- 无 `config.json` 启动：通过。
- 首次保存自动创建 `config.json`：通过。
- 响应式布局人工验证：通过。
```

- [ ] **Step 9: Commit verification**

Run:

```powershell
git add docs/superpowers/specs/2026-04-24-openworkspaceps-design.md
git commit -m "docs: record openworkspaceps verification"
```

Expected: commit created.

---

## Self-Review

Spec coverage:

- Wails + Go + React/TypeScript: covered by Task 1 and Task 6.
- exe 同级 `config.json`: covered by Task 2 and Task 7.
- no-config startup: covered by Task 2 and Task 7.
- relative path resolution: covered by Task 2.
- admin PowerShell 7 fixed path: covered by Task 3 and Task 7.
- folder open: covered by Task 3 and Task 7.
- custom command template: covered by Task 3 and Task 7.
- group and flat view: covered by Task 6.
- sidebar hide/show: covered by Task 6 and Task 7.
- responsive layout: covered by Task 6 and Task 7.
- damaged config handling: covered by Task 2.

占位内容扫描：

- 未发现待补内容、未完成文件路径或未定义任务引用。

Type consistency:

- Backend `AppState`, `Group`, `Directory`, `CustomOpener`, and `ConfigStatus` match frontend `types.ts`.
- Backend method names match frontend `api.ts` imports.
- PowerShell fixed path is defined once in `internal/opener/opener.go` and shown in the UI footer.
