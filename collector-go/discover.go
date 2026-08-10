package main

import (
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// LeagueClient 英雄联盟客户端连接信息
type LeagueClient struct {
	BaseURL       string
	Authorization string
	DiscoveredAt  time.Time
}

// discoverLeagueClient 通过 PowerShell 查找 LeagueClientUx.exe 进程
func discoverLeagueClient() (*LeagueClient, error) {
	script := `Get-CimInstance Win32_Process -Filter "Name = 'LeagueClientUx.exe'" | Select-Object -First 1 | ForEach-Object { $_.CommandLine }`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-Command", script)
	cmd.SysProcAttr = hideWindowAttr()
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("无法查找英雄联盟客户端进程: %w", err)
	}
	commandLine := strings.TrimSpace(string(out))
	if commandLine == "" {
		return nil, fmt.Errorf("未找到英雄联盟客户端。请先登录国服客户端。")
	}

	portRe := regexp.MustCompile(`--app-port[= ]([0-9]+)`)
	tokenRe := regexp.MustCompile(`--remoting-auth-token[= ](?:"([^"]+)"|([^\s"]+))`)

	portMatch := portRe.FindStringSubmatch(commandLine)
	if portMatch == nil {
		return nil, fmt.Errorf("无法解析客户端端口。")
	}

	tokenMatch := tokenRe.FindStringSubmatch(commandLine)
	if tokenMatch == nil {
		return nil, fmt.Errorf("无法解析客户端令牌。")
	}
	token := tokenMatch[1]
	if token == "" {
		token = tokenMatch[2]
	}
	if token == "" {
		return nil, fmt.Errorf("客户端令牌为空。")
	}

	return &LeagueClient{
		BaseURL:       fmt.Sprintf("https://127.0.0.1:%s", portMatch[1]),
		Authorization: fmt.Sprintf("Basic %s", basicAuth("riot", token)),
		DiscoveredAt:  time.Now(),
	}, nil
}
