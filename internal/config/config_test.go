package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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
		t.Fatalf("default groups/directories should be empty")
	}
	if len(state.CustomOpeners) != 1 || state.CustomOpeners[0].Name != "IDEA" {
		t.Fatalf("default custom opener not initialized: %#v", state.CustomOpeners)
	}
	if strings.Contains(state.CustomOpeners[0].CommandTemplate, "{path}") {
		t.Fatalf("default custom opener should store only the application path: %q", state.CustomOpeners[0].CommandTemplate)
	}
	if state.UI.ColumnWidths.Search != 180 {
		t.Fatalf("default search width = %d, want 180", state.UI.ColumnWidths.Search)
	}
	if state.UI.ColumnWidths.Path == 0 {
		t.Fatalf("default UI column widths were not initialized")
	}
	if state.UI.PowerShellLaunchMode != "tab" {
		t.Fatalf("default PowerShell launch mode = %q, want tab", state.UI.PowerShellLaunchMode)
	}
	if state.UI.AttachmentRootPath != "codex_attachments" {
		t.Fatalf("default attachment root path = %q, want codex_attachments", state.UI.AttachmentRootPath)
	}
	if state.UI.SidebarWidth != 176 {
		t.Fatalf("default sidebar width = %d, want 176", state.UI.SidebarWidth)
	}
	if state.UI.ComposerHeight != 66 {
		t.Fatalf("default composer height = %d, want 66", state.UI.ComposerHeight)
	}
	if state.UI.EnterKeyMode != "send" {
		t.Fatalf("default enter key mode = %q, want send", state.UI.EnterKeyMode)
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

	content, err := os.ReadFile(filepath.Join(dir, ConfigFileName))
	if err != nil {
		t.Fatalf("config.json not created: %v", err)
	}
	var persisted map[string]json.RawMessage
	if err := json.Unmarshal(content, &persisted); err != nil {
		t.Fatalf("saved config is invalid json: %v", err)
	}
	if _, ok := persisted["config"]; ok {
		t.Fatalf("runtime config status should not be persisted")
	}
	if _, ok := persisted["ui"]; !ok {
		t.Fatalf("ui settings should be persisted")
	}
}

func TestLoadDeduplicatesEquivalentCustomOpeners(t *testing.T) {
	dir := t.TempDir()
	configText := `{"groups":[],"directories":[],"customOpeners":[{"id":"idea-1","name":"idea","commandTemplate":"\"C:\\app\\idea64.exe\""},{"id":"idea-2","name":"idea","commandTemplate":"\"C:\\app\\idea64.exe\""},{"id":"code","name":"code","commandTemplate":"\"C:\\app\\code.exe\""}],"ui":{"columnWidths":{}}}`
	if err := os.WriteFile(filepath.Join(dir, ConfigFileName), []byte(configText), 0644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	state, err := NewStore(dir).Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if len(state.CustomOpeners) != 2 {
		t.Fatalf("custom openers = %#v, want 2 unique entries", state.CustomOpeners)
	}
	if state.CustomOpeners[0].ID != "idea-1" || state.CustomOpeners[1].ID != "code" {
		t.Fatalf("custom opener order = %#v, want first duplicate kept", state.CustomOpeners)
	}
}

func TestLoadNormalizesUISizesAndColumnWidths(t *testing.T) {
	dir := t.TempDir()
	configText := `{"groups":[],"directories":[],"customOpeners":[],"ui":{"powerShellLaunchMode":"window","sidebarWidth":80,"composerHeight":999,"columnWidths":{"search":30,"name":1,"group":9999,"path":0,"actions":280,"manage":90}}}`
	if err := os.WriteFile(filepath.Join(dir, ConfigFileName), []byte(configText), 0644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	state, err := NewStore(dir).Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if state.UI.ColumnWidths.Name != 72 {
		t.Fatalf("name width = %d, want min clamp 72", state.UI.ColumnWidths.Name)
	}
	if state.UI.ColumnWidths.Search != 96 {
		t.Fatalf("search width = %d, want min clamp 96", state.UI.ColumnWidths.Search)
	}
	if state.UI.ColumnWidths.Group != 260 {
		t.Fatalf("group width = %d, want max clamp 260", state.UI.ColumnWidths.Group)
	}
	if state.UI.ColumnWidths.Path != 260 {
		t.Fatalf("path width = %d, want default 260", state.UI.ColumnWidths.Path)
	}
	if state.UI.ColumnWidths.Actions != 500 {
		t.Fatalf("actions width = %d, want min clamp 500", state.UI.ColumnWidths.Actions)
	}
	if state.UI.PowerShellLaunchMode != "window" {
		t.Fatalf("PowerShell launch mode = %q, want window", state.UI.PowerShellLaunchMode)
	}
	if state.UI.SidebarWidth != 128 {
		t.Fatalf("sidebar width = %d, want min clamp 128", state.UI.SidebarWidth)
	}
	if state.UI.ComposerHeight != 180 {
		t.Fatalf("composer height = %d, want max clamp 180", state.UI.ComposerHeight)
	}
}

func TestSavePersistsSearchColumnWidth(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	state := DefaultState(dir)
	state.UI.ColumnWidths.Search = 240

	if err := store.Save(state); err != nil {
		t.Fatalf("Save returned error: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(dir, ConfigFileName))
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	var persisted struct {
		UI struct {
			ColumnWidths struct {
				Search int `json:"search"`
			} `json:"columnWidths"`
		} `json:"ui"`
	}
	if err := json.Unmarshal(content, &persisted); err != nil {
		t.Fatalf("saved config is invalid json: %v", err)
	}
	if persisted.UI.ColumnWidths.Search != 240 {
		t.Fatalf("saved search width = %d, want 240", persisted.UI.ColumnWidths.Search)
	}
}

func TestLoadClampsSearchColumnWidthToFrontendMaximum(t *testing.T) {
	dir := t.TempDir()
	configText := `{"groups":[],"directories":[],"customOpeners":[],"ui":{"columnWidths":{"search":520}}}`
	if err := os.WriteFile(filepath.Join(dir, ConfigFileName), []byte(configText), 0644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	state, err := NewStore(dir).Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if state.UI.ColumnWidths.Search != 420 {
		t.Fatalf("search width = %d, want max clamp 420", state.UI.ColumnWidths.Search)
	}
}

func TestLoadNormalizesInvalidPowerShellLaunchMode(t *testing.T) {
	dir := t.TempDir()
	configText := `{"groups":[],"directories":[],"customOpeners":[],"ui":{"powerShellLaunchMode":"bad","enterKeyMode":"bad","attachmentRootPath":"","columnWidths":{}}}`
	if err := os.WriteFile(filepath.Join(dir, ConfigFileName), []byte(configText), 0644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	state, err := NewStore(dir).Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if state.UI.PowerShellLaunchMode != "tab" {
		t.Fatalf("PowerShell launch mode = %q, want tab", state.UI.PowerShellLaunchMode)
	}
	if state.UI.AttachmentRootPath != "codex_attachments" {
		t.Fatalf("attachment root path = %q, want codex_attachments", state.UI.AttachmentRootPath)
	}
	if state.UI.SidebarWidth != 176 {
		t.Fatalf("sidebar width = %d, want default 176", state.UI.SidebarWidth)
	}
	if state.UI.ComposerHeight != 66 {
		t.Fatalf("composer height = %d, want default 66", state.UI.ComposerHeight)
	}
	if state.UI.EnterKeyMode != "send" {
		t.Fatalf("enter key mode = %q, want send", state.UI.EnterKeyMode)
	}
}

func TestLoadInvalidConfigReturnsDefaultStateWithError(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ConfigFileName), []byte("{bad-json"), 0644); err != nil {
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

func TestValidatePathOnlyAcceptsDirectories(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)
	file := filepath.Join(dir, "file.txt")
	if err := os.WriteFile(file, []byte("x"), 0644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	if !store.ValidatePath(".") {
		t.Fatalf("ValidatePath rejected existing directory")
	}
	if store.ValidatePath(file) {
		t.Fatalf("ValidatePath accepted file path")
	}
	if store.ValidatePath(filepath.Join(dir, "missing")) {
		t.Fatalf("ValidatePath accepted missing path")
	}
}
