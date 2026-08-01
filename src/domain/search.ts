export function normalizeSearchText(value: unknown = ""): string {
  return String(value)
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/ü/g, "v")
    .replace(/[\s_-]+/g, " ");
}

export function createSearchForms(value: unknown, aliases: unknown[] = []): string[] {
  const forms = [value, ...aliases]
    .map(normalizeSearchText)
    .filter(Boolean)
    .flatMap((item) => [item, item.replace(/\s+/g, "")]);
  return [...new Set(forms)];
}

export function isSubsequence(query: string, candidate: string): boolean {
  let queryIndex = 0;
  for (const character of candidate) {
    if (character === query[queryIndex]) queryIndex += 1;
    if (queryIndex === query.length) return true;
  }
  return false;
}

export function fuzzyMatches(forms: string[], query: unknown): boolean {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);
  if (!terms.length) return true;
  return terms.every((term) => forms.some((form) => (
    form.includes(term) || (term.length > 1 && isSubsequence(term, form))
  )));
}
