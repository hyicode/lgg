package main

import (
	"fmt"
	"os"
	"strings"
)

// collectFromLeagueClient 尝试多种来源采集对局数据
func collectFromLeagueClient() (*MatchData, error) {
	var errors []string

	// 1. 发现客户端
	client, err := discoverLeagueClient()
	if err != nil {
		errors = append(errors, err.Error())
	} else {
		fmt.Fprintf(os.Stderr, "[采集] 已发现客户端：%s\n", client.BaseURL)

		// 2a. 赛后结算数据
		raw, err := lcuGet(client, "/lol-end-of-game/v1/eog-stats-block")
		if err != nil {
			fmt.Fprintf(os.Stderr, "[采集] 赛后接口：%s（结算界面可能已关闭）\n", err.Error())
			errors = append(errors, fmt.Sprintf("赛后接口：%s", err.Error()))
		} else {
			match, err := normalizeLcuMatch(raw, "League Client API（赛后数据）")
			if err == nil && len(match.Participants) >= 10 {
				fmt.Fprintf(os.Stderr, "[采集] 赛后接口成功，%d 名玩家\n", len(match.Participants))
				return match, nil
			}
			if err != nil {
				fmt.Fprintf(os.Stderr, "[采集] 赛后接口规范化失败：%s\n", err.Error())
				errors = append(errors, err.Error())
			} else {
				fmt.Fprintf(os.Stderr, "[采集] 赛后接口仅 %d 名玩家（不足 10 人）\n", len(match.Participants))
				errors = append(errors, "赛后接口玩家数据不完整")
			}
		}

		// 2b. 最近对局历史
		history, err := lcuGet(client, "/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=1")
		if err != nil {
			fmt.Fprintf(os.Stderr, "[采集] 最近对局列表：%s\n", err.Error())
			errors = append(errors, fmt.Sprintf("最近对局：%s", err.Error()))
		} else {
			gameID := extractGameID(history)
			fmt.Fprintf(os.Stderr, "[采集] 最近对局列表已获取，gameId=%s\n", gameID)
			if gameID != "" {
				detail, err := lcuGet(client, "/lol-match-history/v1/games/"+gameID)
				if err == nil {
					match, err := normalizeLcuMatch(detail, "League Client API（最近对局）")
					if err == nil && len(match.Participants) >= 10 {
						fmt.Fprintf(os.Stderr, "[采集] 最近对局详情成功，%d 名玩家\n", len(match.Participants))
						return match, nil
					}
					if err != nil {
						fmt.Fprintf(os.Stderr, "[采集] 最近对局详情规范化失败：%s\n", err.Error())
					} else {
						fmt.Fprintf(os.Stderr, "[采集] 最近对局详情仅 %d 名玩家（不足 10 人）\n", len(match.Participants))
					}
				} else {
					fmt.Fprintf(os.Stderr, "[采集] 最近对局详情请求失败：%s，回退到列表\n", err.Error())
				}
			}
			match, err := normalizeLcuMatch(history, "League Client API（最近对局）")
			if err == nil && len(match.Participants) >= 10 {
				fmt.Fprintf(os.Stderr, "[采集] 最近对局列表成功，%d 名玩家\n", len(match.Participants))
				return match, nil
			}
			if err != nil {
				fmt.Fprintf(os.Stderr, "[采集] 最近对局列表规范化失败：%s\n", err.Error())
			} else {
				fmt.Fprintf(os.Stderr, "[采集] 最近对局列表仅 %d 名玩家（不足 10 人）\n", len(match.Participants))
			}
			errors = append(errors, "最近对局玩家数据不完整")
		}
	}

	// 3. Live Client Data API
	live, err := getLiveGameData()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[采集] 实时接口：%s（当前不在游戏中）\n", err.Error())
		errors = append(errors, fmt.Sprintf("实时接口：%s", err.Error()))
	} else {
		match, err := normalizeLiveMatch(live)
		if err == nil && len(match.Participants) >= 10 {
			fmt.Fprintf(os.Stderr, "[采集] 实时接口成功，%d 名玩家\n", len(match.Participants))
			return match, nil
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "[采集] 实时接口规范化失败：%s\n", err.Error())
			errors = append(errors, err.Error())
		} else {
			fmt.Fprintf(os.Stderr, "[采集] 实时接口仅 %d 名玩家（不足 10 人）\n", len(match.Participants))
			errors = append(errors, "实时接口玩家数据不完整")
		}
	}

	return nil, fmt.Errorf("无法取得完整对局。%s", strings.Join(errors, "；"))
}
