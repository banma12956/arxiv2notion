const FETCH_TIMEOUT_MS = 6000;

const fetchJson = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok)
      throw new Error(`Citation request failed: ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const fetchText = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: 'include',
    });
    if (!response.ok)
      throw new Error(`Citation request failed: ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeTitle = (title) =>
  String(title || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const matchingItem = (items, title, getTitle) => {
  const normalized = normalizeTitle(title);
  return items.find((item) => normalizeTitle(getTitle(item)) === normalized);
};

const semanticScholarIdentifier = (paper) => {
  if (paper.publisher === 'arXiv' && paper.id) return `ARXIV:${paper.id}`;
  if (/^10\.\d{4,9}\//i.test(paper.id || '')) return `DOI:${paper.id}`;
  return null;
};

const fromGoogleScholar = async (paper) => {
  const query = `"${paper.title}"`;
  const html = await fetchText(
    `https://scholar.google.com/scholar?hl=en&q=${encodeURIComponent(query)}`
  );
  const document = new DOMParser().parseFromString(html, 'text/html');
  const results = Array.from(document.querySelectorAll('.gs_ri'));
  const match = matchingItem(results, paper.title, (item) => {
    return item.querySelector('.gs_rt a')?.textContent || '';
  });
  if (!match) return null;

  const citedBy = Array.from(match.querySelectorAll('.gs_fl a')).find((link) =>
    /^Cited by \d+$/.test(link.textContent.trim())
  );
  const count = Number(citedBy?.textContent.match(/\d+/)?.[0]);
  return Number.isInteger(count) ? count : null;
};

const fromSemanticScholar = async (paper) => {
  const fields = 'title,citationCount';
  const identifier = semanticScholarIdentifier(paper);
  if (identifier) {
    const result = await fetchJson(
      `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(
        identifier
      )}?fields=${fields}`
    );
    if (Number.isInteger(result.citationCount)) return result.citationCount;
  }

  const result = await fetchJson(
    `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(
      paper.title
    )}&limit=5&fields=${fields}`
  );
  const match = matchingItem(
    result.data || [],
    paper.title,
    (item) => item.title
  );
  return Number.isInteger(match?.citationCount) ? match.citationCount : null;
};

const fromOpenAlex = async (paper) => {
  const result = await fetchJson(
    `https://api.openalex.org/works?search=${encodeURIComponent(
      paper.title
    )}&per_page=5&select=display_name,cited_by_count`
  );
  const match = matchingItem(
    result.results || [],
    paper.title,
    (item) => item.display_name
  );
  return Number.isInteger(match?.cited_by_count) ? match.cited_by_count : null;
};

const fromCrossref = async (paper) => {
  const result = await fetchJson(
    `https://api.crossref.org/works?query.title=${encodeURIComponent(
      paper.title
    )}&rows=5&select=title,is-referenced-by-count`
  );
  const match = matchingItem(
    result.message?.items || [],
    paper.title,
    (item) => item.title?.[0]
  );
  const count = match?.['is-referenced-by-count'];
  return Number.isInteger(count) ? count : null;
};

const providers = [
  ['Google Scholar', fromGoogleScholar],
  ['Semantic Scholar', fromSemanticScholar],
  ['OpenAlex', fromOpenAlex],
  ['Crossref', fromCrossref],
];

export async function retrieveCitationCount(paper) {
  const lookups = providers.map(async ([source, retrieve]) => {
    try {
      const count = await retrieve(paper);
      return count === null ? null : { count, source };
    } catch (err) {
      console.warn(`${source} citation lookup failed.`, err);
      return null;
    }
  });
  const results = (await Promise.all(lookups)).filter(Boolean);
  return results.reduce((best, result) => {
    return !best || result.count > best.count ? result : best;
  }, null);
}
