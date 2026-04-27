package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"OpenWorkspacePS/internal/attachment"
	appconfig "OpenWorkspacePS/internal/config"
	"OpenWorkspacePS/internal/opener"
	"OpenWorkspacePS/internal/terminal"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx      context.Context
	store    *appconfig.Store
	opener   *opener.Service
	attach   *attachment.Service
	terminal *terminal.Service
	state    appconfig.AppState
}

func NewApp() *App {
	exeDir := exeDirectory()
	store := appconfig.NewStore(exeDir)
	state, _ := store.Load()
	return &App{
		store:    store,
		opener:   opener.NewService(nil),
		attach:   attachment.NewService(exeDir),
		terminal: terminal.NewService(opener.DefaultPowerShell7Path),
		state:    state,
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.terminal.SetEventSink(func(eventName string, data any) {
		wailsruntime.EventsEmit(ctx, eventName, data)
	})
}

func (a *App) shutdown(ctx context.Context) {
	a.terminal.StopAll()
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
	mode := opener.PowerShellLaunchMode(a.state.UI.PowerShellLaunchMode)
	return a.opener.OpenPowerShellAdmin(dir, opener.DefaultPowerShell7Path, mode)
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
	return errors.New("未找到打开方式：" + openerID)
}

func (a *App) StartEmbeddedTerminal(directoryID string) (terminal.SessionInfo, error) {
	dir, err := a.resolveDirectory(directoryID)
	if err != nil {
		return terminal.SessionInfo{}, err
	}
	title := dir
	for _, item := range a.state.Directories {
		if item.ID == directoryID {
			title = item.Name
			break
		}
	}
	return a.terminal.Start(dir, title)
}

func (a *App) GetTerminalSessions() []terminal.SessionInfo {
	return a.terminal.Sessions()
}

func (a *App) WriteTerminalInput(sessionID string, input string) error {
	return a.terminal.Write(sessionID, input)
}

func (a *App) ResizeTerminal(sessionID string, cols int, rows int) error {
	return a.terminal.Resize(sessionID, cols, rows)
}

func (a *App) StopTerminal(sessionID string) error {
	return a.terminal.Stop(sessionID)
}

func (a *App) SaveAttachment(request attachment.SaveRequest) (attachment.FileInfo, error) {
	if strings.TrimSpace(request.AttachmentRootPath) == "" {
		a.state = a.GetAppState()
		request.AttachmentRootPath = a.state.UI.AttachmentRootPath
	}
	return a.attach.Save(request)
}

func (a *App) OpenAttachment(pathValue string) error {
	return a.attach.Open(pathValue)
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
	return "", errors.New("未找到目录：" + directoryID)
}

func exeDirectory() string {
	exe, err := os.Executable()
	if err != nil {
		wd, _ := os.Getwd()
		return wd
	}
	return filepath.Dir(exe)
}
