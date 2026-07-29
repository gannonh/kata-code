export function shortTaskWorkspaceId(id: string | null): string {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}
