import test from "node:test";
import assert from "node:assert/strict";
import { matchCollectedParticipants } from "../assets/js/collector-core.js";

function draftResult(team, playerName, championId, slug) {
  return {
    team,
    player: { id: `player-${playerName}`, name: playerName },
    champion: { id: championId, slug, name: slug },
  };
}

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
