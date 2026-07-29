package main

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ---- 工具函数 ----

// firstStr 返回第一个非空字符串
func firstStr(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// firstInt 返回第一个非零整数
func firstInt(values ...int) int {
	for _, v := range values {
		if v != 0 {
			return v
		}
	}
	return 0
}

// asInt 安全转换为 int
func asInt(v interface{}) int {
	switch val := v.(type) {
	case float64:
		return int(val)
	case int:
		return val
	case int64:
		return int(val)
	case string:
		n, err := strconv.ParseFloat(val, 64)
		if err == nil {
			return int(n)
		}
	}
	return 0
}

// asString 安全转换为 string
func asString(v interface{}) string {
	if v == nil {
		return ""
	}
	switch val := v.(type) {
	case float64:
		// 大整数用科学计数法会导致 URL 错误，需按整数格式输出
		if val == float64(int64(val)) {
			return fmt.Sprintf("%.0f", val)
		}
		return fmt.Sprintf("%v", val)
	case float32:
		if val == float32(int64(val)) {
			return fmt.Sprintf("%.0f", val)
		}
		return fmt.Sprintf("%v", val)
	default:
		return fmt.Sprintf("%v", v)
	}
}

// asBool 安全转换为 bool
func asBool(v interface{}) (bool, bool) {
	if v == nil {
		return false, false
	}
	switch val := v.(type) {
	case bool:
		return val, true
	case string:
		lower := strings.ToLower(val)
		switch lower {
		case "win", "won", "victory", "true":
			return true, true
		case "fail", "failed", "lose", "loss", "defeat", "false":
			return false, true
		}
	}
	return false, false
}

// getString 从 map 中安全获取字符串
func getString(m map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if v, ok := m[key]; ok && v != nil {
			return asString(v)
		}
	}
	return ""
}

// getInt 从 map 中安全获取整数
func getInt(m map[string]interface{}, keys ...string) int {
	for _, key := range keys {
		if v, ok := m[key]; ok && v != nil {
			return asInt(v)
		}
	}
	return 0
}

// getBool 从 map 中安全获取布尔值，返回值和是否找到
func getBool(m map[string]interface{}, keys ...string) (bool, bool) {
	for _, key := range keys {
		if v, ok := m[key]; ok && v != nil {
			return asBool(v)
		}
	}
	return false, false
}

// getMap 从 map 中安全获取嵌套 map
func getMap(m map[string]interface{}, key string) map[string]interface{} {
	if v, ok := m[key]; ok {
		if mv, ok := v.(map[string]interface{}); ok {
			return mv
		}
	}
	return nil
}

// getSlice 从 map 中安全获取切片
func getSlice(m map[string]interface{}, key string) []interface{} {
	if v, ok := m[key]; ok {
		if sv, ok := v.([]interface{}); ok {
			return sv
		}
	}
	return nil
}

// ---- 数据规范化 ----

// normalizeTeam 将队伍标识规范化为 "blue" / "red"
func normalizeTeam(v interface{}) string {
	s := strings.ToUpper(asString(v))
	if s == "100" || s == "ORDER" || s == "BLUE" {
		return "blue"
	}
	if s == "200" || s == "CHAOS" || s == "RED" {
		return "red"
	}
	return ""
}

// normalizeWin 规范化胜负
func normalizeWin(v interface{}) *bool {
	if b, ok := asBool(v); ok {
		return &b
	}
	return nil
}

// championSlug 将英雄名转为 slug
var nonAlphaNum = regexp.MustCompile(`[^a-z0-9]`)

func championSlug(name string) string {
	return nonAlphaNum.ReplaceAllString(strings.ToLower(name), "")
}

// statsObject 将 stats 数组转为 map
func statsObject(v interface{}) map[string]interface{} {
	result := make(map[string]interface{})
	arr, ok := v.([]interface{})
	if !ok {
		if m, ok := v.(map[string]interface{}); ok {
			return m
		}
		return result
	}
	for _, item := range arr {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		name := asString(m["name"])
		if name == "" {
			continue
		}
		val := m["value"]
		result[name] = val
		normalized := nonAlphaNum.ReplaceAllString(strings.ToLower(name), "")
		result[normalized] = val
	}
	return result
}

// statValue 从 stats 中按多个候选名查找值
func statValue(stats map[string]interface{}, names ...string) interface{} {
	for _, name := range names {
		if v, ok := stats[name]; ok && v != nil {
			return v
		}
		normalized := nonAlphaNum.ReplaceAllString(strings.ToLower(name), "")
		if v, ok := stats[normalized]; ok && v != nil {
			return v
		}
	}
	return nil
}

// unwrapGame 提取 game 对象
func unwrapGame(raw map[string]interface{}) map[string]interface{} {
	if games := getMap(raw, "games"); games != nil {
		if gameList := getSlice(games, "games"); len(gameList) > 0 {
			if g, ok := gameList[0].(map[string]interface{}); ok {
				return g
			}
		}
		if gameList := getSlice(games, ""); len(gameList) > 0 {
			if g, ok := gameList[0].(map[string]interface{}); ok {
				return g
			}
		}
	}
	for _, key := range []string{"game", "statsBlock"} {
		if g := getMap(raw, key); g != nil {
			return g
		}
	}
	return raw
}

// participantSources 从各种来源提取玩家列表
func participantSources(raw, game map[string]interface{}) []map[string]interface{} {
	var participants []map[string]interface{}

	addParticipants := func(list []interface{}) {
		for _, p := range list {
			if pm, ok := p.(map[string]interface{}); ok {
				participants = append(participants, pm)
			}
		}
	}

	// 直接从 game/raw 中取 participants/players
	for _, src := range []map[string]interface{}{game, raw} {
		for _, key := range []string{"participants", "players", "playerStats"} {
			addParticipants(getSlice(src, key))
		}
	}

	// 从 teams 中提取
	for _, src := range []map[string]interface{}{game, raw} {
		for _, team := range getSlice(src, "teams") {
			tm, ok := team.(map[string]interface{})
			if !ok {
				continue
			}
			teamID := firstStr(
				asString(tm["teamId"]),
				asString(tm["id"]),
				asString(tm["team"]),
			)
			for _, playerList := range [][]interface{}{
				getSlice(tm, "players"),
				getSlice(tm, "participants"),
			} {
				for _, p := range playerList {
					pm, ok := p.(map[string]interface{})
					if !ok {
						continue
					}
					// 继承 teamId
					if pm["teamId"] == nil && teamID != "" {
						pm["teamId"] = teamID
					}
					participants = append(participants, pm)
				}
			}
		}
	}

	// 合并 participantIdentities（LCU 比赛历史 API 将玩家身份信息分离在此数组中）
	mergeParticipantIdentities(participants, raw, game)

	return participants
}

// mergeParticipantIdentities 将 participantIdentities 中的玩家身份信息合并到 participants
// LCU 比赛历史 API 中，participants[i] 只有 championId + stats，
// 而 summonerName / gameName / tagLine 在 participantIdentities[i].player 中。
func mergeParticipantIdentities(participants []map[string]interface{}, raw, game map[string]interface{}) {
	// 收集所有 participantIdentities
	var identities []map[string]interface{}
	for _, src := range []map[string]interface{}{game, raw} {
		for _, id := range getSlice(src, "participantIdentities") {
			if idm, ok := id.(map[string]interface{}); ok {
				identities = append(identities, idm)
			}
		}
	}
	if len(identities) == 0 {
		return
	}

	// 按 participantId 建立索引
	idMap := make(map[int]map[string]interface{})
	for _, id := range identities {
		pid := asInt(id["participantId"])
		if pid > 0 {
			idMap[pid] = id
		}
	}

	// 合并到每个 participant
	for _, p := range participants {
		pid := asInt(p["participantId"])
		identity := idMap[pid]
		if identity == nil {
			continue
		}
		player := getMap(identity, "player")
		if player == nil {
			continue
		}
		// 将 player 中的字段合并到 participant（不覆盖已有值）
		for k, v := range player {
			if _, exists := p[k]; !exists && v != nil {
				p[k] = v
			}
		}
	}
}

// participantName 提取玩家名
func participantName(player map[string]interface{}) string {
	gameName := firstStr(getString(player, "riotIdGameName"), getString(player, "gameName"))
	tagLine := firstStr(getString(player, "riotIdTagLine"), getString(player, "tagLine"))

	full := ""
	if gameName != "" && tagLine != "" {
		full = gameName + "#" + tagLine
	}

	return firstStr(
		getString(player, "riotId"),
		full,
		gameName,
		getString(player, "summonerName"),
		getString(player, "playerName"),
		getString(player, "name"),
		"未知玩家",
	)
}

// normalizeParticipant 规范化单个玩家
func normalizeParticipant(player map[string]interface{}) Participant {
	stats := statsObject(firstNonNil(
		player["stats"],
		player["statistics"],
		player,
	))
	championName := firstStr(
		getString(player, "championName"),
		getString(getMap(player, "champion"), "name"),
		getString(player, "skinName"),
		getString(stats, "championName"),
	)

	win := normalizeWin(firstNonNil(
		statValue(stats, "win", "gameOutcome"),
		player["win"],
		player["gameOutcome"],
		player["outcome"],
	))

	position := firstStr(
		getString(player, "position"),
		getString(player, "selectedPosition"),
		getString(player, "individualPosition"),
		asString(statValue(stats, "position")),
	)

	return Participant{
		AccountName:  participantName(player),
		Team:         normalizeTeam(firstNonNil(player["teamId"], player["team"], stats["teamId"])),
		Position:     position,
		ChampionID:   firstInt(getInt(player, "championId"), getInt(getMap(player, "champion"), "id"), getInt(stats, "championId")),
		ChampionName: championName,
		ChampionSlug: championSlug(championName),
		Win:          win,
		Stats: PlayerStats{
			Kills:       asInt(statValue(stats, "kills", "championsKilled")),
			Deaths:      asInt(statValue(stats, "deaths", "numDeaths")),
			Assists:     asInt(statValue(stats, "assists")),
			CreepScore:  asInt(statValue(stats, "creepScore", "minionsKilled")) + asInt(statValue(stats, "neutralMinionsKilled")),
			GoldEarned:  asInt(statValue(stats, "goldEarned")),
			VisionScore: asInt(statValue(stats, "visionScore", "wardScore")),
			DamageDealt: asInt(statValue(stats, "totalDamageDealtToChampions")),
			Level:       firstInt(asInt(firstNonNil(player["level"], statValue(stats, "level", "champLevel")))),
		},
	}
}

// normalizePlayedAt 规范化时间戳为 ISO 8601
func normalizePlayedAt(game map[string]interface{}) string {
	val := firstNonNil(
		game["gameStartTimestamp"],
		game["gameCreation"],
		game["gameCreationDate"],
		game["createDate"],
		game["gameDate"],
	)
	if val == nil {
		return ""
	}

	var ts int64
	switch v := val.(type) {
	case float64:
		ts = int64(v)
	case int64:
		ts = v
	case int:
		ts = int64(v)
	case string:
		parsed, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return ""
		}
		ts = parsed
	default:
		return ""
	}

	// 毫秒时间戳
	if ts > 10_000_000_000 {
		ts = ts / 1000
	}
	t := time.Unix(ts, 0).UTC()
	return t.Format(time.RFC3339)
}

// inferWinner 从队伍数据推断胜方
func inferWinner(raw, game map[string]interface{}, participants []Participant) string {
	for _, src := range []map[string]interface{}{game, raw} {
		for _, team := range getSlice(src, "teams") {
			tm, ok := team.(map[string]interface{})
			if !ok {
				continue
			}
			if w, found := asBool(firstNonNil(tm["win"], tm["isWinningTeam"], tm["outcome"])); found && w {
				return normalizeTeam(firstNonNil(tm["teamId"], tm["id"], tm["team"]))
			}
		}
	}

	for _, p := range participants {
		if p.Win != nil && *p.Win && p.Team != "" {
			return p.Team
		}
	}
	return ""
}

// normalizeLcuMatch 规范化 LCU 对局数据
func normalizeLcuMatch(raw map[string]interface{}, source string) (*MatchData, error) {
	game := unwrapGame(raw)
	rawParticipants := participantSources(raw, game)

	fmt.Fprintf(os.Stderr, "[规范化] %s：原始参与者 %d 人\n", source, len(rawParticipants))
	if len(rawParticipants) > 0 {
		// 输出第一个参与者的字段名，方便排查数据结构变化
		first := rawParticipants[0]
		keys := make([]string, 0, len(first))
		for k := range first {
			keys = append(keys, k)
		}
		fmt.Fprintf(os.Stderr, "[规范化] 第一个参与者字段：%s\n", strings.Join(keys, ", "))
	}

	var participants []Participant
	for _, p := range rawParticipants {
		participants = append(participants, normalizeParticipant(p))
	}

	// 去重（使用 participantId 或位置作为兜底，避免所有行被合并成一行）
	var unique []Participant
	seen := make(map[string]bool)
	for i, p := range participants {
		// 优先用 accountName+team+championId+championSlug 去重，兜底用索引避免全合并
		key := fmt.Sprintf("%s|%s|%d|%s", p.AccountName, p.Team, p.ChampionID, p.ChampionSlug)
		if p.AccountName == "未知玩家" && p.ChampionSlug == "" {
			// 名字和英雄都解析不出来时，用位置索引保证不丢失数据
			key = fmt.Sprintf("%s|%s|%s|%d", key, p.Position, i)
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		unique = append(unique, p)
	}

	fmt.Fprintf(os.Stderr, "[规范化] 去重后 %d 人，第一个玩家名=%s 英雄=%s\n",
		len(unique),
		func() string {
			if len(unique) > 0 {
				return unique[0].AccountName
			}
			return "N/A"
		}(),
		func() string {
			if len(unique) > 0 {
				return unique[0].ChampionName
			}
			return "N/A"
		}(),
	)

	if len(unique) < 2 {
		return nil, fmt.Errorf("客户端返回的对局中没有完整玩家数据。")
	}

	winner := inferWinner(raw, game, unique)
	gameID := firstStr(
		getString(game, "gameId"),
		getString(raw, "gameId"),
		asString(game["id"]),
	)

	return &MatchData{
		Source:          source,
		CollectedAt:     time.Now().UTC().Format(time.RFC3339),
		GameID:          gameID,
		PlayedAt:        normalizePlayedAt(game),
		DurationSeconds: firstInt(getInt(game, "gameDuration"), getInt(game, "gameLength"), getInt(game, "gameTime")),
		GameMode:        firstStr(getString(game, "gameMode"), getString(game, "queueType"), getString(game, "gameType")),
		Winner:          winner,
		Participants:    unique,
	}, nil
}

// normalizeLiveMatch 规范化 Live Client 对局数据
func normalizeLiveMatch(raw map[string]interface{}) (*MatchData, error) {
	var participants []Participant
	for _, player := range getSlice(raw, "allPlayers") {
		pm, ok := player.(map[string]interface{})
		if !ok {
			continue
		}
		// Live Client API 用 "team" 而非 "teamId"，scores 而非 stats
		normalized := make(map[string]interface{})
		for k, v := range pm {
			normalized[k] = v
		}
		normalized["teamId"] = pm["team"]
		normalized["stats"] = pm["scores"]
		participants = append(participants, normalizeParticipant(normalized))
	}

	if len(participants) < 2 {
		return nil, fmt.Errorf("实时对局中没有完整玩家数据。")
	}

	gameData := getMap(raw, "gameData")
	duration := 0
	playedAt := ""
	if gameData != nil {
		gameTime := asInt(gameData["gameTime"])
		duration = gameTime
		if gameTime > 0 {
			playedAt = time.Now().UTC().Add(-time.Duration(gameTime) * time.Second).Format(time.RFC3339)
		}
	}

	return &MatchData{
		Source:          "Live Client Data API（对局进行中）",
		CollectedAt:     time.Now().UTC().Format(time.RFC3339),
		GameID:          "",
		PlayedAt:        playedAt,
		DurationSeconds: duration,
		GameMode:        getString(gameData, "gameMode"),
		Winner:          "",
		Participants:    participants,
	}, nil
}

// extractGameID 从原始数据提取 gameId
func extractGameID(raw map[string]interface{}) string {
	game := unwrapGame(raw)
	return firstStr(
		getString(game, "gameId"),
		asString(game["id"]),
		getString(raw, "gameId"),
	)
}

// firstNonNil 返回第一个非 nil 值
func firstNonNil(values ...interface{}) interface{} {
	for _, v := range values {
		if v != nil {
			return v
		}
	}
	return nil
}
