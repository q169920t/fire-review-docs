// 消防審勘文件管理 — exe 外殼
//
// 外殼只負責三件事：
//  1. 開一個視窗顯示主程式畫面（app.html）
//  2. 在本機提供「檔案讀寫、選資料夾」服務，讓畫面不用每次請使用者授權資料夾
//  3. 檢查 GitHub Release 是否有新版，下載並套用
//
// 本機服務只聽 127.0.0.1，且每次啟動產生一組隨機通行碼，只有本程式自己的畫面拿得到。
package main

import (
	"bytes"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ShellVersion 是 exe 外殼本身的版本；只有外殼程式碼改變時才需要調升。
const ShellVersion = "1.0"

const (
	appDirName    = "審勘文件管理"
	repo          = "q169920t/fire-review-docs"
	preferredPort = 47321
	defaultRoot   = `G:\我的雲端硬碟\##歌珊\審勘文件系統`
	exeAsset      = "FireReviewDocs.exe"
	htmlAsset     = "app.html"
	latestAsset   = "latest.json"
)

//go:embed app.html
var embeddedHTML []byte

var verRe = regexp.MustCompile(`APP_VERSION\s*=\s*'([0-9.]+)'`)

// versionOf 從主程式 HTML 取出版本號（const APP_VERSION = 'x.y'）。
func versionOf(html []byte) string {
	m := verRe.FindSubmatch(html)
	if m == nil {
		return ""
	}
	return string(m[1])
}

// cmpVer 比較版本號，a>b 回傳 1，a<b 回傳 -1，相同回傳 0。
func cmpVer(a, b string) int {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(pb[i])
		}
		if x != y {
			if x > y {
				return 1
			}
			return -1
		}
	}
	return 0
}

type Config struct {
	Root     string            `json:"root"`
	LastDirs map[string]string `json:"lastDirs"`
}

type Latest struct {
	App   string `json:"app"`
	Shell string `json:"shell"`
	Notes string `json:"notes"`
}

type Server struct {
	token       string
	port        int
	exePath     string
	cfgPath     string
	cacheDir    string
	updateBase  string
	ui          UI
	mu          sync.Mutex
	cfg         Config
	html        []byte
	client      *http.Client
	updateMutex sync.Mutex
}

// UI 是各作業系統的視窗功能（Windows 版見 ui_windows.go）。
type UI interface {
	PickDir(title, start string) (string, error)
	Open(path string) error
	Restart() error
	Alert(title, msg string)
	CanSelfUpdate() bool
}

func (s *Server) cachedHTMLPath() string { return filepath.Join(s.cacheDir, htmlAsset) }

// loadHTML 選擇要顯示的主程式：已下載的新版若不比內建舊，就用下載的。
func (s *Server) loadHTML() {
	s.html = embeddedHTML
	if b, err := os.ReadFile(s.cachedHTMLPath()); err == nil {
		if v := versionOf(b); v != "" && cmpVer(v, versionOf(embeddedHTML)) >= 0 {
			s.html = b
		}
	}
}

func (s *Server) loadConfig() {
	b, err := os.ReadFile(s.cfgPath)
	if err == nil {
		_ = json.Unmarshal(b, &s.cfg)
	}
	if s.cfg.LastDirs == nil {
		s.cfg.LastDirs = map[string]string{}
	}
}

func (s *Server) saveConfig() error {
	b, _ := json.MarshalIndent(s.cfg, "", "  ")
	if err := os.MkdirAll(filepath.Dir(s.cfgPath), 0o755); err != nil {
		return err
	}
	return writeAtomic(s.cfgPath, bytes.NewReader(b))
}

// writeAtomic 先寫暫存檔再改名，避免寫到一半斷掉留下壞檔。
func writeAtomic(path string, r io.Reader) error {
	dir, name := filepath.Split(path)
	tmp, err := os.CreateTemp(dir, "~$"+name+".*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	_, err = io.Copy(tmp, r)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmpName, path)
	}
	if err != nil {
		os.Remove(tmpName)
		if errors.Is(err, os.ErrPermission) {
			return fmt.Errorf("無法寫入「%s」，檔案可能正被 Word 或其他程式開著", filepath.Base(path))
		}
	}
	return err
}

/* ---------- HTTP ---------- */

func jsonOut(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

func errOut(w http.ResponseWriter, code int, err error) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(code)
	_, _ = io.WriteString(w, err.Error())
}

func fsErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, os.ErrNotExist):
		errOut(w, http.StatusNotFound, errors.New("找不到檔案或資料夾"))
	case errors.Is(err, os.ErrPermission):
		errOut(w, http.StatusForbidden, errors.New("沒有權限存取"))
	default:
		errOut(w, http.StatusInternalServerError, err)
	}
}

func qpath(r *http.Request) (string, error) {
	p := r.URL.Query().Get("path")
	if p == "" || !filepath.IsAbs(p) {
		return "", errors.New("路徑不正確")
	}
	return filepath.Clean(p), nil
}

type entry struct {
	Name  string `json:"name"`
	Dir   bool   `json:"dir"`
	Size  int64  `json:"size"`
	Mtime int64  `json:"mtime"`
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		html := s.html
		s.mu.Unlock()
		inject := fmt.Sprintf(`<script>window.__NATIVE__=%s;</script>`, mustJSON(map[string]string{"token": s.token, "shell": ShellVersion}))
		out := bytes.Replace(html, []byte("<head>"), []byte("<head>\n"+inject), 1)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(out)
	})

	// ping 不需要通行碼，只用來判斷程式是否已經開著
	mux.HandleFunc("GET /api/ping", func(w http.ResponseWriter, r *http.Request) {
		jsonOut(w, map[string]string{"app": "fire-review-docs"})
	})

	mux.HandleFunc("GET /api/info", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		jsonOut(w, map[string]any{
			"shell": ShellVersion, "app": versionOf(s.html), "exeDir": filepath.Dir(s.exePath),
			"root": s.cfg.Root, "lastDirs": s.cfg.LastDirs, "defaultRoot": defaultRoot, "sep": string(filepath.Separator),
		})
	})

	mux.HandleFunc("POST /api/config", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Root    *string           `json:"root"`
			LastDir map[string]string `json:"lastDir"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			errOut(w, 400, err)
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		if in.Root != nil {
			s.cfg.Root = *in.Root
		}
		for k, v := range in.LastDir {
			s.cfg.LastDirs[k] = v
		}
		if err := s.saveConfig(); err != nil {
			errOut(w, 500, err)
			return
		}
		jsonOut(w, map[string]bool{"ok": true})
	})

	mux.HandleFunc("GET /api/stat", func(w http.ResponseWriter, r *http.Request) {
		p, err := qpath(r)
		if err != nil {
			errOut(w, 400, err)
			return
		}
		fi, err := os.Stat(p)
		if err != nil {
			jsonOut(w, map[string]any{"exists": false})
			return
		}
		jsonOut(w, map[string]any{"exists": true, "dir": fi.IsDir(), "size": fi.Size(), "mtime": fi.ModTime().UnixMilli()})
	})

	mux.HandleFunc("GET /api/list", func(w http.ResponseWriter, r *http.Request) {
		p, err := qpath(r)
		if err != nil {
			errOut(w, 400, err)
			return
		}
		des, err := os.ReadDir(p)
		if err != nil {
			fsErr(w, err)
			return
		}
		out := []entry{}
		for _, de := range des {
			fi, err := de.Info()
			if err != nil {
				continue
			}
			out = append(out, entry{de.Name(), de.IsDir(), fi.Size(), fi.ModTime().UnixMilli()})
		}
		jsonOut(w, out)
	})

	mux.HandleFunc("GET /api/read", func(w http.ResponseWriter, r *http.Request) {
		p, err := qpath(r)
		if err != nil {
			errOut(w, 400, err)
			return
		}
		f, err := os.Open(p)
		if err != nil {
			fsErr(w, err)
			return
		}
		defer f.Close()
		fi, err := f.Stat()
		if err != nil || fi.IsDir() {
			errOut(w, 400, errors.New("不是檔案"))
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Mtime", strconv.FormatInt(fi.ModTime().UnixMilli(), 10))
		w.Header().Set("Content-Length", strconv.FormatInt(fi.Size(), 10))
		_, _ = io.Copy(w, f)
	})

	mux.HandleFunc("PUT /api/write", func(w http.ResponseWriter, r *http.Request) {
		p, err := qpath(r)
		if err != nil {
			errOut(w, 400, err)
			return
		}
		if err := writeAtomic(p, r.Body); err != nil {
			fsErr(w, err)
			return
		}
		fi, _ := os.Stat(p)
		jsonOut(w, map[string]any{"ok": true, "mtime": fi.ModTime().UnixMilli()})
	})

	mux.HandleFunc("POST /api/mkdir", func(w http.ResponseWriter, r *http.Request) {
		p, err := qpath(r)
		if err != nil {
			errOut(w, 400, err)
			return
		}
		if err := os.MkdirAll(p, 0o755); err != nil {
			fsErr(w, err)
			return
		}
		jsonOut(w, map[string]bool{"ok": true})
	})

	mux.HandleFunc("POST /api/remove", func(w http.ResponseWriter, r *http.Request) {
		p, err := qpath(r)
		if err != nil {
			errOut(w, 400, err)
			return
		}
		if fi, err := os.Stat(p); err == nil && fi.IsDir() {
			errOut(w, 400, errors.New("不能刪除資料夾"))
			return
		}
		if err := os.Remove(p); err != nil {
			fsErr(w, err)
			return
		}
		jsonOut(w, map[string]bool{"ok": true})
	})

	mux.HandleFunc("POST /api/pickdir", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Title, Start string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		p, err := s.ui.PickDir(in.Title, in.Start)
		if err != nil {
			errOut(w, 500, err)
			return
		}
		jsonOut(w, map[string]string{"path": p})
	})

	mux.HandleFunc("POST /api/open", func(w http.ResponseWriter, r *http.Request) {
		p, err := qpath(r)
		if err != nil {
			errOut(w, 400, err)
			return
		}
		if err := s.ui.Open(p); err != nil {
			errOut(w, 500, err)
			return
		}
		jsonOut(w, map[string]bool{"ok": true})
	})

	mux.HandleFunc("GET /api/update/check", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		cur := versionOf(s.html)
		s.mu.Unlock()
		res := map[string]any{"current": cur, "shell": ShellVersion, "hasUpdate": false}
		lt, err := s.fetchLatest()
		if err != nil {
			res["error"] = err.Error()
			jsonOut(w, res)
			return
		}
		res["latest"], res["latestShell"], res["notes"] = lt.App, lt.Shell, lt.Notes
		res["hasUpdate"] = cmpVer(lt.App, cur) > 0 || (s.ui.CanSelfUpdate() && cmpVer(lt.Shell, ShellVersion) > 0)
		jsonOut(w, res)
	})

	mux.HandleFunc("POST /api/update/apply", func(w http.ResponseWriter, r *http.Request) {
		restart, err := s.applyUpdate()
		if err != nil {
			errOut(w, 500, err)
			return
		}
		jsonOut(w, map[string]bool{"ok": true, "restart": restart})
	})

	mux.HandleFunc("POST /api/restart", func(w http.ResponseWriter, r *http.Request) {
		jsonOut(w, map[string]bool{"ok": true})
		go func() { time.Sleep(200 * time.Millisecond); _ = s.ui.Restart() }()
	})

	return s.guard(mux)
}

// guard 擋掉不是從本程式畫面來的請求。
func (s *Server) guard(next http.Handler) http.Handler {
	okHost := map[string]bool{fmt.Sprintf("127.0.0.1:%d", s.port): true, fmt.Sprintf("localhost:%d", s.port): true}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !okHost[r.Host] {
			errOut(w, http.StatusForbidden, errors.New("forbidden"))
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/ping" && r.Header.Get("X-App-Token") != s.token {
			errOut(w, http.StatusForbidden, errors.New("forbidden"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

/* ---------- 更新 ---------- */

func (s *Server) download(name string) ([]byte, error) {
	resp, err := s.client.Get(s.updateBase + name)
	if err != nil {
		return nil, fmt.Errorf("無法連線到更新伺服器：%w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("下載 %s 失敗（HTTP %d）", name, resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 200<<20))
}

func (s *Server) fetchLatest() (*Latest, error) {
	b, err := s.download(latestAsset)
	if err != nil {
		return nil, err
	}
	var lt Latest
	if err := json.Unmarshal(b, &lt); err != nil || lt.App == "" {
		return nil, errors.New("更新資訊格式不正確")
	}
	return &lt, nil
}

// applyUpdate 下載新版。回傳 true 代表 exe 本身也換了，需要重新啟動。
func (s *Server) applyUpdate() (bool, error) {
	s.updateMutex.Lock()
	defer s.updateMutex.Unlock()
	lt, err := s.fetchLatest()
	if err != nil {
		return false, err
	}
	html, err := s.download(htmlAsset)
	if err != nil {
		return false, err
	}
	if v := versionOf(html); v != lt.App {
		return false, fmt.Errorf("下載的主程式版本（%s）和更新資訊（%s）不一致，請稍後再試", v, lt.App)
	}
	if err := os.MkdirAll(s.cacheDir, 0o755); err != nil {
		return false, err
	}
	if err := writeAtomic(s.cachedHTMLPath(), bytes.NewReader(html)); err != nil {
		return false, err
	}
	s.mu.Lock()
	s.html = html
	s.mu.Unlock()

	if !s.ui.CanSelfUpdate() || cmpVer(lt.Shell, ShellVersion) <= 0 {
		return false, nil
	}
	exe, err := s.download(exeAsset)
	if err != nil {
		return false, err
	}
	if len(exe) < 1<<20 || !bytes.HasPrefix(exe, []byte("MZ")) {
		return false, errors.New("下載的程式檔不完整，請稍後再試")
	}
	newPath, oldPath := s.exePath+".new", s.exePath+".old"
	if err := os.WriteFile(newPath, exe, 0o755); err != nil {
		return false, fmt.Errorf("無法寫入新版程式：%w", err)
	}
	os.Remove(oldPath)
	// Windows 允許把執行中的 exe 改名，但不能覆蓋，所以先把自己改名成 .old
	if err := os.Rename(s.exePath, oldPath); err != nil {
		os.Remove(newPath)
		return false, fmt.Errorf("無法替換程式檔：%w", err)
	}
	if err := os.Rename(newPath, s.exePath); err != nil {
		_ = os.Rename(oldPath, s.exePath)
		return false, fmt.Errorf("無法替換程式檔：%w", err)
	}
	return true, nil
}

/* ---------- 啟動 ---------- */

func randomToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func isOurApp(port int) bool {
	c := http.Client{Timeout: 2 * time.Second}
	resp, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/api/ping", port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var v map[string]string
	return json.NewDecoder(resp.Body).Decode(&v) == nil && v["app"] == "fire-review-docs"
}

func main() {
	restarted := flag.Bool("restarted", false, "更新後重新啟動")
	flag.Parse()

	exePath, err := os.Executable()
	if err != nil {
		log.Fatal(err)
	}
	exePath, _ = filepath.EvalSymlinks(exePath)
	// 清掉上次更新留下的舊程式檔（舊程式可能還沒完全結束，稍後再試一次）
	go func() {
		for i := 0; i < 10; i++ {
			if err := os.Remove(exePath + ".old"); err == nil || errors.Is(err, os.ErrNotExist) {
				return
			}
			time.Sleep(time.Second)
		}
	}()

	cfgBase, _ := os.UserConfigDir()
	cacheBase, _ := os.UserCacheDir()
	s := &Server{
		token:      randomToken(),
		exePath:    exePath,
		cfgPath:    filepath.Join(cfgBase, appDirName, "config.json"),
		cacheDir:   filepath.Join(cacheBase, appDirName),
		updateBase: "https://github.com/" + repo + "/releases/latest/download/",
		client:     &http.Client{Timeout: 120 * time.Second},
	}
	if v := os.Getenv("FIRE_UPDATE_BASE"); v != "" { // 測試用
		s.updateBase = v
	}
	if v := os.Getenv("FIRE_HOME"); v != "" { // 測試用
		s.cfgPath = filepath.Join(v, "config.json")
		s.cacheDir = filepath.Join(v, "cache")
	}
	s.ui = newUI(s)
	s.loadConfig()
	s.loadHTML()

	port := preferredPort
	if v, err := strconv.Atoi(os.Getenv("FIRE_PORT")); err == nil {
		port = v
	}
	var ln net.Listener
	for i := 0; ; i++ {
		ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil || !*restarted || i >= 40 {
			break
		}
		time.Sleep(250 * time.Millisecond) // 等舊程式結束、讓出通訊埠
	}
	if err != nil {
		if isOurApp(port) {
			s.ui.Alert("消防審勘文件管理", "程式已經開著了，請到工作列切換到已開啟的視窗。")
			return
		}
		// 固定通訊埠被其他程式占用，改用隨機埠（草稿與使用者名稱會另外記一份）
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			s.ui.Alert("消防審勘文件管理", "無法啟動：" + err.Error())
			return
		}
	}
	s.port = ln.Addr().(*net.TCPAddr).Port
	go func() { _ = http.Serve(ln, s.routes()) }()

	runUI(s, fmt.Sprintf("http://127.0.0.1:%d/", s.port))
}
