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
	if response["runtime"] != "go" || response["mode"] != "proxy" || response["version"] != proxyVersion {
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

func TestPreflightAllowsRequestedMethodAndHeaders(t *testing.T) {
	server := NewCollectorServer(defaultConfig(), true)
	request := httptest.NewRequest(http.MethodOptions, "http://127.0.0.1/proxy/lcu/lol-chat/v1/conversations", nil)
	request.Header.Set("Origin", "https://example.com")
	request.Header.Set("Access-Control-Request-Method", http.MethodPatch)
	request.Header.Set("Access-Control-Request-Headers", "content-type,x-custom-header")
	recorder := httptest.NewRecorder()

	server.handleLCUProxy(recorder, request)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want 204", recorder.Code)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Methods"); got != http.MethodPatch {
		t.Fatalf("allowed method = %q, want PATCH", got)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Headers"); got != "content-type,x-custom-header" {
		t.Fatalf("allowed headers = %q", got)
	}
}

func TestAnyWebOriginIsAllowed(t *testing.T) {
	server := NewCollectorServer(defaultConfig(), true)
	for _, origin := range []string{"http://localhost:9999", "https://example.com"} {
		request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/health", nil)
		request.Header.Set("Origin", origin)
		recorder := httptest.NewRecorder()

		server.handleRequest(recorder, request)
		if recorder.Code != http.StatusOK {
			t.Fatalf("origin %q status = %d, want 200", origin, recorder.Code)
		}
		if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != origin {
			t.Fatalf("allow origin = %q, want %q", got, origin)
		}
	}
}
