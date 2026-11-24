import { useEffect } from "react";
import { publishAuthSnapshot, type AuthSnapshot } from "../auth/authState";
import { cloudSession } from "../auth/cloudSession";
const guestSnapshot: AuthSnapshot = cloudSession ? {
  status: "authenticated", user: null, error: null,
  member: { username: cloudSession.role, displayName: cloudSession.role === 'admin' ? '管理员' : '成员', role: cloudSession.role, active: true },
} : {
  status: "guest", user: null, error: null,
  member: { username: "guest", displayName: "游客", role: "guest", active: true },
};
export function useAuth() {
  useEffect(() => { publishAuthSnapshot(guestSnapshot); }, []);
  return { snapshot: guestSnapshot };
}
