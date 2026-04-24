package config

import (
	"encoding/json"
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
		t.Fatalf("default groups/directories should be empty")
	}
	if len(state.CustomOpeners) != 1 || state.CustomOpeners[0].Name != "IDEA" {
		t.Fatalf("default custom opener not initialized: %#v", state.CustomOpeners)
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
