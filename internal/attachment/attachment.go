package attachment

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const DefaultDirectoryName = "codex_attachments"

type SaveRequest struct {
	SessionID          string `json:"sessionId"`
	FileName           string `json:"fileName"`
	MimeType           string `json:"mimeType"`
	DataBase64         string `json:"dataBase64"`
	AttachmentRootPath string `json:"attachmentRootPath"`
}

type FileInfo struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Path     string `json:"path"`
	MimeType string `json:"mimeType"`
	Size     int64  `json:"size"`
}

type Service struct {
	exeDir string
	now    func() time.Time
}

func NewService(exeDir string) *Service {
	return &Service{
		exeDir: filepath.Clean(exeDir),
		now:    time.Now,
	}
}

func (s *Service) Save(request SaveRequest) (FileInfo, error) {
	mimeType, payload, err := parsePayload(request.MimeType, request.DataBase64)
	if err != nil {
		return FileInfo{}, err
	}
	if !strings.HasPrefix(mimeType, "image/") {
		return FileInfo{}, fmt.Errorf("仅支持图片附件：%s", mimeType)
	}

	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return FileInfo{}, fmt.Errorf("图片数据不是有效 base64：%w", err)
	}
	if len(data) == 0 {
		return FileInfo{}, errors.New("图片数据为空")
	}

	root := s.resolveAttachmentRoot(request.AttachmentRootPath)
	sessionDir := sanitizePathPart(request.SessionID)
	if sessionDir == "" {
		sessionDir = "terminal"
	}
	targetDir := filepath.Join(root, s.now().Format("20060102"), sessionDir)
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return FileInfo{}, fmt.Errorf("创建附件目录失败：%w", err)
	}

	extension := extensionFor(mimeType, request.FileName)
	nameBase := strings.TrimSuffix(sanitizePathPart(request.FileName), filepath.Ext(request.FileName))
	if nameBase == "" {
		nameBase = "image"
	}
	name := fmt.Sprintf("%s-%s%s", nameBase, s.now().Format("150405.000"), extension)
	path := filepath.Join(targetDir, name)
	if err := os.WriteFile(path, data, 0644); err != nil {
		return FileInfo{}, fmt.Errorf("保存图片附件失败：%w", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		return FileInfo{}, err
	}
	return FileInfo{
		ID:       strings.TrimSuffix(name, extension),
		Name:     name,
		Path:     path,
		MimeType: mimeType,
		Size:     info.Size(),
	}, nil
}

func (s *Service) Open(pathValue string) error {
	path := filepath.Clean(strings.TrimSpace(pathValue))
	if path == "" {
		return errors.New("附件路径为空")
	}
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("附件不存在：%s: %w", path, err)
	}
	if info.IsDir() {
		return fmt.Errorf("附件路径不是文件：%s", path)
	}
	return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", path).Start()
}

func (s *Service) resolveAttachmentRoot(input string) string {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		trimmed = DefaultDirectoryName
	}
	if filepath.IsAbs(trimmed) {
		return filepath.Clean(trimmed)
	}
	return filepath.Clean(filepath.Join(s.exeDir, trimmed))
}

func parsePayload(mimeType string, data string) (string, string, error) {
	trimmed := strings.TrimSpace(data)
	if trimmed == "" {
		return "", "", errors.New("图片数据为空")
	}
	if strings.HasPrefix(trimmed, "data:") {
		header, payload, ok := strings.Cut(trimmed, ",")
		if !ok {
			return "", "", errors.New("Data URL 缺少图片数据")
		}
		if !strings.Contains(header, ";base64") {
			return "", "", errors.New("Data URL 必须是 base64 图片")
		}
		fromHeader := strings.TrimPrefix(strings.TrimSuffix(header, ";base64"), "data:")
		if strings.TrimSpace(mimeType) == "" {
			mimeType = fromHeader
		}
		trimmed = payload
	}
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	if mimeType == "" {
		return "", "", errors.New("图片 MIME 类型为空")
	}
	return mimeType, trimmed, nil
}

func extensionFor(mimeType string, fileName string) string {
	ext := strings.ToLower(filepath.Ext(fileName))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp":
		if ext == ".jpeg" {
			return ".jpg"
		}
		return ext
	}
	switch mimeType {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/bmp":
		return ".bmp"
	default:
		return ".png"
	}
}

var unsafePathChars = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func sanitizePathPart(value string) string {
	trimmed := strings.TrimSpace(value)
	trimmed = strings.TrimSuffix(trimmed, filepath.Ext(trimmed))
	trimmed = unsafePathChars.ReplaceAllString(trimmed, "-")
	return strings.Trim(trimmed, ".-_")
}
