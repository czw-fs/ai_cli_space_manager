//go:build !windows

package terminal

import pty "github.com/aymanbagabas/go-pty"

func configureEmbeddedCommand(cmd *pty.Cmd) {
}
