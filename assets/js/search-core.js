export function normalizeSearchText(value = "") {
  return String(value)
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/ü/g, "v")
    .replace(/[\s_-]+/g, " ");
}

export function createSearchForms(value, aliases = []) {
  const forms = [value, ...aliases]
    .map(normalizeSearchText)
    .filter(Boolean)
    .flatMap((item) => [item, item.replace(/\s+/g, "")]);
  return [...new Set(forms)];
}

export function isSubsequence(query, candidate) {
  let queryIndex = 0;
  for (const character of candidate) {
    if (character === query[queryIndex]) queryIndex += 1;
    if (queryIndex === query.length) return true;
  }
  return false;
}

export function fuzzyMatches(forms, query) {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);
  if (!terms.length) return true;
  return terms.every((term) => forms.some((form) => (
    form.includes(term) || (term.length > 1 && isSubsequence(term, form))
  )));
}
