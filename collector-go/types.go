package main

// MatchData 归一化后的对局数据
type MatchData struct {
	Source          string        `json:"source"`
	CollectedAt     string        `json:"collectedAt"`
	GameID          string        `json:"gameId"`
	PlayedAt        string        `json:"playedAt"`
	DurationSeconds int           `json:"durationSeconds"`
	GameMode        string        `json:"gameMode"`
	Winner          string        `json:"winner"`
	Participants    []Participant `json:"participants"`
}

// Participant 对局玩家
type Participant struct {
	AccountName  string      `json:"accountName"`
	Team         string      `json:"team"`
	Position     string      `json:"position"`
	ChampionID   int         `json:"championId"`
	ChampionName string      `json:"championName"`
	ChampionSlug string      `json:"championSlug"`
	Win          *bool       `json:"win"`
	Stats        PlayerStats `json:"stats"`
}

// PlayerStats 玩家统计数据
type PlayerStats struct {
	Kills       int `json:"kills"`
	Deaths      int `json:"deaths"`
	Assists     int `json:"assists"`
	CreepScore  int `json:"creepScore"`
	GoldEarned  int `json:"goldEarned"`
	VisionScore int `json:"visionScore"`
	DamageDealt int `json:"damageDealt"`
	Level       int `json:"level"`
}

// ErrorResponse 错误响应
type ErrorResponse struct {
	Error   string `json:"error,omitempty"`
	OK      bool   `json:"ok,omitempty"`
	Service string `json:"service,omitempty"`
}
