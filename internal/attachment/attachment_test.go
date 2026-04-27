package attachment

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSaveImageCreatesFileUnderDefaultDirectory(t *testing.T) {
	exeDir := t.TempDir()
	service := NewService(exeDir)
	payload := base64.StdEncoding.EncodeToString([]byte("png-bytes"))

	info, err := service.Save(SaveRequest{
		SessionID:  "terminal-1",
		FileName:   "截图.png",
		MimeType:   "image/png",
		DataBase64: payload,
	})
	if err != nil {
		t.Fatalf("Save returned error: %v", err)
	}

	content, err := os.ReadFile(info.Path)
	if err != nil {
		t.Fatalf("saved file was not created: %v", err)
	}
	if string(content) != "png-bytes" {
		t.Fatalf("saved content = %q, want png-bytes", string(content))
	}
	rel, err := filepath.Rel(exeDir, info.Path)
	if err != nil {
		t.Fatalf("relative path: %v", err)
	}
	wantPrefix := filepath.Join(DefaultDirectoryName, time.Now().Format("20060102"), "terminal-1")
	if !strings.HasPrefix(rel, wantPrefix) {
		t.Fatalf("saved relative path = %q, want prefix %q", rel, wantPrefix)
	}
	if info.MimeType != "image/png" || info.Name == "" || info.Size != int64(len("png-bytes")) {
		t.Fatalf("unexpected info: %#v", info)
	}
}

func TestSaveImageUsesConfiguredRelativeDirectory(t *testing.T) {
	exeDir := t.TempDir()
	service := NewService(exeDir)
	payload := base64.StdEncoding.EncodeToString([]byte("jpg-bytes"))

	info, err := service.Save(SaveRequest{
		SessionID:          "terminal:2",
		FileName:           "pasted",
		MimeType:           "image/jpeg",
		DataBase64:         payload,
		AttachmentRootPath: "my_images",
	})
	if err != nil {
		t.Fatalf("Save returned error: %v", err)
	}

	if !strings.HasPrefix(info.Path, filepath.Join(exeDir, "my_images")) {
		t.Fatalf("saved path = %q, want under configured directory", info.Path)
	}
	if filepath.Ext(info.Path) != ".jpg" {
		t.Fatalf("extension = %q, want .jpg", filepath.Ext(info.Path))
	}
	if strings.Contains(filepath.Base(filepath.Dir(info.Path)), ":") {
		t.Fatalf("session directory was not sanitized: %q", filepath.Dir(info.Path))
	}
}

func TestSaveRejectsNonImageMimeType(t *testing.T) {
	service := NewService(t.TempDir())
	payload := base64.StdEncoding.EncodeToString([]byte("text"))

	_, err := service.Save(SaveRequest{
		SessionID:  "terminal-1",
		FileName:   "note.txt",
		MimeType:   "text/plain",
		DataBase64: payload,
	})
	if err == nil {
		t.Fatalf("Save error = nil, want non-image rejection")
	}
}

func TestSaveAcceptsDataURL(t *testing.T) {
	service := NewService(t.TempDir())
	payload := "data:image/webp;base64," + base64.StdEncoding.EncodeToString([]byte("webp-bytes"))

	info, err := service.Save(SaveRequest{
		SessionID:  "terminal-1",
		FileName:   "clip.webp",
		MimeType:   "",
		DataBase64: payload,
	})
	if err != nil {
		t.Fatalf("Save returned error: %v", err)
	}
	if info.MimeType != "image/webp" || filepath.Ext(info.Path) != ".webp" {
		t.Fatalf("unexpected saved info: %#v", info)
	}
}
