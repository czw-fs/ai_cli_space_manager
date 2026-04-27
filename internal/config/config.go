package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const ConfigFileName = "config.json"

type Group struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Directory struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Path      string   `json:"path"`
	GroupID   string   `json:"groupId"`
	OpenerIDs []string `json:"openerIds,omitempty"`
}

type CustomOpener struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	CommandTemplate string `json:"commandTemplate"`
}

type UISettings struct {
	ColumnWidths         ColumnWidths `json:"columnWidths"`
	PowerShellLaunchMode string       `json:"powerShellLaunchMode"`
	EnterKeyMode         string       `json:"enterKeyMode"`
	AttachmentRootPath   string       `json:"attachmentRootPath"`
	SidebarWidth         int          `json:"sidebarWidth"`
	ComposerHeight       int          `json:"composerHeight"`
}

type ColumnWidths struct {
	Search  int `json:"search"`
	Name    int `json:"name"`
	Group   int `json:"group"`
	Path    int `json:"path"`
	Actions int `json:"actions"`
	Manage  int `json:"manage"`
}

type ConfigStatus struct {
	ConfigExists  bool   `json:"configExists"`
	ConfigPath    string `json:"configPath"`
	ConfigError   string `json:"configError"`
	UsingDefaults bool   `json:"usingDefaults"`
}

type AppState struct {
	Groups        []Group        `json:"groups"`
	Directories   []Directory    `json:"directories"`
	CustomOpeners []CustomOpener `json:"customOpeners"`
	UI            UISettings     `json:"ui"`
	Config        ConfigStatus   `json:"config"`
}

type persistedState struct {
	Groups        []Group        `json:"groups"`
	Directories   []Directory    `json:"directories"`
	CustomOpeners []CustomOpener `json:"customOpeners"`
	UI            UISettings     `json:"ui"`
}

type Store struct {
	exeDir     string
	configPath string
}

func NewStore(exeDir string) *Store {
	cleanDir := filepath.Clean(exeDir)
	return &Store{
		exeDir:     cleanDir,
		configPath: filepath.Join(cleanDir, ConfigFileName),
	}
}

func DefaultState(exeDir string) AppState {
	configPath := filepath.Join(filepath.Clean(exeDir), ConfigFileName)
	return AppState{
		Groups:      []Group{},
		Directories: []Directory{},
		CustomOpeners: []CustomOpener{
			{
				ID:              "idea",
				Name:            "IDEA",
				CommandTemplate: "\"C:\\dev\\app\\IntelliJ IDEA 2025.2.4\\bin\\idea64.exe\"",
			},
		},
		UI: defaultUISettings(),
		Config: ConfigStatus{
			ConfigPath:    configPath,
			UsingDefaults: true,
		},
	}
}

func (s *Store) Load() (AppState, error) {
	state := DefaultState(s.exeDir)
	state.Config.ConfigPath = s.configPath

	data, err := os.ReadFile(s.configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return state, nil
		}
		state.Config.ConfigError = err.Error()
		return state, err
	}

	var persisted persistedState
	if err := json.Unmarshal(data, &persisted); err != nil {
		state.Config.ConfigExists = true
		state.Config.ConfigError = err.Error()
		return state, err
	}

	state.Groups = nonNilGroups(persisted.Groups)
	state.Directories = nonNilDirectories(persisted.Directories)
	state.CustomOpeners = dedupeOpeners(nonNilOpeners(persisted.CustomOpeners))
	state.UI = normalizeUISettings(persisted.UI)
	state.Config = ConfigStatus{
		ConfigExists: true,
		ConfigPath:   s.configPath,
	}
	return state, nil
}

func (s *Store) Save(state AppState) error {
	persisted := persistedState{
		Groups:        nonNilGroups(state.Groups),
		Directories:   nonNilDirectories(state.Directories),
		CustomOpeners: dedupeOpeners(nonNilOpeners(state.CustomOpeners)),
		UI:            normalizeUISettings(state.UI),
	}
	data, err := json.MarshalIndent(persisted, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.configPath, data, 0644)
}

func (s *Store) ResolvePath(input string) string {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return s.exeDir
	}
	if filepath.IsAbs(trimmed) {
		return filepath.Clean(trimmed)
	}
	return filepath.Clean(filepath.Join(s.exeDir, trimmed))
}

func (s *Store) ValidatePath(input string) bool {
	info, err := os.Stat(s.ResolvePath(input))
	return err == nil && info.IsDir()
}

func nonNilGroups(items []Group) []Group {
	if items == nil {
		return []Group{}
	}
	return items
}

func nonNilDirectories(items []Directory) []Directory {
	if items == nil {
		return []Directory{}
	}
	return items
}

func nonNilOpeners(items []CustomOpener) []CustomOpener {
	if items == nil {
		return []CustomOpener{}
	}
	return items
}

func dedupeOpeners(items []CustomOpener) []CustomOpener {
	seen := make(map[string]bool, len(items))
	result := make([]CustomOpener, 0, len(items))
	for _, item := range items {
		key := strings.ToLower(strings.TrimSpace(item.Name)) + "\x00" + strings.ToLower(strings.TrimSpace(item.CommandTemplate))
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, item)
	}
	return result
}

func defaultUISettings() UISettings {
	return UISettings{
		PowerShellLaunchMode: "tab",
		EnterKeyMode:         "send",
		AttachmentRootPath:   "codex_attachments",
		SidebarWidth:         176,
		ComposerHeight:       66,
		ColumnWidths: ColumnWidths{
			Search:  180,
			Name:    120,
			Group:   90,
			Path:    260,
			Actions: 520,
			Manage:  110,
		},
	}
}

func normalizeUISettings(settings UISettings) UISettings {
	defaults := defaultUISettings()
	if settings.PowerShellLaunchMode != "tab" && settings.PowerShellLaunchMode != "window" {
		settings.PowerShellLaunchMode = defaults.PowerShellLaunchMode
	}
	if settings.EnterKeyMode != "send" && settings.EnterKeyMode != "newline" {
		settings.EnterKeyMode = defaults.EnterKeyMode
	}
	if strings.TrimSpace(settings.AttachmentRootPath) == "" {
		settings.AttachmentRootPath = defaults.AttachmentRootPath
	}
	settings.SidebarWidth = clampColumnWidth(settings.SidebarWidth, defaults.SidebarWidth, 128, 320)
	settings.ComposerHeight = clampColumnWidth(settings.ComposerHeight, defaults.ComposerHeight, 48, 180)
	settings.ColumnWidths.Search = clampColumnWidth(settings.ColumnWidths.Search, defaults.ColumnWidths.Search, 96, 420)
	settings.ColumnWidths.Name = clampColumnWidth(settings.ColumnWidths.Name, defaults.ColumnWidths.Name, 72, 360)
	settings.ColumnWidths.Group = clampColumnWidth(settings.ColumnWidths.Group, defaults.ColumnWidths.Group, 72, 260)
	settings.ColumnWidths.Path = clampColumnWidth(settings.ColumnWidths.Path, defaults.ColumnWidths.Path, 140, 640)
	settings.ColumnWidths.Actions = clampColumnWidth(settings.ColumnWidths.Actions, defaults.ColumnWidths.Actions, 500, 760)
	settings.ColumnWidths.Manage = clampColumnWidth(settings.ColumnWidths.Manage, defaults.ColumnWidths.Manage, 86, 220)
	return settings
}

func clampColumnWidth(value int, fallback int, min int, max int) int {
	if value == 0 {
		value = fallback
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}
