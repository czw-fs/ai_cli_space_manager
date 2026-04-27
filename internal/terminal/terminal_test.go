package terminal

import "testing"

func TestRenameUpdatesSessionTitle(t *testing.T) {
	service := NewService("")
	service.sessions["terminal-1"] = &session{
		info: SessionInfo{ID: "terminal-1", Title: "old", Running: true},
	}

	info, err := service.Rename("terminal-1", "  新名称  ")
	if err != nil {
		t.Fatalf("Rename returned error: %v", err)
	}
	if info.Title != "新名称" {
		t.Fatalf("returned title = %q, want 新名称", info.Title)
	}
	if service.sessions["terminal-1"].info.Title != "新名称" {
		t.Fatalf("stored title = %q, want 新名称", service.sessions["terminal-1"].info.Title)
	}
}

func TestRenameRejectsBlankTitle(t *testing.T) {
	service := NewService("")
	service.sessions["terminal-1"] = &session{
		info: SessionInfo{ID: "terminal-1", Title: "old", Running: true},
	}

	if _, err := service.Rename("terminal-1", "   "); err == nil {
		t.Fatal("Rename error = nil, want error")
	}
	if service.sessions["terminal-1"].info.Title != "old" {
		t.Fatalf("stored title changed to %q", service.sessions["terminal-1"].info.Title)
	}
}
