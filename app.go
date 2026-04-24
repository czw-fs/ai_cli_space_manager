package main

import (
	"context"
	"errors"
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
	return errors.New("未找到打开方式：" + openerID)
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
