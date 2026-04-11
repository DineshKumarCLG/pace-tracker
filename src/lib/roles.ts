export type VisibilityTier = "everyone" | "founders_only" | "admin_only" | "individual_only";

export function isFounder(role: string | null): boolean {
  if (!role) return false;
  const lower = role.toLowerCase();
  return lower.includes("founder") || lower.includes("ceo");
}

export function isAdmin(role: string | null): boolean {
  if (!role) return false;
  const lower = role.toLowerCase();
  return lower.includes("admin") || lower.includes("ceo");
}

export function canAccess(userRole: string | null, tier: VisibilityTier, userId?: string, ownerId?: string): boolean {
  switch (tier) {
    case "everyone": return true;
    case "founders_only": return isFounder(userRole);
    case "admin_only": return isAdmin(userRole);
    case "individual_only": return userId === ownerId;
  }
}
