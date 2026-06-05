// MIT License
// Copyright (c) 2021 denkiwakame <denkivvakame@gmail.com>

export function makeRichText(content) {
  if (!content) {
    return { rich_text: [] };
  }
  return {
    rich_text: [
      {
        type: 'text',
        text: {
          content: String(content),
        },
      },
    ],
  };
}

export function makeAuthorsProperty(authors, authorsPropertyType) {
  const safeAuthors = Array.isArray(authors) ? authors : [];

  if (authorsPropertyType === 'rich_text') {
    return makeRichText(safeAuthors.join(', '));
  }

  if (authorsPropertyType === 'multi_select') {
    return {
      multi_select: safeAuthors.map((author) => ({ name: author })),
    };
  }

  throw new Error(
    'Authors must be a Text property (rich_text). Multi-Select is still supported for legacy databases.'
  );
}

function isUrl(value) {
  return /^https?:\/\//.test(String(value || ''));
}

function validateTargetDatabase(database) {
  const properties = database.properties || {};
  const requiredTypes = {
    Title: ['title'],
    URL: ['url'],
    Authors: ['rich_text', 'multi_select'],
    Published: ['date'],
    Publisher: ['select'],
  };

  const errors = Object.entries(requiredTypes).flatMap(([name, types]) => {
    const actualType = properties[name]?.type;
    if (types.includes(actualType)) return [];
    return `${name} must be ${types.join(' or ')}; got ${
      actualType || 'missing'
    }`;
  });

  if (errors.length) {
    throw new Error(
      `Selected database is not compatible: ${errors.join('; ')}`
    );
  }
}

export default class Notion {
  constructor() {
    this.token = null;
    this.apiBase = 'https://api.notion.com/v1/';
  }

  torkenizedHeaders() {
    return {
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
      Authorization: `Bearer ${this.token}`,
    };
  }

  async request(path, options = {}) {
    const res = await fetch(this.apiBase + path, {
      mode: 'cors',
      headers: this.torkenizedHeaders(),
      ...options,
    });
    let data;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    if (!res.ok) {
      throw new Error(
        data?.message || `Notion API request failed: ${res.status}`
      );
    }
    return data;
  }

  async requestToken(botId) {
    const url = 'https://www.notion.so/api/v3/getBotToken';
    const body = { botId: botId };
    const headers = {
      Accept: 'application/json, */*',
      'Content-type': 'application/json',
    };
    const res = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: headers,
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(
        data?.message || 'Failed to request Notion integration token.'
      );
    }
    return data;
  }

  async retrievePage(pageId) {
    try {
      const data = await this.request(`pages/${pageId}`, {
        method: 'GET',
      });
      console.log(data);
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  async checkDuplicateEntry(paperId, databaseId) {
    const entries = await this.retrieveEntry(paperId, databaseId);
    if (entries.length != 0) {
      document.dispatchEvent(
        new CustomEvent('msg', {
          detail: {
            type: 'warning',
            msg: 'This item is already bookmarked.',
          },
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return entries;
  }

  async retrieveEntry(paperId, databaseId) {
    const filter = {
      property: 'URL',
      url: {
        contains: `${paperId}`,
      },
    };

    try {
      const data = await this.request(`databases/${databaseId}/query`, {
        method: 'POST',
        body: JSON.stringify({
          filter: filter,
        }),
      });
      return data.results || [];
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  async retrieveDatabaseInfo(databaseId) {
    try {
      return await this.request(`databases/${databaseId}`, {
        method: 'GET',
      });
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  async retrieveAuthorsPropertyType(databaseId) {
    const database = await this.retrieveDatabaseInfo(databaseId);
    const authorsPropertyType = database.properties?.Authors?.type;
    return authorsPropertyType;
  }

  async createPage(_data) {
    const data = await _data;
    if (!data) throw new Error('Paper metadata is still loading.');
    const databaseId = document.getElementById('js-select-database').value;
    if (!databaseId) throw new Error('Select a Notion database before saving.');

    const database = await this.retrieveDatabaseInfo(databaseId);
    validateTargetDatabase(database);

    // XXX check if the entry has already been bookmarked
    const duplicateEntries = await this.checkDuplicateEntry(
      data.id,
      databaseId
    );
    if (duplicateEntries.length != 0) return duplicateEntries[0];

    const title = data.title;
    const paperUrl = data.url;
    const authors = Array.isArray(data.authors) ? data.authors : [];
    const authorsPropertyType = database.properties?.Authors?.type;
    const published = data.published;
    const publisher = data.publisher;
    const comment = data.comment;

    try {
      const parent = {
        type: 'database_id',
        database_id: databaseId,
      };
      const properties = {
        Title: {
          id: 'title',
          type: 'title',
          title: [{ text: { content: title } }],
        },
        Publisher: {
          id: 'conference',
          type: 'select',
          select: { name: publisher },
        },
        URL: {
          id: 'url',
          type: 'url',
          url: paperUrl,
        },
        Authors: makeAuthorsProperty(authors, authorsPropertyType),
        Published: {
          id: 'published',
          type: 'date',
          date: published ? { start: published, end: null } : null,
        },
      };
      if (database.properties?.Comments?.type === 'url') {
        properties.Comments = {
          id: 'comment',
          type: 'url',
          url: isUrl(comment) ? comment : null,
        };
      }

      const body = {
        parent: parent,
        properties: properties,
      };
      const data = await this.request('pages', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      console.log(data);
      return data;
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  async retrieveDatabase() {
    try {
      // /v1/databases is deprecated since Notion API version: 2022-06-28
      // https://developers.notion.com/reference/get-databases
      // https://developers.notion.com/reference/post-search
      const data = await this.request('search', {
        method: 'POST',
        body: JSON.stringify({
          filter: { value: 'database', property: 'object' },
        }),
      });
      const select = document.getElementById('js-select-database');
      select.innerHTML = '';
      data.results?.forEach((result) => {
        const option = document.createElement('option');
        option.value = result.id;
        option.textContent = result.title[0]?.plain_text || 'Untitled database';
        select.appendChild(option);
      });
      return data.results || [];
    } catch (err) {
      console.error(err);
      throw err;
    }
  }
}
