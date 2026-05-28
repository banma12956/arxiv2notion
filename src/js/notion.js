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
    return data;
  }

  async retrievePage(pageId) {
    try {
      const url = this.apiBase + `pages/${pageId}`;
      const res = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        headers: this.torkenizedHeaders(),
      });
      const data = await res.json();
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
            msg: 'This item is already bookmarked. Opening existing entry...',
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
      rich_text: {
        contains: `${paperId}`,
      },
    };

    try {
      const url = this.apiBase + `databases/${databaseId}/query`;
      const body = {
        filter: filter,
      };
      const res = await fetch(url, {
        method: 'POST',
        mode: 'cors',
        headers: this.torkenizedHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return data.results;
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  async retrieveDatabaseInfo(databaseId) {
    try {
      const url = this.apiBase + `databases/${databaseId}`;
      const res = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        headers: this.torkenizedHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to retrieve Notion database.');
      }
      return data;
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
    const databaseId = document.getElementById('js-select-database').value;

    // XXX check if the entry has already been bookmarked
    const duplicateEntries = await this.checkDuplicateEntry(
      data.id,
      databaseId
    );
    if (duplicateEntries.length != 0) return duplicateEntries[0];

    const database = await this.retrieveDatabaseInfo(databaseId);
    const title = data.title;
    const paperUrl = data.url;
    const authors = Array.isArray(data.authors) ? data.authors : [];
    const authorsPropertyType = database.properties?.Authors?.type;
    const published = data.published;
    const publisher = data.publisher;
    const comment = data.comment;

    try {
      const url = this.apiBase + 'pages';
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
          date: { start: published, end: null },
        },
      };
      if (database.properties?.Comments) {
        properties.Comments = {
          id: 'comment',
          type: 'url',
          url: comment,
        };
      }

      const body = {
        parent: parent,
        properties: properties,
      };
      const res = await fetch(url, {
        method: 'POST',
        mode: 'cors',
        headers: this.torkenizedHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
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
      const url = this.apiBase + 'search';
      const headers = this.torkenizedHeaders();
      const body = { filter: { value: 'database', property: 'object' } };
      const res = await fetch(url, {
        method: 'POST',
        mode: 'cors',
        headers: headers,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      data.results?.forEach((result) => {
        const option = `<option value=${result.id}>${result.title[0].text.content}</option>`;
        document
          .getElementById('js-select-database')
          .insertAdjacentHTML('beforeend', option);
      });
    } catch (err) {
      console.error(err);
      throw err;
    }
  }
}
