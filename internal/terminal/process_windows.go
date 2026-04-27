package terminal

import (
	"syscall"

	pty "github.com/aymanbagabas/go-pty"
)

func configureEmbeddedCommand(cmd *pty.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow: true,
	}
}
