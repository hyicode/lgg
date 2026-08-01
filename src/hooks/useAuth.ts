import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { accountAliases } from "../config/supabase";
import { publishAuthSnapshot, type AuthSnapshot, type MemberProfile } from "../auth/authState";
import { getSupabaseClient, isSupabaseConfigured } from "../services/supabaseClient";

const anonymousSnapshot = (error: string | null = null): AuthSnapshot => ({
  status: "anonymous",
  user: null,
  member: null,
  error,
});

function normalizeAccount(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
}

export function useAuth() {
  const configured = isSupabaseConfigured();
  const client = getSupabaseClient();
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(
    configured
      ? { status: "loading", user: null, member: null, error: null }
      : anonymousSnapshot("Supabase 尚未配置。"),
  );
  const [submitting, setSubmitting] = useState(false);

  const resolveUser = useCallback(async (user: User | null) => {
    if (!client || !user) {
      setSnapshot(anonymousSnapshot());
      return;
    }

    try {
      const { data: profile, error } = await client
        .from("profiles")
        .select("id, username, display_name, role, active")
        .eq("id", user.id)
        .single();
      if (error) throw error;
      if (!profile?.active || !["admin", "member"].includes(profile.role)) {
        throw new Error("账号尚未获得 LGG 使用权限。");
      }

      const member: MemberProfile = {
        username: profile.username,
        displayName: profile.display_name,
        role: profile.role as MemberProfile["role"],
        active: profile.active,
      };
      setSnapshot({ status: "authenticated", user, member, error: null });
    } catch (reason) {
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
      setSnapshot(anonymousSnapshot(reason instanceof Error ? reason.message : "登录状态读取失败，请刷新页面。"));
    }
  }, [client]);

  useEffect(() => {
    if (!client) return;
    let active = true;

    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setSnapshot(anonymousSnapshot("登录状态读取失败，请刷新页面。"));
      else void resolveUser(data.session?.user ?? null);
    });

    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      window.setTimeout(() => {
        if (active) void resolveUser(session?.user ?? null);
      }, 0);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [client, resolveUser]);

  useEffect(() => {
    publishAuthSnapshot(snapshot);
  }, [snapshot]);

  const login = useCallback(async (account: string, password: string) => {
    if (!client) return;
    const normalized = normalizeAccount(account);
    const email = accountAliases[normalized] || account.trim();
    if (!email.includes("@")) {
      setSnapshot(anonymousSnapshot("账号或密码不正确。"));
      return;
    }

    setSubmitting(true);
    setSnapshot(anonymousSnapshot());
    try {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (reason) {
      setSnapshot(anonymousSnapshot(reason instanceof Error ? reason.message : "账号或密码不正确。"));
    } finally {
      setSubmitting(false);
    }
  }, [client]);

  const logout = useCallback(async () => {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    setSnapshot(anonymousSnapshot());
  }, [client]);

  return { configured, login, logout, snapshot, submitting };
}
