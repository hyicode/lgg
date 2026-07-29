import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLcuMatch, normalizeLiveMatch } from "../collector/bridge-core.mjs";
import { matchCollectedParticipants } from "../assets/js/collector-core.js";

function draftResult(team, playerName, championId, slug) {
  return {
    team,
    player: { id: `player-${playerName}`, name: playerName },
    champion: { id: championId, slug, name: slug },
  };
}

test("标准化国服客户端赛后数据", () => {
  const result = normalizeLcuMatch({
    games: {
      games: [{
        gameId: 12345,
        gameCreation: 1785326400000,
        gameDuration: 1860,
        gameMode: "CLASSIC",
        participants: [
          {
            summonerName: "Alice#CN1",
            teamId: 100,
            championId: 1,
            championName: "Annie",
            stats: [
              { name: "WIN", value: true },
              { name: "CHAMPIONS_KILLED", value: 10 },
              { name: "NUM_DEATHS", value: 2 },
              { name: "ASSISTS", value: 8 },
              { name: "MINIONS_KILLED", value: 190 },
              { name: "NEUTRAL_MINIONS_KILLED", value: 10 }
            ],
          },
          {
            summonerName: "Bob#CN1",
            teamId: 200,
            championId: 122,
            championName: "Darius",
            stats: { win: false, kills: 2, deaths: 10, assists: 3, minionsKilled: 180 },
          },
        ],
      }],
    },
  });

  assert.equal(result.gameId, "12345");
  assert.equal(result.winner, "blue");
  assert.equal(result.participants[0].stats.kills, 10);
  assert.equal(result.participants[0].stats.creepScore, 200);
});

test("标准化游戏内实时接口数据", () => {
  const result = normalizeLiveMatch({
    gameData: { gameMode: "CLASSIC", gameTime: 600 },
    allPlayers: [
      {
        riotId: "Alice#CN1",
        championName: "Annie",
        team: "ORDER",
        scores: { kills: 3, deaths: 1, assists: 4, creepScore: 80 },
      },
      {
        riotId: "Bob#CN1",
        championName: "Darius",
        team: "CHAOS",
        scores: { kills: 1, deaths: 3, assists: 2, creepScore: 70 },
      },
    ],
  });
  assert.equal(result.participants[0].team, "blue");
  assert.equal(result.participants[1].team, "red");
  assert.equal(result.winner, "");
});

test("按队伍和英雄把客户端玩家映射回当前 Roll 结果", () => {
  const results = [
    draftResult("blue", "小明", 1, "annie"),
    draftResult("red", "小王", 122, "darius"),
  ];
  const participants = [
    {
      accountName: "Alice#CN1",
      team: "blue",
      championId: 1,
      championName: "Annie",
      championSlug: "annie",
      stats: { kills: 10, deaths: 2, assists: 8, creepScore: 200 },
    },
    {
      accountName: "Bob#CN1",
      team: "red",
      championId: 122,
      championName: "Darius",
      championSlug: "darius",
      stats: { kills: 2, deaths: 10, assists: 3, creepScore: 180 },
    },
  ];
  const mapping = matchCollectedParticipants(results, participants);
  assert.equal(mapping.unmatched.length, 0);
  assert.equal(mapping.rows[0].participant.accountName, "Alice#CN1");
  assert.equal(mapping.rows[1].participant.stats.deaths, 10);
});

test("拒绝与当前 Roll 英雄不一致的对局", () => {
  const mapping = matchCollectedParticipants(
    [draftResult("blue", "小明", 1, "annie")],
    [{ accountName: "Other", team: "red", championId: 22, championName: "Ashe", championSlug: "ashe" }],
  );
  assert.equal(mapping.unmatched.length, 1);
});
