//go:build !windows

package main

// 非 Windows 版只用於開發測試：不開視窗，只啟動本機服務，用瀏覽器打開網址即可。
// 選資料夾時改讀環境變數 FIRE_PICK（測試程式可攔截 /api/pickdir 取代）。

import (
	"fmt"
	"os"
	"os/signal"
)

type devUI struct{}

func newUI(s *Server) UI { return devUI{} }

func (devUI) PickDir(title, start string) (string, error) { return os.Getenv("FIRE_PICK"), nil }
func (devUI) Open(path string) error                      { fmt.Println("open:", path); return nil }
func (devUI) Restart() error                               { fmt.Println("restart requested"); return nil }
func (devUI) Alert(title, msg string)                      { fmt.Println(title+":", msg) }
func (devUI) CanSelfUpdate() bool                          { return false }

func runUI(s *Server, url string) {
	fmt.Println("serving", url)
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt)
	<-c
}
