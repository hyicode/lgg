import type { SharedDataSnapshot } from "./models";

type DataSubscriber = (snapshot: SharedDataSnapshot) => void;
type RefreshSubscriber = () => void | Promise<void>;

export const emptySharedData = (): SharedDataSnapshot => ({
  players: [],
  matches: [],
  riotAccounts: new Map(),
  playerStats: new Map(),
});

let currentSnapshot = emptySharedData();
const dataSubscribers = new Set<DataSubscriber>();
const refreshSubscribers = new Set<RefreshSubscriber>();

export function publishSharedData(snapshot: SharedDataSnapshot): void {
  currentSnapshot = snapshot;
  dataSubscribers.forEach((subscriber) => subscriber(snapshot));
}

export function subscribeSharedData(subscriber: DataSubscriber): () => void {
  dataSubscribers.add(subscriber);
  subscriber(currentSnapshot);
  return () => dataSubscribers.delete(subscriber);
}

export async function requestSharedDataRefresh(): Promise<void> {
  await Promise.all([...refreshSubscribers].map((subscriber) => subscriber()));
}

export function subscribeSharedDataRefresh(subscriber: RefreshSubscriber): () => void {
  refreshSubscribers.add(subscriber);
  return () => refreshSubscribers.delete(subscriber);
}
