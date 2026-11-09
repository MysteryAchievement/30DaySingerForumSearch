import he from "he";

function decode(input: string): string {
  let value = input;
  for (let i = 0; i < 2; i += 1) {
    const next = he.decode(value);
    if (next === value) break;
    value = next;
  }
  return value;
}

export function cleanText(input: string): string {
  return decode(input)
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeForMatch(input: string): string {
  return cleanText(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function unescapeEntities(input: string): string {
  return decode(input);
}

export function stableBodyText(input: string): string {
  return cleanText(input);
}
