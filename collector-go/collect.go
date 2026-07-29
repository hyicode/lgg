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

// RecentGameSummary 最近对局摘要
type RecentGameSummary struct {
	GameID          string        `json:"gameId"`
	PlayedAt        string        `json:"playedAt"`
	DurationSeconds int           `json:"durationSeconds"`
	GameMode        string        `json:"gameMode"`
	GameType        string        `json:"gameType"`
	QueueID         int           `json:"queueId"`
	Participants    []Participant `json:"participants"`
}

// collectRecentGames 获取最近 N 场对局摘要
func collectRecentGames(count int) ([]RecentGameSummary, error) {
	client, err := discoverLeagueClient()
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=%d", count)
	history, err := lcuGet(client, url)
	if err != nil {
		return nil, fmt.Errorf("获取对局列表失败：%s", err.Error())
	}

	games := getMap(history, "games")
	if games == nil {
		return nil, fmt.Errorf("对局列表为空")
	}
	gameList := getSlice(games, "games")

	var result []RecentGameSummary
	for _, g := range gameList {
		gm, ok := g.(map[string]interface{})
		if !ok {
			continue
		}
		// 只返回自定义对局
		gameType := getString(gm, "gameType")
		if gameType != "CUSTOM_GAME" && gameType != "PRACTICE_GAME" {
			continue
		}

		gameID := firstStr(
			getString(gm, "gameId"),
			asString(gm["id"]),
		)

		rawParticipants := participantSources(history, gm)
		var participants []Participant
		for _, p := range rawParticipants {
			participants = append(participants, normalizeParticipant(p))
		}
		// 去重
		var unique []Participant
		seen := make(map[string]bool)
		for i, p := range participants {
			key := fmt.Sprintf("%s|%s|%d|%s", p.AccountName, p.Team, p.ChampionID, p.ChampionSlug)
			if p.AccountName == "未知玩家" {
				key = fmt.Sprintf("%s|%s|%d", key, p.Position, i)
			}
			if seen[key] {
				continue
			}
			seen[key] = true
			unique = append(unique, p)
		}

		result = append(result, RecentGameSummary{
			GameID:          gameID,
			PlayedAt:        normalizePlayedAt(gm),
			DurationSeconds: firstInt(getInt(gm, "gameDuration"), getInt(gm, "gameLength")),
			GameMode:        getString(gm, "gameMode"),
			GameType:        gameType,
			QueueID:         getInt(gm, "queueId"),
			Participants:    unique,
		})
	}

	if len(result) == 0 {
		return nil, fmt.Errorf("没有找到自定义对局")
	}
	return result, nil
}
