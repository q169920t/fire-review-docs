package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCmpVer(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"1.4", "1.3", 1}, {"1.3", "1.4", -1}, {"1.10", "1.9", 1}, {"1.4", "1.4.0", 0}, {"2.0", "1.99", 1}, {"1.4.1", "1.4", 1},
	}
	for _, c := range cases {
		if got := cmpVer(c.a, c.b); got != c.want {
			t.Errorf("cmpVer(%s,%s)=%d want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestVersionOf(t *testing.T) {
	if v := versionOf([]byte("x\nconst APP_VERSION = '1.4';\n")); v != "1.4" {
		t.Fatal(v)
	}
	if v := versionOf(embeddedHTML); v == "" {
		t.Fatal("內建主程式沒有 APP_VERSION")
	}
}

func TestWriteAtomic(t *testing.T) {
	d := t.TempDir()
	p := filepath.Join(d, "a.txt")
	if err := writeAtomic(p, strings.NewReader("one")); err != nil {
		t.Fatal(err)
	}
	if err := writeAtomic(p, strings.NewReader("two")); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	if string(b) != "two" {
		t.Fatal(string(b))
	}
	if es, _ := os.ReadDir(d); len(es) != 1 {
		t.Fatal("留下暫存檔")
	}
}
