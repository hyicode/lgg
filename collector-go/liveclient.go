package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// liveClientHTTPClient 返回访问 Live Client Data API 的客户端
func liveClientHTTPClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
		Timeout: 4 * time.Second,
	}
}

// getLiveGameData 从 Live Client Data API 获取实时对局数据
func getLiveGameData() (map[string]interface{}, error) {
	url := "https://127.0.0.1:2999/liveclientdata/allgamedata"
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := liveClientHTTPClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求 Live Client API 失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取 Live Client 响应失败: %w", err)
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Live Client 返回 HTTP %d", resp.StatusCode)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("解析 Live Client JSON 失败: %w", err)
	}
	return result, nil
}
