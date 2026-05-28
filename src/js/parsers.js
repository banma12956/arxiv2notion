// MIT License
// Copyright (c) 2024 denkiwakame <denkivvakame@gmail.com>

class URLParser {
  constructor() {
    this.parsers = [];
  }

  addParser(domain, handler) {
    this.parsers.push({ domain, handler });
  }

  async parse(url) {
    for (let { domain, handler } of this.parsers) {
      if (url?.startsWith(domain)) return handler(url);
    }
    throw new Error('No perser found for the given URL');
  }
}

const arXivParser = async (url) => {
  const ARXIV_API = 'https://export.arxiv.org/api/query';
  const API_TIMEOUT_MS = 8000;
  // ref: https://info.arxiv.org/help/arxiv_identifier.html
  // e.g. (new id format: 2404.16782) | (old id format: hep-th/0702063)
  const parseArXivId = (str) => {
    const raw = String(str || '').trim();
    let value = raw;
    try {
      value = new URL(raw).pathname;
    } catch (_) {
      // raw may already be an arXiv id rather than a URL.
    }

    value = decodeURIComponent(value)
      .replace(/^\/?(abs|pdf)\//, '')
      .replace(/\.pdf$/, '')
      .replace(/\/$/, '');

    const match = value.match(
      /((\d{4}\.\d{4,5}|([a-z-]+(\.[A-Z]{2})?\/\d{7}))(v\d+)?)$/i
    );
    return match?.[1]?.replace(/v\d+$/i, '');
  };

  const formatArXivAuthor = (name) => {
    const parts = name.split(',').map((part) => part.trim());
    return parts.length === 2 ? `${parts[1]} ${parts[0]}` : name.trim();
  };

  const parseArXivDate = (date) => {
    if (!date) return '';
    return date.replaceAll('/', '-').split('T')[0];
  };

  const parseFromArXivHtml = async (paperId) => {
    const res = await fetch(`https://arxiv.org/abs/${paperId}`, {
      method: 'GET',
      mode: 'cors',
    });
    if (!res.ok) {
      throw new Error(`arxiv.org request failed with status: ${res.status}`);
    }

    const html = await res.text();
    const xml = new window.DOMParser().parseFromString(html, 'text/html');
    const getMeta = (name) =>
      xml.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '';
    const paperTitle = getMeta('citation_title');
    const authors = Array.from(xml.querySelectorAll('meta[name="citation_author"]'))
      .map((author) => formatArXivAuthor(author.getAttribute('content') || ''))
      .filter(Boolean);
    const abst = getMeta('citation_abstract').replace(/\n/g, ' ').trim();
    const published = parseArXivDate(
      getMeta('citation_online_date') || getMeta('citation_date')
    );

    if (!paperTitle) throw new Error(`No arXiv metadata found for id: ${paperId}`);

    return {
      id: paperId,
      title: paperTitle,
      abst: abst,
      authors: authors,
      url: `https://arxiv.org/abs/${paperId}`,
      published: published,
      comment: 'none',
      publisher: 'arXiv',
    };
  };

  const fetchWithTimeout = async (fetchUrl, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      return await fetch(fetchUrl, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  const paperId = parseArXivId(url);
  if (!paperId) throw new Error(`Could not parse arXiv id from URL: ${url}`);

  try {
    return await parseFromArXivHtml(paperId);
  } catch (err) {
    console.warn('arxiv.org HTML parse failed; falling back to arXiv API.', err);
  }

  let res;
  try {
    res = await fetchWithTimeout(ARXIV_API + '?id_list=' + paperId.toString(), {
      method: 'GET',
      mode: 'cors',
      headers: {
        Accept: 'application/atom+xml',
      },
    });
  } catch (err) {
    console.warn('arXiv API request failed; falling back to arxiv.org HTML.', err);
    return parseFromArXivHtml(paperId);
  }
  if (!res.ok) {
    console.warn('arXiv API request failed with status:', res.status);
    return parseFromArXivHtml(paperId);
  }
  const data = await res.text(); // TODO: error handling
  console.log(res.status);
  const xmlData = new window.DOMParser().parseFromString(data, 'text/xml');
  console.log(xmlData);

  const entry = xmlData.querySelector('entry');
  if (!entry) return parseFromArXivHtml(paperId);

  const id = parseArXivId(entry.querySelector('id')?.textContent);
  const paperTitle = entry.querySelector('title').textContent;
  const abst = entry.querySelector('summary').textContent.replace(/\n/g, ' ').trim();
  const authors = Array.from(entry.querySelectorAll('author')).map((author) => {
    return author.textContent.trim();
  });
  const published = entry.querySelector('published').textContent;
  const comment = entry.querySelector('comment')?.textContent ?? 'none';

  return {
    id: id,
    title: paperTitle,
    abst: abst,
    authors: authors,
    url: url,
    published: published,
    comment: comment,
    publisher: 'arXiv',
  };
};

const openReviewParser = async (url) => {
  const id = new URLSearchParams(new URL(url).search).get('id');
  const res = await fetch(url);
  const html = await res.text();
  const parser = new DOMParser();
  const xml = parser.parseFromString(html, 'text/html');

  const authorsArray = Array.from(
    xml.querySelectorAll('meta[name="citation_author"]'),
    (author) => author.getAttribute('content')
  );
  const authors = authorsArray.length ? authorsArray : ['Anonymous'];

  const paperTitle = xml
    .querySelector('meta[name="citation_title"]')
    .getAttribute('content');

  const abst = xml
    .querySelector('meta[name="citation_abstract"]')
    .getAttribute('content')
    .replace(/\n/g, ' ')
    .trim();

  const date = xml
    .querySelector('meta[name="citation_online_date"]')
    .getAttribute('content');
  // -> ISO 8601 date string
  const published = new Date(date).toISOString().split('T')[0];
  const comment = 'none';

  return {
    id: id,
    title: paperTitle,
    abst: abst,
    authors: authors,
    url: url,
    published: published,
    comment: comment,
    publisher: 'OpenReview',
  };
};

const aclAnthologyParser = async (url) => {
  const res = await fetch(url);
  const html = await res.text();
  const parser = new DOMParser();
  const xml = parser.parseFromString(html, 'text/html');

  const id = xml
    .querySelector('meta[name="citation_doi"]')
    .getAttribute('content');
  const authors = Array.from(
    xml.querySelectorAll('meta[name="citation_author"]'),
    (author) => author.getAttribute('content')
  );

  const paperTitle = xml
    .querySelector('meta[name="citation_title"]')
    .getAttribute('content');

  const abst = 'none';
  const date = xml
    .querySelector('meta[name="citation_publication_date"]')
    .getAttribute('content');
  // -> ISO 8601 date string
  const published = new Date(date).toISOString().split('T')[0];
  const publisher = xml
    .querySelectorAll('.acl-paper-details dd')[6]
    .textContent.replaceAll('\n', '');
  const comment = xml
    .querySelector('meta[name="citation_pdf_url"]')
    .getAttribute('content');
  return {
    id: id,
    title: paperTitle,
    abst: abst,
    authors: authors,
    url: url,
    published: published,
    comment: comment,
    publisher: publisher,
  };
};

const urlParser = new URLParser();
urlParser.addParser('https://openreview.net/', openReviewParser);
urlParser.addParser('https://arxiv.org', arXivParser);
urlParser.addParser('https://www.arxiv.org', arXivParser);
urlParser.addParser('https://aclanthology.org', aclAnthologyParser);

export default urlParser;
