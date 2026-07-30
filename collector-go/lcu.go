package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// lcuHTTPClient 返回可访问 LCU API 的 HTTP 客户端（跳过证书验证）
func lcuHTTPClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
		Timeout: 15 * time.Second,
	}
}

// lcuGet 对 LCU API 发起 GET 请求并解析 JSON
func lcuGet(client *LeagueClient, endpoint string) (map[string]interface{}, error) {
	url := client.BaseURL + endpoint
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", client.Authorization)

	resp, err := lcuHTTPClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求 LCU 失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取 LCU 响应失败: %w", err)
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("LCU 返回 HTTP %d", resp.StatusCode)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("解析 LCU JSON 失败: %w", err)
	}
	return result, nil
}
