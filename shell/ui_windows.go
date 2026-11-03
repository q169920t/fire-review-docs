//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"

	webview2 "github.com/jchv/go-webview2"
	"github.com/ncruces/zenity"
)

const appTitle = "消防審勘文件管理"

type winUI struct {
	s    *Server
	w    webview2.WebView
	hwnd uintptr
}

func newUI(s *Server) UI { return &winUI{s: s} }

func (u *winUI) opts(title string) []zenity.Option {
	o := []zenity.Option{zenity.Title(title)}
	if u.hwnd != 0 {
		o = append(o, zenity.Attach(u.hwnd))
	}
	return o
}

func (u *winUI) PickDir(title, start string) (string, error) {
	if title == "" {
		title = "選擇資料夾"
	}
	o := append(u.opts(title), zenity.Directory())
	if start != "" {
		if fi, err := os.Stat(start); err == nil && fi.IsDir() {
			o = append(o, zenity.Filename(filepath.Clean(start)+`\`))
		}
	}
	p, err := zenity.SelectFile(o...)
	if errors.Is(err, zenity.ErrCanceled) {
		return "", nil
	}
	return p, err
}

func (u *winUI) Open(path string) error { return exec.Command("explorer.exe", path).Start() }

func (u *winUI) Alert(title, msg string) { _ = zenity.Info(msg, u.opts(title)...) }

func (u *winUI) CanSelfUpdate() bool { return true }

func (u *winUI) Restart() error {
	if err := exec.Command(u.s.exePath, "--restarted").Start(); err != nil {
		return err
	}
	if u.w != nil {
		u.w.Dispatch(u.w.Terminate)
	} else {
		os.Exit(0)
	}
	return nil
}

// 讓高解析度螢幕（縮放 125%、150%）上的字不會模糊
func setDPIAware() {
	user32 := syscall.NewLazyDLL("user32.dll")
	if p := user32.NewProc("SetProcessDpiAwarenessContext"); p.Find() == nil {
		const perMonitorV2 = ^uintptr(3) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
		if r, _, _ := p.Call(perMonitorV2); r != 0 {
			return
		}
	}
	if p := user32.NewProc("SetProcessDPIAware"); p.Find() == nil {
		_, _, _ = p.Call()
	}
}

func runUI(s *Server, url string) {
	u := s.ui.(*winUI)
	setDPIAware()
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     os.Getenv("FIRE_DEBUG") != "",
		AutoFocus: true,
		DataPath:  filepath.Join(s.cacheDir, "webview"),
		WindowOptions: webview2.WindowOptions{
			Title:  appTitle,
			Width:  1440,
			Height: 920,
			Center: true,
		},
	})
	if w == nil {
		_ = zenity.Error("這台電腦缺少 Microsoft Edge WebView2 執行元件，程式無法開啟。\n\n按「確定」後會開啟下載網頁，請下載「常青版本」安裝後再開啟本程式。",
			zenity.Title(appTitle))
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", "https://developer.microsoft.com/microsoft-edge/webview2/").Start()
		return
	}
	u.w = w
	u.hwnd = uintptr(w.Window())
	defer w.Destroy()
	w.Navigate(url)
	w.Run()
}
