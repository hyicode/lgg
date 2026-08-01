import type { User } from "@supabase/supabase-js";

export interface MemberProfile {
  username: string;
  displayName: string;
  role: "admin" | "member";
  active: boolean;
}

export type AuthSnapshot =
  | { status: "loading"; user: null; member: null; error: null }
  | { status: "anonymous"; user: null; member: null; error: string | null }
  | { status: "authenticated"; user: User; member: MemberProfile; error: null };

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
