package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
)

func main() {
	onDemand := flag.Bool("on-demand", false, "按需模式：空闲 2 分钟后自动退出")
	showVersion := flag.Bool("version", false, "显示版本信息")
	flag.Parse()

	if *showVersion {
		fmt.Println("LGG Collector v1.0.0 (Go)")
		return
	}

	// 获取 exe 所在目录
	exePath, err := os.Executable()
	if err != nil {
		exePath, _ = filepath.Abs(".")
	}
	exeDir := filepath.Dir(exePath)

	// 读取配置
	cfg, err := readConfig(exeDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "读取配置失败：%s\n", err.Error())
		os.Exit(1)
	}

	// 创建并启动服务器
	cs := NewCollectorServer(cfg, *onDemand)
	if err := cs.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "采集桥启动失败：%s\n", err.Error())
		os.Exit(1)
	}
}
