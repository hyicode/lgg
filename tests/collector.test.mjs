import test from "node:test";
import assert from "node:assert/strict";
import {
  assignParticipantsToFixedSlots,
  collectedMatchProblems,
  matchCollectedParticipants,
  normalizeClientPositionKey,
  normalizeClientTeam,
  riotIdFromClientPlayer,
} from "../src/domain/collector.ts";

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

test("兼容客户端位置、队伍和完整 Riot ID 字段", () => {
  assert.equal(normalizeClientPositionKey("TOP_LANE"), "top");
  assert.equal(normalizeClientPositionKey("", "BOT_LANE", "DUO_SUPPORT"), "support");
  assert.equal(normalizeClientPositionKey("", "BOTTOM", "DUO_CARRY"), "bottom");
  assert.equal(normalizeClientTeam(100), "blue");
  assert.equal(normalizeClientTeam(200), "red");
  assert.equal(normalizeClientTeam(0, "UNKNOWN"), "");
  assert.equal(riotIdFromClientPlayer({ gameName: "同名玩家", tagLine: "CN1", summonerName: "legacy" }), "同名玩家#CN1");
  assert.equal(riotIdFromClientPlayer({ riotIdGameName: "玩家", riotIdTagLine: "1234" }), "玩家#1234");
});

function completeCollectedMatch() {
  const positions = ["top", "jungle", "middle", "bottom", "support"];
  return {
    gameId: "HN1_123",
    playedAt: "2026-07-31T12:00:00.000Z",
    mapId: 11,
    gameMode: "CLASSIC",
    winner: "blue",
    participants: ["blue", "red"].flatMap((team, teamIndex) => positions.map((position, positionIndex) => ({
      team,
      position,
      accountName: `玩家${teamIndex}-${positionIndex}#CN1`,
      championId: teamIndex * 10 + positionIndex + 1,
      championName: `Hero${teamIndex}-${positionIndex}`,
    }))),
  };
}

test("完整召唤师峡谷十人数据通过采集校验", () => {
  assert.deepEqual(collectedMatchProblems(completeCollectedMatch(), { requireWinner: true }), []);
});

test("拒绝人数不足、账号重复、位置不完整和错误地图", () => {
  const match = completeCollectedMatch();
  match.mapId = 12;
  match.participants.pop();
  match.participants[1].accountName = match.participants[0].accountName;
  match.participants[2].position = "";
  const problems = collectedMatchProblems(match);
  assert.ok(problems.some((problem) => problem.includes("地图不是召唤师峡谷")));
  assert.ok(problems.some((problem) => problem.includes("参与者不是 10 人")));
  assert.ok(problems.some((problem) => problem.includes("游戏 ID 重复")));
  assert.ok(problems.some((problem) => problem.includes("缺少有效位置")));
});

test("历史列表可忽略位置问题但仍校验其他对局数据", () => {
  const match = completeCollectedMatch();
  match.participants[0].position = "";
  match.participants[1].position = "middle";
  const strictProblems = collectedMatchProblems(match);
  const historyProblems = collectedMatchProblems(match, { requirePositions: false });

  assert.ok(strictProblems.some((problem) => problem.includes("缺少有效位置")));
  assert.ok(strictProblems.some((problem) => problem.includes("位置数据不完整或重复")));
  assert.equal(historyProblems.some((problem) => problem.includes("位置")), false);

  match.participants.pop();
  assert.ok(collectedMatchProblems(match, { requirePositions: false })
    .some((problem) => problem.includes("参与者不是 10 人")));
});

test("固定位置槽保留唯一预测并将重复位置按原顺序补入空槽", () => {
  const positions = ["jungle", "jungle", "middle", "bottom", "support"];
  const participants = ["blue", "red"].flatMap((team) =>
    positions.map((position, index) => ({ team, position, accountName: `${team}-${index}` })));
  const slots = assignParticipantsToFixedSlots(participants);
  const blue = slots.filter((slot) => slot.team === "blue");

  assert.deepEqual(blue.map((slot) => slot.position), ["top", "jungle", "middle", "bottom", "support"]);
  assert.deepEqual(blue.map((slot) => slot.participantIdx), [0, 1, 2, 3, 4]);
  assert.equal(participants[blue[0].participantIdx].position, "jungle");
});
