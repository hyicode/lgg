export type DraftTeam = "blue" | "red";

interface DraftSlotBase {
  team: DraftTeam;
  position: string;
}

interface HeroDraftSlot<TChampion> extends DraftSlotBase {
  champion: TChampion;
}

export function draftSlotKey(slot: DraftSlotBase): string {
  return `${slot.team}:${slot.position}`;
}

export function bindDraftChampions<TSlot extends DraftSlotBase, TChampion>(
  playerSlots: readonly TSlot[],
  heroDraft: readonly HeroDraftSlot<TChampion>[],
): Array<TSlot & { champion: TChampion }> {
  const champions = new Map<string, TChampion>();

  for (const slot of heroDraft) {
    const key = draftSlotKey(slot);
    if (champions.has(key)) throw new Error(`英雄阵容存在重复槽位：${key}`);
    champions.set(key, slot.champion);
  }

  return playerSlots.map((slot) => {
    const key = draftSlotKey(slot);
    const champion = champions.get(key);
    if (champion === undefined) throw new Error(`英雄阵容缺少槽位：${key}`);
    return { ...slot, champion };
  });
}
