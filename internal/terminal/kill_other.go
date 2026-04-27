//go:build !windows

package terminal

import pty "github.com/aymanbagabas/go-pty"

func killProcessTree(cmd *pty.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}
