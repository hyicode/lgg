package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sync"
	"time"
)

// CollectorServer HTTP 采集服务器
type CollectorServer struct {
	config      Config
	server      *http.Server
	lastRequest time.Time
	mu          sync.Mutex
	onDemand    bool
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
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
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

	// 404
	writeJSON(w, 404, ErrorResponse{Error: "Not found"}, origin)
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
