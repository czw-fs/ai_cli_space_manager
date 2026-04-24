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
	programFiles := filepath.Join(t.TempDir(), "ProgramFiles")
	terminalDir := filepath.Join(programFiles, "WindowsApps", "Microsoft.WindowsTerminal_1.24.10921.0_x64__8wekyb3d8bbwe")
	if err := os.MkdirAll(terminalDir, 0755); err != nil {
		t.Fatalf("mkdir terminal dir: %v", err)
	}
	wt := filepath.Join(terminalDir, "wt.exe")
	if err := os.WriteFile(wt, []byte(""), 0644); err != nil {
		t.Fatalf("write wt: %v", err)
	}
	t.Setenv("LOCALAPPDATA", filepath.Join(t.TempDir(), "missing-local-app-data"))
	t.Setenv("ProgramFiles", programFiles)
	t.Setenv("ProgramW6432", filepath.Join(t.TempDir(), "missing-program-w6432"))
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
	for _, part := range []string{"Start-Process", "-Verb", "RunAs", wt, "new-tab", "-d", pwsh, dir} {
		if !strings.Contains(joined, part) {
			t.Fatalf("args %q do not contain %q", joined, part)
		}
	}
}

func TestOpenPowerShellAdminRejectsMissingPwsh(t *testing.T) {
	dir := t.TempDir()
	runner := &fakeRunner{}
	service := NewService(runner)

	err := service.OpenPowerShellAdmin(dir, filepath.Join(dir, "missing-pwsh.exe"))
	if err == nil {
		t.Fatalf("OpenPowerShellAdmin error = nil, want error")
	}
	if len(runner.commands) != 0 {
		t.Fatalf("commands = %d, want 0", len(runner.commands))
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
