package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthIdentifiesGoProxy(t *testing.T) {
	server := NewCollectorServer(defaultConfig(), true)
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/health", nil)
	request.Header.Set("Origin", "http://localhost:2525")
	recorder := httptest.NewRecorder()

	server.handleRequest(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("health status = %d", recorder.Code)
	}
	var response map[string]interface{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response["runtime"] != "go" || response["mode"] != "proxy" {
		t.Fatalf("unexpected health response: %#v", response)
	}
}

func TestBusinessCollectionRoutesAreRemoved(t *testing.T) {
	server := NewCollectorServer(defaultConfig(), true)
	for _, path := range []string{"/collect", "/recent-games"} {
		request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1"+path, nil)
		recorder := httptest.NewRecorder()
		server.handleRequest(recorder, request)
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("%s status = %d, want 404", path, recorder.Code)
		}
	}
}

func TestForwardRequestPreservesRequestData(t *testing.T) {
	type receivedRequest struct {
		method        string
		query         string
		authorization string
		customHeader  string
		body          string
	}
	received := make(chan receivedRequest, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		received <- receivedRequest{
			method:        r.Method,
			query:         r.URL.RawQuery,
			authorization: r.Header.Get("Authorization"),
			customHeader:  r.Header.Get("X-LGG-Test"),
			body:          string(body),
		}
		_, _ = w.Write(body)
	}))
	defer upstream.Close()

	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/proxy/lcu/test", strings.NewReader("payload"))
	request.Header.Set("X-LGG-Test", "yes")
	response, err := forwardRequest(request, upstream.URL+"/test?value=1", "Basic token", []byte("payload"))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if string(body) != "payload" {
		t.Fatalf("response body = %q", body)
	}
	got := <-received
	if got.method != http.MethodPost || got.query != "value=1" || got.body != "payload" {
		t.Fatalf("request data not forwarded: %#v", got)
	}
	if got.authorization != "Basic token" || got.customHeader != "yes" {
		t.Fatalf("request headers not forwarded: %#v", got)
	}
}

func TestProxyRejectsWriteMethodsBeforeDiscovery(t *testing.T) {
	server := NewCollectorServer(defaultConfig(), true)
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/proxy/lcu/lol-match-history/v1/games/123", strings.NewReader("payload"))
	request.Header.Set("Origin", "http://localhost:2525")
	recorder := httptest.NewRecorder()

	server.handleLCUProxy(recorder, request)
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("write proxy status = %d, want 405", recorder.Code)
	}
}

func TestProxyRejectsPathsOutsideReadAllowlist(t *testing.T) {
	server := NewCollectorServer(defaultConfig(), true)
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/proxy/lcu/lol-chat/v1/conversations", nil)
	request.Header.Set("Origin", "http://localhost:2525")
	recorder := httptest.NewRecorder()

	server.handleLCUProxy(recorder, request)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("non-allowlisted proxy status = %d, want 404", recorder.Code)
	}
}

func TestUnknownLocalOriginIsRejected(t *testing.T) {
	server := NewCollectorServer(defaultConfig(), true)
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/health", nil)
	request.Header.Set("Origin", "http://localhost:9999")
	recorder := httptest.NewRecorder()

	server.handleRequest(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("unknown local origin status = %d, want 403", recorder.Code)
	}
}

func TestReadAllowlist(t *testing.T) {
	allowed := []string{
		"/proxy/lcu/lol-match-history/v1/products/lol/current-summoner/matches",
		"/proxy/lcu/lol-match-history/v1/games/123456",
		"/proxy/lcu/lol-match-history/v1/games/HN1_123456",
		"/proxy/lcu/lol-game-data/assets/v1/champion-summary.json",
	}
	for _, path := range allowed {
		if !isAllowedLCUPath(path) {
			t.Errorf("expected allowlisted path: %s", path)
		}
	}
	if isAllowedLCUPath("/proxy/lcu/lol-match-history/v1/games/../../chat") {
		t.Fatal("path traversal must not be allowlisted")
	}
}
