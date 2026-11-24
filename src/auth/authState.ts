export interface MemberProfile {
  username: string;
  displayName: string;
  role: "admin" | "member" | "guest";
  active: boolean;
}

export type AuthSnapshot =
  | { status: "guest"; user: null; member: MemberProfile; error: null }
  | { status: "loading"; user: null; member: null; error: null }
  | { status: "anonymous"; user: null; member: null; error: string | null }
  | { status: "authenticated"; user: null; member: MemberProfile; error: null };

type AuthSubscriber = (snapshot: AuthSnapshot) => void;

let currentSnapshot: AuthSnapshot = { status: "loading", user: null, member: null, error: null };
const subscribers = new Set<AuthSubscriber>();

export function publishAuthSnapshot(snapshot: AuthSnapshot): void {
  currentSnapshot = snapshot;
  subscribers.forEach((subscriber) => subscriber(snapshot));
}

export function subscribeAuthSnapshot(subscriber: AuthSubscriber): () => void {
  subscribers.add(subscriber);
  subscriber(currentSnapshot);
  return () => subscribers.delete(subscriber);
}
