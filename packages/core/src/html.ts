export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const HIGHLIGHT_START = "[[[HL]]]";
const HIGHLIGHT_END = "[[[/HL]]]";

export const HEADLINE_OPTIONS =
  `StartSel=${HIGHLIGHT_START}, StopSel=${HIGHLIGHT_END}, ` +
  `MaxFragments=2, MinWords=8, MaxWords=20, FragmentDelimiter=" … "`;

export function renderHighlight(raw: string): string {
  return escapeHtml(raw)
    .split(HIGHLIGHT_START)
    .join("<mark>")
    .split(HIGHLIGHT_END)
    .join("</mark>");
}
