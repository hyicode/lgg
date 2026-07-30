package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

// CollectorServer HTTP 采集服务器
type CollectorServer struct {
	config       Config
	server       *http.Server
	lastRequest  time.Time
	mu           sync.Mutex
	onDemand     bool
	cachedClient *LeagueClient
	clientMu     sync.Mutex
}

var localOrigin = regexp.MustCompile(`^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$`)

func isAllowedOrigin(origin string, config Config) bool {
	if origin == "" {
		return true
	}
	for _, allowed := range config.AllowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return localOrigin.MatchString(origin)
}

func setCORSHeaders(w http.ResponseWriter, origin string) {
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Access-Control-Allow-Private-Network", "true")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Cache-Control", "no-store")
}

func writeJSON(w http.ResponseWriter, status int, data interface{}, origin string) {
	setCORSHeaders(w, origin)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// NewCollectorServer 创建采集服务器
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
		Addr:    fmt.Sprintf("127.0.0.1:%d", cfg.Port),
		Handler: mux,
	}

	return cs
}

func (cs *CollectorServer) handleRequest(w http.ResponseWriter, r *http.Request) {
	cs.mu.Lock()
	cs.lastRequest = time.Now()
	cs.mu.Unlock()

	origin := r.Header.Get("Origin")
	if !isAllowedOrigin(origin, cs.config) {
		writeJSON(w, 403, ErrorResponse{Error: "该网页来源不允许访问采集桥。"}, "")
		return
	}

	// CORS 预检
	if r.Method == "OPTIONS" {
		setCORSHeaders(w, origin)
		w.WriteHeader(204)
		return
	}

	// 健康检查
	if r.Method == "GET" && r.URL.Path == "/health" {
		writeJSON(w, 200, ErrorResponse{OK: true, Service: "LGG Collector Bridge"}, origin)
		return
	}

	// 客户端发现状态
	if r.Method == "GET" && r.URL.Path == "/discover" {
		client, err := cs.getCachedClient()
		if err != nil {
			writeJSON(w, 200, map[string]interface{}{
				"ok":        false,
				"lcuReady":  false,
				"liveReady": false,
				"error":     err.Error(),
			}, origin)
			return
		}
		liveReady := false
		if _, err := getLiveGameData(); err == nil {
			liveReady = true
		}
		writeJSON(w, 200, map[string]interface{}{
			"ok":        true,
			"lcuReady":  true,
			"liveReady": liveReady,
			"lcuPort":   strings.TrimPrefix(strings.TrimPrefix(client.BaseURL, "https://127.0.0.1:"), "http://127.0.0.1:"),
			"version":   "2.0.0",
		}, origin)
		return
	}

	// 采集对局数据
	if r.Method == "GET" && r.URL.Path == "/collect" {
		match, err := collectFromLeagueClient()
		if err != nil {
			writeJSON(w, 503, ErrorResponse{Error: err.Error()}, origin)
			return
		}
		writeJSON(w, 200, match, origin)
		return
	}

	// 最近对局列表
	if r.Method == "GET" && r.URL.Path == "/recent-games" {
		count := 20
		games, err := collectRecentGames(count)
		if err != nil {
			writeJSON(w, 503, ErrorResponse{Error: err.Error()}, origin)
			return
		}
		writeJSON(w, 200, map[string]interface{}{"games": games}, origin)
		return
	}

	// 404
	writeJSON(w, 404, ErrorResponse{Error: "Not found"}, origin)
}

// ---- 透明代理 ----

// getCachedClient 获取缓存的 LCU 客户端，缓存未命中时重新发现
func (cs *CollectorServer) getCachedClient() (*LeagueClient, error) {
	cs.clientMu.Lock()
	defer cs.clientMu.Unlock()

	if cs.cachedClient != nil {
		return cs.cachedClient, nil
	}
	client, err := discoverLeagueClient()
	if err != nil {
		return nil, err
	}
	cs.cachedClient = client
	return cs.cachedClient, nil
}

// proxyRequest 通用代理转发
func (cs *CollectorServer) proxyRequest(w http.ResponseWriter, r *http.Request, targetURL string, authHeader string) {
	// 构造目标请求
	proxyReq, err := http.NewRequest(r.Method, targetURL, r.Body)
	if err != nil {
		writeJSON(w, 502, ErrorResponse{Error: fmt.Sprintf("构造代理请求失败: %s", err.Error())}, r.Header.Get("Origin"))
		return
	}

	// 复制请求头（排除 hop-by-hop）
	for key, values := range r.Header {
		lower := strings.ToLower(key)
		if lower == "host" || lower == "connection" || lower == "transfer-encoding" || lower == "te" || lower == "trailer" {
			continue
		}
		for _, v := range values {
			proxyReq.Header.Add(key, v)
		}
	}

	// 注入认证头
	if authHeader != "" {
		proxyReq.Header.Set("Authorization", authHeader)
	}

	// 发送代理请求
	client := lcuHTTPClient()
	resp, err := client.Do(proxyReq)
	if err != nil {
		writeJSON(w, 502, ErrorResponse{Error: fmt.Sprintf("代理请求失败: %s", err.Error())}, r.Header.Get("Origin"))
		return
	}
	defer resp.Body.Close()

	// 复制响应头
	origin := r.Header.Get("Origin")
	setCORSHeaders(w, origin)
	for key, values := range resp.Header {
		lower := strings.ToLower(key)
		if lower == "access-control-allow-origin" || lower == "access-control-allow-methods" ||
			lower == "access-control-allow-headers" || lower == "access-control-allow-private-network" ||
			lower == "vary" || lower == "cache-control" {
			continue
		}
		for _, v := range values {
			w.Header().Add(key, v)
		}
	}

	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// handleLCUProxy 代理 LCU API 请求
// 用法: GET/POST /proxy/lcu/lol-match-history/v1/games/12345
func (cs *CollectorServer) handleLCUProxy(w http.ResponseWriter, r *http.Request) {
	cs.mu.Lock()
	cs.lastRequest = time.Now()
	cs.mu.Unlock()

	origin := r.Header.Get("Origin")
	if !isAllowedOrigin(origin, cs.config) {
		writeJSON(w, 403, ErrorResponse{Error: "该网页来源不允许访问采集桥。"}, "")
		return
	}

	if r.Method == "OPTIONS" {
		setCORSHeaders(w, origin)
		w.WriteHeader(204)
		return
	}

	client, err := cs.getCachedClient()
	if err != nil {
		writeJSON(w, 503, ErrorResponse{Error: fmt.Sprintf("未发现客户端: %s", err.Error())}, origin)
		return
	}

	// 去掉 /proxy/lcu 前缀，拼到 LCU BaseURL 后面
	endpoint := strings.TrimPrefix(r.URL.Path, "/proxy/lcu")
	if r.URL.RawQuery != "" {
		endpoint += "?" + r.URL.RawQuery
	}
	targetURL := client.BaseURL + endpoint

	cs.proxyRequest(w, r, targetURL, client.Authorization)
}

// handleLiveProxy 代理 Live Client Data API 请求
// 用法: GET /proxy/live/liveclientdata/allgamedata
func (cs *CollectorServer) handleLiveProxy(w http.ResponseWriter, r *http.Request) {
	cs.mu.Lock()
	cs.lastRequest = time.Now()
	cs.mu.Unlock()

	origin := r.Header.Get("Origin")
	if !isAllowedOrigin(origin, cs.config) {
		writeJSON(w, 403, ErrorResponse{Error: "该网页来源不允许访问采集桥。"}, "")
		return
	}

	if r.Method == "OPTIONS" {
		setCORSHeaders(w, origin)
		w.WriteHeader(204)
		return
	}

	endpoint := strings.TrimPrefix(r.URL.Path, "/proxy/live")
	if r.URL.RawQuery != "" {
		endpoint += "?" + r.URL.RawQuery
	}
	targetURL := "https://127.0.0.1:2999" + endpoint

	cs.proxyRequest(w, r, targetURL, "")
}

// Start 启动服务器
func (cs *CollectorServer) Start() error {
	fmt.Printf("LGG 本机采集桥已启动。\n")
	fmt.Printf("监听地址：http://127.0.0.1:%d\n", cs.config.Port)
	fmt.Println("请保持此窗口开启，然后在 LGG 的记录对局窗口点击 '采集数据' 。")
	fmt.Println("按 Ctrl+C 可退出。")

	// 按需模式：空闲 2 分钟后自动退出
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
			fmt.Println("采集桥空闲超时，自动退出。")
			cs.server.Close()
			return
		}
	}
}

// LastRequestTime 返回最后请求时间
func (cs *CollectorServer) LastRequestTime() time.Time {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	return cs.lastRequest
}
