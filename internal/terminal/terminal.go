package terminal

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"

	pty "github.com/aymanbagabas/go-pty"
)

type EventSink func(eventName string, data any)

type SessionInfo struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Directory string `json:"directory"`
	Running   bool   `json:"running"`
	CreatedAt int64  `json:"createdAt"`
}

type OutputEvent struct {
	SessionID string `json:"sessionId"`
	Data      string `json:"data"`
	Stream    string `json:"stream"`
}

type Service struct {
	mu       sync.Mutex
	pwshPath string
	sink     EventSink
	nextID   int
	sessions map[string]*session
}

type session struct {
	info   SessionInfo
	pty    pty.Pty
	cmd    *pty.Cmd
	cancel context.CancelFunc
	done   chan struct{}
	life   processLifetime
}

type processLifetime interface {
	Close() error
}

func NewService(pwshPath string) *Service {
	return &Service{
		pwshPath: pwshPath,
		sessions: make(map[string]*session),
	}
}

func (s *Service) SetEventSink(sink EventSink) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sink = sink
}

func (s *Service) Sessions() []SessionInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := make([]SessionInfo, 0, len(s.sessions))
	for _, item := range s.sessions {
		items = append(items, item.info)
	}
	return items
}

func (s *Service) Start(dir string, title string) (SessionInfo, error) {
	if err := requireDirectory(dir); err != nil {
		return SessionInfo{}, err
	}
	if _, err := os.Stat(s.pwshPath); err != nil {
		return SessionInfo{}, fmt.Errorf("PowerShell 7 路径不可用：%s: %w", s.pwshPath, err)
	}

	terminal, err := pty.New()
	if err != nil {
		return SessionInfo{}, fmt.Errorf("创建内嵌终端失败：%w", err)
	}
	if err := terminal.Resize(120, 34); err != nil {
		_ = terminal.Close()
		return SessionInfo{}, fmt.Errorf("设置终端尺寸失败：%w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cmd := terminal.CommandContext(ctx, s.pwshPath, "-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass")
	configureEmbeddedCommand(cmd)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "WT_SESSION=OpenWorkspacePS")

	s.mu.Lock()
	s.nextID++
	id := fmt.Sprintf("terminal-%d", s.nextID)
	if strings.TrimSpace(title) == "" {
		title = dir
	}
	info := SessionInfo{
		ID:        id,
		Title:     title,
		Directory: dir,
		Running:   true,
		CreatedAt: time.Now().UnixMilli(),
	}
	item := &session{info: info, pty: terminal, cmd: cmd, cancel: cancel, done: make(chan struct{})}
	s.sessions[id] = item
	s.mu.Unlock()

	if err := cmd.Start(); err != nil {
		cancel()
		_ = terminal.Close()
		s.mu.Lock()
		delete(s.sessions, id)
		s.mu.Unlock()
		return SessionInfo{}, fmt.Errorf("启动 PowerShell 7 失败：%w", err)
	}
	item.life, _ = attachProcessLifetime(cmd)

	go s.pipeOutput(id, terminal)
	go s.wait(id, cmd, terminal)
	return info, nil
}

func (s *Service) Write(sessionID string, input string) error {
	item, err := s.get(sessionID)
	if err != nil {
		return err
	}
	_, err = io.WriteString(item.pty, input)
	return err
}

func (s *Service) Resize(sessionID string, cols int, rows int) error {
	item, err := s.get(sessionID)
	if err != nil {
		return err
	}
	if cols < 20 {
		cols = 20
	}
	if rows < 5 {
		rows = 5
	}
	return item.pty.Resize(cols, rows)
}

func (s *Service) Rename(sessionID string, title string) (SessionInfo, error) {
	nextTitle := strings.TrimSpace(title)
	if nextTitle == "" {
		return SessionInfo{}, errors.New("终端名称不能为空")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.sessions[sessionID]
	if !ok {
		return SessionInfo{}, errors.New("未找到终端：" + sessionID)
	}
	if !item.info.Running {
		return SessionInfo{}, errors.New("终端已关闭：" + sessionID)
	}
	item.info.Title = nextTitle
	return item.info, nil
}

func (s *Service) Stop(sessionID string) error {
	item, err := s.get(sessionID)
	if err != nil {
		return err
	}
	item.stop()
	return nil
}

func (s *Service) StopAll() {
	s.mu.Lock()
	items := make([]*session, 0, len(s.sessions))
	for _, item := range s.sessions {
		items = append(items, item)
	}
	s.mu.Unlock()
	for _, item := range items {
		item.stop()
	}
}

func (item *session) stop() {
	if item.life != nil {
		_ = item.life.Close()
	} else {
		_ = killProcessTree(item.cmd)
	}
	select {
	case <-item.done:
		return
	case <-time.After(1500 * time.Millisecond):
	}
	item.cancel()
	_ = item.pty.Close()
	select {
	case <-item.done:
	case <-time.After(1500 * time.Millisecond):
	}
}

func (s *Service) get(sessionID string) (*session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.sessions[sessionID]
	if !ok {
		return nil, errors.New("未找到终端：" + sessionID)
	}
	if !item.info.Running {
		return nil, errors.New("终端已关闭：" + sessionID)
	}
	return item, nil
}

func (s *Service) pipeOutput(sessionID string, reader io.Reader) {
	buf := make([]byte, 8192)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			s.emit("terminal:output", OutputEvent{SessionID: sessionID, Data: string(buf[:n]), Stream: "pty"})
		}
		if err != nil {
			return
		}
	}
}

func (s *Service) wait(sessionID string, cmd *pty.Cmd, terminal pty.Pty) {
	err := cmd.Wait()
	_ = terminal.Close()
	s.mu.Lock()
	item, ok := s.sessions[sessionID]
	if ok {
		item.info.Running = false
	}
	s.mu.Unlock()

	if err != nil && !errors.Is(err, context.Canceled) {
		s.emit("terminal:output", OutputEvent{SessionID: sessionID, Data: "\r\n终端已退出：" + err.Error() + "\r\n", Stream: "system"})
	}
	if ok {
		if item.life != nil {
			_ = item.life.Close()
		}
		close(item.done)
		s.emit("terminal:closed", item.info)
	}
}

func (s *Service) emit(eventName string, data any) {
	s.mu.Lock()
	sink := s.sink
	s.mu.Unlock()
	if sink != nil {
		sink(eventName, data)
	}
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
