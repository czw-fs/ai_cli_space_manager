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
	ID      string `json:"id"`
	Name    string `json:"name"`
	Path    string `json:"path"`
	GroupID string `json:"groupId"`
}

type CustomOpener struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	CommandTemplate string `json:"commandTemplate"`
}

type UISettings struct {
	ColumnWidths ColumnWidths `json:"columnWidths"`
}

type ColumnWidths struct {
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
				CommandTemplate: "\"C:\\Program Files\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe\" \"{path}\"",
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
	state.CustomOpeners = nonNilOpeners(persisted.CustomOpeners)
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
		CustomOpeners: nonNilOpeners(state.CustomOpeners),
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

func defaultUISettings() UISettings {
	return UISettings{
		ColumnWidths: ColumnWidths{
			Name:    120,
			Group:   90,
			Path:    260,
			Actions: 360,
			Manage:  110,
		},
	}
}

func normalizeUISettings(settings UISettings) UISettings {
	defaults := defaultUISettings()
	settings.ColumnWidths.Name = clampColumnWidth(settings.ColumnWidths.Name, defaults.ColumnWidths.Name, 72, 360)
	settings.ColumnWidths.Group = clampColumnWidth(settings.ColumnWidths.Group, defaults.ColumnWidths.Group, 72, 260)
	settings.ColumnWidths.Path = clampColumnWidth(settings.ColumnWidths.Path, defaults.ColumnWidths.Path, 140, 640)
	settings.ColumnWidths.Actions = clampColumnWidth(settings.ColumnWidths.Actions, defaults.ColumnWidths.Actions, 240, 640)
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
