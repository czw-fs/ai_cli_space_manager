//go:build !windows

package terminal

import pty "github.com/aymanbagabas/go-pty"

func attachProcessLifetime(cmd *pty.Cmd) (processLifetime, error) {
	return nil, nil
}
