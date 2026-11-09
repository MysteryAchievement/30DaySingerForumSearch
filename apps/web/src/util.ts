export function highlightTerms(query: string): string[] {
  const unique = new Set<string>();
  const tokens = query.match(/"[^"]*"|\S+/g) ?? [];

  for (const rawToken of tokens) {
    if (rawToken.startsWith("-")) continue;
    const token = rawToken.replace(/"/g, "");
    if (/^(or|and|not)$/i.test(token)) continue;
    for (const term of token.match(/[a-zA-Z0-9']+/g) ?? []) {
      if (term.length < 2) continue;
      unique.add(term);
    }
  }

  return [...unique];
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown date";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}
