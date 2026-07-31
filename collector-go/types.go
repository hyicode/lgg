package main

type ErrorResponse struct {
	Error   string `json:"error,omitempty"`
	OK      bool   `json:"ok,omitempty"`
	Service string `json:"service,omitempty"`
}
