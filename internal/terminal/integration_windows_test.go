//go:build windows

package terminal

import (
	"context"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	pty "github.com/aymanbagabas/go-pty"
)

func TestPowerShellConPtyReceivesCommandOutput(t *testing.T) {
	if os.Getenv("OPEN_WORKSPACE_PS_INTEGRATION") != "1" {
		t.Skip("set OPEN_WORKSPACE_PS_INTEGRATION=1 to run the ConPTY integration test")
	}

	pwshPath := os.Getenv("OPEN_WORKSPACE_PS_PWSH")
	if pwshPath == "" {
		pwshPath = `C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.1.0_x64__8wekyb3d8bbwe\pwsh.exe`
	}

	output := runPowerShellConPty(t, pwshPath, t.TempDir(), &syscall.SysProcAttr{HideWindow: true})
	if !strings.Contains(output, "READY_FROM_CONPTY") {
		t.Fatalf("missing command output; received %q", output)
	}
}

func TestServiceReceivesPowerShellCommandOutput(t *testing.T) {
	if os.Getenv("OPEN_WORKSPACE_PS_INTEGRATION") != "1" {
		t.Skip("set OPEN_WORKSPACE_PS_INTEGRATION=1 to run the ConPTY integration test")
	}

	pwshPath := os.Getenv("OPEN_WORKSPACE_PS_PWSH")
	if pwshPath == "" {
		pwshPath = `C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.1.0_x64__8wekyb3d8bbwe\pwsh.exe`
	}

	service := NewService(pwshPath)
	output := make(chan string, 64)
	service.SetEventSink(func(eventName string, data any) {
		if eventName != "terminal:output" {
			return
		}
		event, ok := data.(OutputEvent)
		if ok {
			output <- event.Data
		}
	})

	session, err := service.Start(t.TempDir(), "test")
	if err != nil {
		t.Fatal(err)
	}
	defer service.Stop(session.ID)

	if err := service.Write(session.ID, "'SERVICE_READY_FROM_CONPTY'\r"); err != nil {
		t.Fatal(err)
	}

	deadline := time.After(8 * time.Second)
	var received strings.Builder
	for {
		select {
		case chunk := <-output:
			received.WriteString(chunk)
			if strings.Contains(received.String(), "SERVICE_READY_FROM_CONPTY") {
				return
			}
		case <-deadline:
			t.Fatalf("timed out waiting for service output; received %q", received.String())
		}
	}
}

func TestServiceStopKillsChildProcess(t *testing.T) {
	if os.Getenv("OPEN_WORKSPACE_PS_INTEGRATION") != "1" {
		t.Skip("set OPEN_WORKSPACE_PS_INTEGRATION=1 to run the ConPTY integration test")
	}

	pwshPath := os.Getenv("OPEN_WORKSPACE_PS_PWSH")
	if pwshPath == "" {
		pwshPath = `C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.1.0_x64__8wekyb3d8bbwe\pwsh.exe`
	}

	service := NewService(pwshPath)
	output := make(chan string, 128)
	service.SetEventSink(func(eventName string, data any) {
		if eventName != "terminal:output" {
			return
		}
		event, ok := data.(OutputEvent)
		if ok {
			output <- event.Data
		}
	})

	session, err := service.Start(t.TempDir(), "test")
	if err != nil {
		t.Fatal(err)
	}

	marker := "CHILD_PID:"
	command := "$p = Start-Process -FilePath $PSHOME\\pwsh.exe -ArgumentList '-NoLogo','-NoExit','-Command','Start-Sleep -Seconds 120' -PassThru; '" + marker + "' + $p.Id\r"
	if err := service.Write(session.ID, command); err != nil {
		t.Fatal(err)
	}

	pid := waitForMarkedPID(t, output, marker)
	rootPID := serviceProcessID(t, service, session.ID)
	parentMap, err := processParentMap()
	if err != nil {
		t.Fatal(err)
	}
	descendants, err := descendantProcessIDs(uint32(rootPID))
	if err != nil {
		t.Fatal(err)
	}
	t.Logf(
		"test pid=%d test parent pid=%d root pid=%d root parent pid=%d child pid=%d child parent pid=%d descendants=%v",
		os.Getpid(),
		parentPID(parentMap, uint32(os.Getpid())),
		rootPID,
		parentPID(parentMap, uint32(rootPID)),
		pid,
		parentPID(parentMap, uint32(pid)),
		descendants,
	)

	if err := service.Stop(session.ID); err != nil {
		t.Fatal(err)
	}

	if processExists(pid) {
		_ = terminateProcess(uint32(pid))
		t.Fatalf("expected child process %d to be stopped with terminal session", pid)
	}
}

func serviceProcessID(t *testing.T, service *Service, sessionID string) int {
	t.Helper()

	item, err := service.get(sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if item.cmd == nil || item.cmd.Process == nil {
		t.Fatal("missing session process")
	}
	return item.cmd.Process.Pid
}

func runPowerShellConPty(t *testing.T, pwshPath string, dir string, attrs *syscall.SysProcAttr) string {
	t.Helper()

	terminal, err := pty.New()
	if err != nil {
		t.Fatal(err)
	}
	defer terminal.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cmd := terminal.CommandContext(ctx, pwshPath, "-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass")
	cmd.SysProcAttr = attrs
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "WT_SESSION=OpenWorkspacePS")

	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer cmd.Wait()

	output := make(chan string, 64)
	go func() {
		buf := make([]byte, 8192)
		for {
			n, err := terminal.Read(buf)
			if n > 0 {
				output <- string(buf[:n])
			}
			if err != nil {
				return
			}
		}
	}()

	if _, err := terminal.Write([]byte("'READY_FROM_CONPTY'\r")); err != nil {
		t.Fatal(err)
	}

	deadline := time.After(8 * time.Second)
	var received strings.Builder
	for {
		select {
		case chunk := <-output:
			received.WriteString(chunk)
			if strings.Contains(received.String(), "READY_FROM_CONPTY") {
				cancel()
				return received.String()
			}
		case <-deadline:
			cancel()
			return received.String()
		}
	}
}

func waitForMarkedPID(t *testing.T, output <-chan string, marker string) int {
	t.Helper()

	deadline := time.After(8 * time.Second)
	var received strings.Builder
	for {
		select {
		case chunk := <-output:
			received.WriteString(chunk)
			text := received.String()
			index := strings.LastIndex(text, marker)
			if index < 0 {
				continue
			}
			rest := text[index+len(marker):]
			fields := strings.Fields(rest)
			if len(fields) == 0 {
				continue
			}
			pid, err := strconv.Atoi(fields[0])
			if err == nil {
				return pid
			}
		case <-deadline:
			t.Fatalf("timed out waiting for child process PID; received %q", received.String())
		}
	}
}

func processExists(pid int) bool {
	for i := 0; i < 20; i++ {
		err := exec.Command("powershell.exe", "-NoProfile", "-Command", "if (Get-Process -Id "+strconv.Itoa(pid)+" -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }").Run()
		if err != nil {
			return false
		}
		time.Sleep(100 * time.Millisecond)
	}
	return true
}

func parentPID(parentMap map[uint32][]uint32, pid uint32) uint32 {
	for parent, children := range parentMap {
		for _, child := range children {
			if child == pid {
				return parent
			}
		}
	}
	return 0
}
