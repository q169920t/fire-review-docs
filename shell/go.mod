module github.com/q169920t/fire-review-docs/shell

go 1.24

replace (
	golang.org/x/image => github.com/golang/image v0.24.0
	golang.org/x/sys => github.com/golang/sys v0.30.0
	golang.org/x/text => github.com/golang/text v0.22.0
)

replace gopkg.in/yaml.v3 => github.com/go-yaml/yaml/v3 v3.0.1

replace gopkg.in/check.v1 => github.com/go-check/check v0.0.0-20201130134442-10cb98267c6c

replace gopkg.in/yaml.v2 => github.com/go-yaml/yaml v2.4.0+incompatible

require (
	github.com/jchv/go-webview2 v0.0.0-20260205173254-56598839c808
	github.com/ncruces/zenity v0.10.14
)

require (
	github.com/akavel/rsrc v0.10.2 // indirect
	github.com/dchest/jsmin v0.0.0-20220218165748-59f39799265f // indirect
	github.com/jchv/go-winloader v0.0.0-20250406163304-c1995be93bd1 // indirect
	github.com/josephspurrier/goversioninfo v1.4.1 // indirect
	github.com/randall77/makefat v0.0.0-20210315173500-7ddd0e42c844 // indirect
	golang.org/x/image v0.20.0 // indirect
	golang.org/x/sys v0.25.0 // indirect
)
