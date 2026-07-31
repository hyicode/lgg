package main

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const proxyVersion = "3.1.0"

// CollectorServer 只负责发现本机客户端并透明转发请求。
// 对局选择、字段解析和业务校验全部由网页完成。
type CollectorServer struct {
	config       Config
	server       *http.Server
	lastRequest  time.Time
	mu           sync.Mutex
	onDemand     bool
	cachedClient *LeagueClient
	clientMu     sync.Mutex
}

var proxyHTTPClient = &http.Client{
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, // LCU 使用本机自签名证书。
		MaxIdleConns:    8,
		IdleConnTimeout: 90 * time.Second,
	},
	Timeout: 20 * time.Second,
}

func isAllowedOrigin(origin string, config Config) bool {
	if origin == "" {
		return true
	}
	for _, allowed := range config.AllowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}

func setCORSHeaders(w http.ResponseWriter, origin string) {
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Access-Control-Allow-Private-Network", "true")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	w.Header().Set("Cache-Control", "no-store")
}

func writeJSON(w http.ResponseWriter, status int, data interface{}, origin string) {
	setCORSHeaders(w, origin)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func NewCollectorServer(cfg Config, onDemand bool) *CollectorServer {
	cs := &CollectorServer{
		config:      cfg,
		lastRequest: time.Now(),
		onDemand:    onDemand,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/proxy/lcu/", cs.handleLCUProxy)
	mux.HandleFunc("/proxy/live/", cs.handleLiveProxy)
	mux.HandleFunc("/", cs.handleRequest)
	cs.server = &http.Server{
		Addr:              fmt.Sprintf("127.0.0.1:%d", cfg.Port),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	return cs
}

func (cs *CollectorServer) touch() {
	cs.mu.Lock()
	cs.lastRequest = time.Now()
	cs.mu.Unlock()
}

func (cs *CollectorServer) allowRequest(w http.ResponseWriter, r *http.Request) bool {
	cs.touch()
	origin := r.Header.Get("Origin")
	if !isAllowedOrigin(origin, cs.config) {
		writeJSON(w, http.StatusForbidden, ErrorResponse{Error: "该网页来源不允许访问采集代理。"}, "")
		return false
	}
	if r.Method == http.MethodOptions {
		setCORSHeaders(w, origin)
		w.WriteHeader(http.StatusNoContent)
		return false
	}
	return true
}

func allowReadOnlyProxy(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		return true
	}
	w.Header().Set("Allow", "GET, HEAD, OPTIONS")
	writeJSON(w, http.StatusMethodNotAllowed, ErrorResponse{Error: "采集代理仅允许只读请求。"}, r.Header.Get("Origin"))
	return false
}

func isAllowedLCUPath(path string) bool {
	switch path {
	case "/proxy/lcu/lol-match-history/v1/products/lol/current-summoner/matches",
		"/proxy/lcu/lol-game-data/assets/v1/champion-summary.json":
		return true
	}
	const gamePrefix = "/proxy/lcu/lol-match-history/v1/games/"
	if !strings.HasPrefix(path, gamePrefix) {
		return false
	}
	gameID := strings.TrimPrefix(path, gamePrefix)
	if gameID == "" || strings.ContainsAny(gameID, "/\\") {
		return false
	}
	for _, char := range gameID {
		if (char < '0' || char > '9') && (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') && char != '_' && char != '-' {
			return false
		}
	}
	return true
}

func isAllowedLivePath(path string) bool {
	const livePrefix = "/proxy/live/liveclientdata/"
	if !strings.HasPrefix(path, livePrefix) {
		return false
	}
	endpoint := strings.TrimPrefix(path, livePrefix)
	switch endpoint {
	case "allgamedata", "activeplayer", "activeplayername", "playerlist", "playeritems", "eventdata", "gamestats", "scores":
		return true
	default:
		return false
	}
}

func (cs *CollectorServer) handleRequest(w http.ResponseWriter, r *http.Request) {
	if !cs.allowRequest(w, r) {
		return
	}
	origin := r.Header.Get("Origin")

	if r.Method == http.MethodGet && r.URL.Path == "/health" {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"ok":      true,
			"service": "LGG Collector Bridge",
			"runtime": "go",
			"mode":    "proxy",
			"version": proxyVersion,
		}, origin)
		return
	}

	if r.Method == http.MethodGet && r.URL.Path == "/discover" {
		client, err := cs.getCachedClient()
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"ok":       false,
				"lcuReady": false,
				"runtime":  "go",
				"mode":     "proxy",
				"version":  proxyVersion,
				"error":    err.Error(),
			}, origin)
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"ok":       true,
			"lcuReady": true,
			"lcuPort": strings.TrimPrefix(
				strings.TrimPrefix(client.BaseURL, "https://127.0.0.1:"),
				"http://127.0.0.1:",
			),
			"runtime": "go",
			"mode":    "proxy",
			"version": proxyVersion,
		}, origin)
		return
	}

	writeJSON(w, http.StatusNotFound, ErrorResponse{Error: "Not found"}, origin)
}

func (cs *CollectorServer) getCachedClient() (*LeagueClient, error) {
	cs.clientMu.Lock()
	defer cs.clientMu.Unlock()

	const cacheTTL = 30 * time.Minute
	if cs.cachedClient != nil && time.Since(cs.cachedClient.DiscoveredAt) < cacheTTL {
		return cs.cachedClient, nil
	}
	cs.cachedClient = nil
	client, err := discoverLeagueClient()
	if err != nil {
		return nil, err
	}
	cs.cachedClient = client
	fmt.Fprintf(os.Stderr, "[代理] 客户端已发现：%s\n", client.BaseURL)
	return cs.cachedClient, nil
}

func (cs *CollectorServer) clearCachedClient() {
	cs.clientMu.Lock()
	cs.cachedClient = nil
	cs.clientMu.Unlock()
}

func shouldSkipHeader(name string) bool {
	switch strings.ToLower(name) {
	case "host", "connection", "proxy-connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade":
		return true
	default:
		return false
	}
}

func shouldSkipResponseHeader(name string) bool {
	if shouldSkipHeader(name) {
		return true
	}
	switch strings.ToLower(name) {
	case "access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers", "access-control-allow-private-network", "vary", "cache-control":
		return true
	default:
		return false
	}
}

func forwardRequest(r *http.Request, targetURL, authorization string, body []byte) (*http.Response, error) {
	proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	for key, values := range r.Header {
		if shouldSkipHeader(key) {
			continue
		}
		for _, value := range values {
			proxyReq.Header.Add(key, value)
		}
	}
	if authorization != "" {
		proxyReq.Header.Set("Authorization", authorization)
	}
	return proxyHTTPClient.Do(proxyReq)
}

func writeProxyResponse(w http.ResponseWriter, response *http.Response, origin string) {
	setCORSHeaders(w, origin)
	for key, values := range response.Header {
		if shouldSkipResponseHeader(key) {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
}

func requestBody(r *http.Request) ([]byte, error) {
	if r.Body == nil {
		return nil, nil
	}
	defer r.Body.Close()
	return io.ReadAll(io.LimitReader(r.Body, 16<<20))
}

func (cs *CollectorServer) handleLCUProxy(w http.ResponseWriter, r *http.Request) {
	if !cs.allowRequest(w, r) {
		return
	}
	origin := r.Header.Get("Origin")
	if !allowReadOnlyProxy(w, r) {
		return
	}
	if !isAllowedLCUPath(r.URL.Path) {
		writeJSON(w, http.StatusNotFound, ErrorResponse{Error: "该客户端接口不在采集白名单中。"}, origin)
		return
	}
	body, err := requestBody(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "读取代理请求失败。"}, origin)
		return
	}

	client, err := cs.getCachedClient()
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, ErrorResponse{Error: fmt.Sprintf("未发现客户端: %s", err.Error())}, origin)
		return
	}
	endpoint := strings.TrimPrefix(r.URL.Path, "/proxy/lcu")
	if r.URL.RawQuery != "" {
		endpoint += "?" + r.URL.RawQuery
	}

	response, err := forwardRequest(r, client.BaseURL+endpoint, client.Authorization, body)
	if err != nil {
		// 客户端重启后端口通常会变化；连接失败时立即重新发现并只重试一次。
		cs.clearCachedClient()
		client, err = cs.getCachedClient()
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, ErrorResponse{Error: fmt.Sprintf("客户端连接已失效: %s", err.Error())}, origin)
			return
		}
		response, err = forwardRequest(r, client.BaseURL+endpoint, client.Authorization, body)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, ErrorResponse{Error: fmt.Sprintf("代理重试失败: %s", err.Error())}, origin)
			return
		}
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		_ = response.Body.Close()
		cs.clearCachedClient()
		client, err = cs.getCachedClient()
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, ErrorResponse{Error: fmt.Sprintf("客户端认证已失效: %s", err.Error())}, origin)
			return
		}
		response, err = forwardRequest(r, client.BaseURL+endpoint, client.Authorization, body)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, ErrorResponse{Error: fmt.Sprintf("代理重试失败: %s", err.Error())}, origin)
			return
		}
	}
	defer response.Body.Close()
	writeProxyResponse(w, response, origin)
}

func (cs *CollectorServer) handleLiveProxy(w http.ResponseWriter, r *http.Request) {
	if !cs.allowRequest(w, r) {
		return
	}
	origin := r.Header.Get("Origin")
	if !allowReadOnlyProxy(w, r) {
		return
	}
	if !isAllowedLivePath(r.URL.Path) {
		writeJSON(w, http.StatusNotFound, ErrorResponse{Error: "该实时接口不在采集白名单中。"}, origin)
		return
	}
	body, err := requestBody(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "读取代理请求失败。"}, origin)
		return
	}
	endpoint := strings.TrimPrefix(r.URL.Path, "/proxy/live")
	if r.URL.RawQuery != "" {
		endpoint += "?" + r.URL.RawQuery
	}
	response, err := forwardRequest(r, "https://127.0.0.1:2999"+endpoint, "", body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, ErrorResponse{Error: fmt.Sprintf("实时接口代理失败: %s", err.Error())}, origin)
		return
	}
	defer response.Body.Close()
	writeProxyResponse(w, response, origin)
}

func (cs *CollectorServer) Start() error {
	fmt.Printf("LGG 本机代理已启动（Go %s）。\n", proxyVersion)
	fmt.Printf("监听地址：http://127.0.0.1:%d\n", cs.config.Port)
	fmt.Println("此程序只转发本机英雄联盟客户端接口，不解析或保存对局数据。")
	fmt.Println("返回 LGG 网页点击“采集数据”即可；按 Ctrl+C 可退出。")

	if cs.onDemand {
		go cs.idleMonitor()
	}
	return cs.server.ListenAndServe()
}

func (cs *CollectorServer) idleMonitor() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		cs.mu.Lock()
		idle := time.Since(cs.lastRequest)
		cs.mu.Unlock()
		if idle > 2*time.Minute {
			fmt.Println("本机代理空闲超时，自动退出。")
			_ = cs.server.Close()
			return
		}
	}
}

func (cs *CollectorServer) LastRequestTime() time.Time {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	return cs.lastRequest
}
