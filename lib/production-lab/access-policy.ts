export function canAccessProductionLab(role: string | null | undefined, enabled: string | undefined) {
  return enabled !== "false" && role === "superadmin";
}
