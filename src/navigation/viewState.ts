export type ViewId = "rollView" | "historyView" | "leaderboardView" | "adminView";

type ViewSubscriber = (view: ViewId) => void;

let currentView: ViewId = "rollView";
const subscribers = new Set<ViewSubscriber>();

export function canAccessView(view: ViewId, admin: boolean): boolean {
  return view !== "adminView" || admin;
}

export function publishActiveView(view: ViewId): void {
  currentView = view;
  subscribers.forEach((subscriber) => subscriber(view));
}

export function subscribeActiveView(subscriber: ViewSubscriber): () => void {
  subscribers.add(subscriber);
  subscriber(currentView);
  return () => subscribers.delete(subscriber);
}
