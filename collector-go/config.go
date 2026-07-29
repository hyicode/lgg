package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Config 采集器配置
type Config struct {
	Port           int      `json:"port"`
	AllowedOrigins []string `json:"allowedOrigins"`
}

func defaultConfig() Config {
	return Config{
		Port:           32145,
		AllowedOrigins: []string{"https://hyicode.github.io"},
	}
}

func readConfig(exeDir string) (Config, error) {
	cfg := defaultConfig()
	configPath := filepath.Join(exeDir, "config.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return cfg, err
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, err
	}
	if cfg.Port <= 0 {
		cfg.Port = 32145
	}
	return cfg, nil
}
