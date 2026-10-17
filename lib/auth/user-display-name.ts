const names: Record<string, string> = {
  loy27felix: "乐美林", daysydeng: "邓念", daisydeng: "邓念", yujieluo: "罗雨婕",
  siyuanzhao: "赵斯源", qishuangyin: "尹奇双", freesiashang: "尚雨欣", yuzhang: "张毓", gaochence: "高琛策",
};

export function userDisplayName(email: string): string {
  const username = email.trim().toLowerCase().split("@")[0];
  return names[username] || email.replace(/@.*/, "") || "创作者";
}
