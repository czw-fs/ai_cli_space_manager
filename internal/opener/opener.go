package opener

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

const DefaultPowerShell7Path = `C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.1.0_x64__8wekyb3d8bbwe\pwsh.exe`

type Runner interface {
	Start(name string, args []string, dir string) error
}

type ExecRunner struct{}

func (ExecRunner) Start(name string, args []string, dir string) error {
	cmd := exec.Command(name, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	return cmd.Start()
}

type Service struct {
	runner Runner
}

func NewService(runner Runner) *Service {
	if runner == nil {
		runner = ExecRunner{}
	}
	return &Service{runner: runner}
}

func (s *Service) OpenFolder(dir string) error {
	if err := requireDirectory(dir); err != nil {
		return err
	}
	return s.runner.Start("explorer.exe", []string{dir}, "")
}

func (s *Service) OpenPowerShellAdmin(dir string, pwshPath string) error {
	if err := requireDirectory(dir); err != nil {
		return err
	}
	if _, err := os.Stat(pwshPath); err != nil {
		return fmt.Errorf("PowerShell 7 路径不可用：%s: %w", pwshPath, err)
	}

	command := fmt.Sprintf(
		"Start-Process -FilePath %s -ArgumentList '-NoLogo','-NoExit' -WorkingDirectory %s -Verb RunAs",
		powershellQuote(pwshPath),
		powershellQuote(dir),
	)
	return s.runner.Start("powershell.exe", []string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command}, "")
}

func (s *Service) OpenCustom(dir string, commandTemplate string) error {
	if err := requireDirectory(dir); err != nil {
		return err
	}
	command := strings.ReplaceAll(commandTemplate, "{path}", dir)
	if strings.TrimSpace(command) == "" {
		return fmt.Errorf("自定义打开方式命令为空")
	}
	return s.runner.Start("cmd.exe", []string{"/C", command}, dir)
}

func requireDirectory(dir string) error {
	info, err := os.Stat(dir)
	if err != nil {
		return fmt.Errorf("目录不存在：%s: %w", dir, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("路径不是目录：%s", dir)
	}
	return nil
}

func powershellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}
