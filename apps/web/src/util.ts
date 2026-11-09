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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlightHtml(html: string, query: string | null): string {
  if (!query) return html;
  const terms = highlightTerms(query);
  if (terms.length === 0) return html;

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const node of textNodes) {
    const text = node.nodeValue ?? "";
    pattern.lastIndex = 0;
    const matches = [...text.matchAll(pattern)];
    if (matches.length === 0) continue;

    const fragment = doc.createDocumentFragment();
    let lastIndex = 0;
    for (const match of matches) {
      const index = match.index ?? 0;
      if (index > lastIndex) {
        fragment.appendChild(doc.createTextNode(text.slice(lastIndex, index)));
      }
      const mark = doc.createElement("mark");
      mark.textContent = match[0];
      fragment.appendChild(mark);
      lastIndex = index + match[0].length;
    }
    if (lastIndex < text.length) {
      fragment.appendChild(doc.createTextNode(text.slice(lastIndex)));
    }
    node.parentNode?.replaceChild(fragment, node);
  }

  return doc.body.innerHTML;
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
