function normalize(value = "") {
  return String(value).normalize("NFKC").trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
}

export function championSlug(value = "") {
  return String(value).normalize("NFKD").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function participantScore(result, participant) {
  const sameTeam = result.team === participant.team;
  const draftChampionId = Number(result.champion.id || 0);
  const sameChampionId = draftChampionId > 0
    && draftChampionId === Number(participant.championId || 0);
  const sameChampionSlug = championSlug(result.champion.slug)
    && championSlug(result.champion.slug) === championSlug(participant.championSlug || participant.championName);
  const draftName = normalize(result.player.name);
  const accountName = normalize(participant.accountName).split("#")[0];
  const sameName = draftName === accountName || normalize(participant.accountName) === draftName;

  if (!sameName && !(sameTeam && (sameChampionId || sameChampionSlug))) return -1;
  return (sameName ? 200 : 0)
    + (sameTeam ? 80 : 0)
    + (sameChampionId ? 140 : 0)
    + (sameChampionSlug ? 120 : 0);
}

export function matchCollectedParticipants(results, participants) {
  const remaining = [...participants];
  const rows = [];
  const unmatched = [];

  for (const result of results) {
    const ranked = remaining
      .map((participant, index) => ({ participant, index, score: participantScore(result, participant) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best || best.score < 0) {
      unmatched.push(result);
      continue;
    }
    remaining.splice(best.index, 1);
    rows.push({ result, participant: best.participant });
  }

  return { rows, unmatched, unused: remaining };
}
