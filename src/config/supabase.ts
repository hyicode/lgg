// Publishable key 仅用于浏览器客户端；真正的数据权限由 Supabase RLS 控制。
export const supabaseConfig = {
  enabled: true,
  url: "https://gsswdsuiytprekjgrjqs.supabase.co",
  publishableKey: "sb_publishable_zD_WvoOpt1m19PxPifK1jg_92z8Xabg",
} as const;

// 登录页允许使用短账号名，也兼容直接输入完整邮箱。
export const accountAliases: Readonly<Record<string, string>> = {
  lgg_admin: "lgg_admin@lgg.app",
  lgg: "lgg@lgg.app",
};
