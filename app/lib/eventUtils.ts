export function getNextEventId(
  events: { id: string; start_time_date: string | null }[],
): string {
  if (!events.length) return "";
  const now = new Date().toISOString();
  const sorted = [...events].sort((a, b) => {
    const aVal = a.start_time_date ?? "";
    const bVal = b.start_time_date ?? "";
    return aVal.localeCompare(bVal);
  });
  const next = sorted.find((e) => (e.start_time_date ?? "") >= now);
  return next?.id ?? sorted[0]?.id ?? "";
}
