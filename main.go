package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "OpenWorkspacePS",
		Width:     1120,
		Height:    720,
		MinWidth:  760,
		MinHeight: 560,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 248, G: 250, B: 252, A: 1},
		Windows: &windows.Options{
			Theme: windows.Dark,
			CustomTheme: &windows.ThemeSettings{
				DarkModeTitleBar:           windows.RGB(7, 11, 19),
				DarkModeTitleBarInactive:   windows.RGB(11, 17, 29),
				DarkModeTitleText:          windows.RGB(220, 230, 243),
				DarkModeTitleTextInactive:  windows.RGB(143, 164, 194),
				DarkModeBorder:             windows.RGB(38, 52, 73),
				DarkModeBorderInactive:     windows.RGB(38, 52, 73),
				LightModeTitleBar:          windows.RGB(248, 250, 252),
				LightModeTitleBarInactive:  windows.RGB(241, 245, 249),
				LightModeTitleText:         windows.RGB(23, 32, 51),
				LightModeTitleTextInactive: windows.RGB(71, 85, 105),
				LightModeBorder:            windows.RGB(216, 226, 239),
				LightModeBorderInactive:    windows.RGB(216, 226, 239),
			},
		},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
