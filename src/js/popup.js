// MIT License
// Copyright (c) 2021 denkiwakame <denkivvakame@gmail.com>

import '../scss/theme.scss';
import UIKit from 'uikit';
import Icons from 'uikit/dist/js/uikit-icons';
import Mustache from 'mustache';
import NotionClient from './notion.js';
import urlParser from './parsers.js';

UIKit.use(Icons);

//const TEST_URL = 'https://arxiv.org/abs/2308.04079';
const TEST_URL = 'https://www.arxiv.org/abs/2508.20324';
// const TEST_URL = 'https://aclanthology.org/2023.ijcnlp-main.1/';

class UI {
  constructor() {
    this.paperReady = false;
    this.databasesReady = false;
    this.tokenReady = false;
    this.setupProgressBar();
    this.setupSaveButton();
    this.client = new NotionClient();
    this.connectionTest();
    this.getCurrentTabUrl();
    this.setupMsgHandler();
  }

  getCurrentTabUrl() {
    document.addEventListener('DOMContentLoaded', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const url = tabs[0].url;
        this.data = this.isDebugUrl(url)
          ? this.getPaperInfo(TEST_URL)
          : this.getPaperInfo(url);
      });
    });
  }

  async connectionTest() {
    chrome.storage.local.get('botId', async (d) => {
      try {
        if (!this.client.token) {
          const botId = d.botId;
          if (!botId) {
            this.renderMessage(
              'danger',
              'Set your Notion integration ID first.'
            );
            return;
          }
          const data = await this.client.requestToken(botId);
          if (data.name == 'UnauthorizedError') {
            this.renderMessage('danger', 'You are not logged in notion.so.');
            return;
          } else {
            this.client.token = data.token;
            this.tokenReady = true;
          }
        }
        const databases = await this.client.retrieveDatabase();
        this.databasesReady = databases.length > 0;
        if (!this.databasesReady) {
          this.renderMessage('danger', 'No connected Notion databases found.');
        }
        this.updateSaveState();
      } catch (err) {
        this.renderMessage('danger', err.message);
      }
    });
  }

  setupSaveButton() {
    this.saveButton = document.getElementById('js-save');
    this.updateSaveState();
    this.saveButton.addEventListener('click', async () => {
      if (this.saveButton.disabled) return;
      this.showProgressBar();
      try {
        const data = await this.client.createPage(this.data);
        this.renderMessage('success', 'Saved to Notion.');
        return data;
      } catch (err) {
        this.renderMessage('danger', err.message);
      }
    });
  }

  setupMsgHandler() {
    document.addEventListener('msg', (evt) => {
      console.error(evt);
      this.renderMessage(evt.detail.type, evt.detail.msg);
    });
  }

  setupProgressBar() {
    this.progressBar = document.getElementById('js-progressbar');
  }

  updateSaveState() {
    if (!this.saveButton) return;
    this.saveButton.disabled = !(
      this.paperReady &&
      this.databasesReady &&
      this.tokenReady
    );
  }

  showProgressBar() {
    clearInterval(this._animate);
    this.progressBar.value = 0;
    this._animate = setInterval(() => {
      this.progressBar.value += 20;
      if (this.progressBar.value >= this.progressBar.max) {
        clearInterval(this._animate);
      }
    }, 200);
  }
  isDebugUrl(url) {
    return url?.startsWith('chrome-extension://') || false;
  }
  isArxivUrl(url) {
    return (
      url?.startsWith('https://arxiv.org') ||
      url?.startsWith('https://www.arxiv.org') ||
      false
    );
  }
  isOpenReviewUrl(url) {
    return url?.startsWith('https://openreview.net/') || false;
  }
  isPDF(url) {
    return url && url.split('.').pop() === 'pdf';
  }
  async getPaperInfo(url) {
    this.showProgressBar();
    try {
      const data = await urlParser.parse(url);
      this.setFormContents(data.title, data.abst, data.comment, data.authors);
      this.paperReady = true;
      this.updateSaveState();
      return data;
    } catch (err) {
      this.renderMessage('danger', err.message);
      throw err;
    }
  }
  setFormContents(paperTitle, abst, comment, authors) {
    document.getElementById('js-title').value = paperTitle;
    document.getElementById('js-abst').value = abst;
    //     document.getElementById('js-published').value = published;
    document.getElementById('js-comment').value = comment;
    authors.forEach((author) => {
      const template = `<span class="uk-badge uk-margin-small-right uk-margin-small-top">{{ text }}</span>`;
      const rendered = Mustache.render(template, { text: author });
      document
        .getElementById('js-chip-container')
        .insertAdjacentHTML('beforeend', rendered);
    });
  }

  renderMessage(type, message, overwrite = false) {
    // type: warning, danger, success, primary
    const template = `<div class="uk-alert-{{type}}" uk-alert><a class="uk-alert-close" uk-close></a><p>{{message}}</p></div>`;
    const rendered = Mustache.render(template, {
      type: type,
      message: message,
    });
    if (overwrite) {
      document.getElementById('js-message-container').innerHTML = rendered;
    } else {
      document
        .getElementById('js-message-container')
        .insertAdjacentHTML('beforeend', rendered);
    }
  }
}

new UI();
