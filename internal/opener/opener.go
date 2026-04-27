package opener

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

const DefaultPowerShell7Path = `C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.1.0_x64__8wekyb3d8bbwe\pwsh.exe`

type PowerShellLaunchMode string

const (
	PowerShellLaunchModeTab    PowerShellLaunchMode = "tab"
	PowerShellLaunchModeWindow PowerShellLaunchMode = "window"
)

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

func (s *Service) OpenPowerShellAdmin(dir string, pwshPath string, mode PowerShellLaunchMode) error {
	if err := requireDirectory(dir); err != nil {
		return err
	}
	if _, err := os.Stat(pwshPath); err != nil {
		return fmt.Errorf("PowerShell 7 路径不可用：%s: %w", pwshPath, err)
	}

	if wtPath, ok := windowsTerminalPath(); ok {
		terminalArgs := powershellTerminalArgs(dir, pwshPath, mode)
		command := fmt.Sprintf(
			"Start-Process -FilePath %s -ArgumentList %s -Verb RunAs",
			powershellQuote(wtPath),
			powershellArray(terminalArgs...),
		)
		return s.runner.Start("powershell.exe", []string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command}, "")
	}

	command := fmt.Sprintf(
		"Start-Process -FilePath %s -ArgumentList %s -WorkingDirectory %s -Verb RunAs",
		powershellQuote(pwshPath),
		powershellArray("-NoLogo", "-NoExit"),
		powershellQuote(dir),
	)
	return s.runner.Start("powershell.exe", []string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command}, "")
}

func powershellTerminalArgs(dir string, pwshPath string, mode PowerShellLaunchMode) []string {
	windowTarget := "0"
	if mode == PowerShellLaunchModeWindow {
		windowTarget = "-1"
	}
	return []string{"-w", windowTarget, "new-tab", "-d", dir, pwshPath, "-NoLogo", "-NoExit"}
}

func (s *Service) OpenCustom(dir string, commandTemplate string) error {
	if err := requireDirectory(dir); err != nil {
		return err
	}
	command := strings.TrimSpace(commandTemplate)
	if command == "" {
		return fmt.Errorf("自定义打开方式命令为空")
	}
	if !strings.Contains(command, "{path}") {
		command = command + " " + windowsCommandLineArg(dir)
	}
	command = strings.ReplaceAll(command, "{path}", dir)
	name, args, err := splitWindowsCommandLine(command)
	if err != nil {
		return err
	}
	resolvedName, err := resolveExecutable(name, dir)
	if err != nil {
		return err
	}
	return s.runner.Start(resolvedName, args, dir)
}

func splitWindowsCommandLine(command string) (string, []string, error) {
	var args []string
	var current strings.Builder
	inQuotes := false
	escapedBackslashes := 0

	flushBackslashes := func(count int) {
		if count > 0 {
			current.WriteString(strings.Repeat("\\", count))
		}
	}

	for _, char := range command {
		switch char {
		case '\\':
			escapedBackslashes++
		case '"':
			flushBackslashes(escapedBackslashes / 2)
			if escapedBackslashes%2 == 0 {
				inQuotes = !inQuotes
			} else {
				current.WriteRune(char)
			}
			escapedBackslashes = 0
		case ' ', '\t':
			flushBackslashes(escapedBackslashes)
			escapedBackslashes = 0
			if inQuotes {
				current.WriteRune(char)
				continue
			}
			if current.Len() > 0 {
				args = append(args, current.String())
				current.Reset()
			}
		default:
			flushBackslashes(escapedBackslashes)
			escapedBackslashes = 0
			current.WriteRune(char)
		}
	}
	flushBackslashes(escapedBackslashes)
	if inQuotes {
		return "", nil, fmt.Errorf("自定义打开方式命令引号未闭合")
	}
	if current.Len() > 0 {
		args = append(args, current.String())
	}
	if len(args) == 0 {
		return "", nil, fmt.Errorf("自定义打开方式命令为空")
	}
	return args[0], args[1:], nil
}

func resolveExecutable(name string, dir string) (string, error) {
	hasPath := strings.ContainsAny(name, `\/`) || filepath.VolumeName(name) != ""
	if !hasPath {
		resolved, err := exec.LookPath(name)
		if err != nil {
			return "", fmt.Errorf("找不到自定义打开方式程序：%s", name)
		}
		return resolved, nil
	}

	candidate := name
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(dir, candidate)
	}
	info, err := os.Stat(candidate)
	if err != nil {
		return "", fmt.Errorf("找不到自定义打开方式程序：%s: %w", name, err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("自定义打开方式程序不是文件：%s", name)
	}
	return candidate, nil
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

func powershellArray(values ...string) string {
	quoted := make([]string, 0, len(values))
	for _, value := range values {
		quoted = append(quoted, powershellQuote(windowsCommandLineArg(value)))
	}
	return "@(" + strings.Join(quoted, ",") + ")"
}

func windowsCommandLineArg(value string) string {
	if value == "" {
		return `""`
	}
	if !strings.ContainsAny(value, " \t\n\v\"") {
		return value
	}

	var builder strings.Builder
	builder.WriteByte('"')
	backslashes := 0
	for _, char := range value {
		switch char {
		case '\\':
			backslashes++
		case '"':
			builder.WriteString(strings.Repeat("\\", backslashes*2+1))
			builder.WriteRune(char)
			backslashes = 0
		default:
			if backslashes > 0 {
				builder.WriteString(strings.Repeat("\\", backslashes))
				backslashes = 0
			}
			builder.WriteRune(char)
		}
	}
	if backslashes > 0 {
		builder.WriteString(strings.Repeat("\\", backslashes*2))
	}
	builder.WriteByte('"')
	return builder.String()
}

func windowsTerminalPath() (string, bool) {
	candidates := make([]string, 0, 4)

	for _, root := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramW6432")} {
		if root == "" {
			continue
		}
		matches, _ := filepath.Glob(filepath.Join(root, "WindowsApps", "Microsoft.WindowsTerminal_*", "wt.exe"))
		sort.Strings(matches)
		for i := len(matches) - 1; i >= 0; i-- {
			candidates = append(candidates, matches[i])
		}
	}
	if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
		candidates = append(candidates, filepath.Join(localAppData, "Microsoft", "WindowsApps", "wt.exe"))
	}

	for _, candidate := range candidates {
		info, err := os.Stat(candidate)
		if err == nil && !info.IsDir() {
			return candidate, true
		}
	}

	path, err := exec.LookPath("wt.exe")
	return path, err == nil
}
