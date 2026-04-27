package terminal

import (
	"testing"

	pty "github.com/aymanbagabas/go-pty"
)

func TestConfigureEmbeddedCommandHidesConsoleWindow(t *testing.T) {
	cmd := &pty.Cmd{}

	configureEmbeddedCommand(cmd)

	if cmd.SysProcAttr == nil {
		t.Fatal("expected SysProcAttr to be configured")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("expected HideWindow to be enabled")
	}
	if cmd.SysProcAttr.CreationFlags != 0 {
		t.Fatalf("expected ConPTY-compatible creation flags, got %#x", cmd.SysProcAttr.CreationFlags)
	}
}
