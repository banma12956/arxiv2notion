// MIT License
// Copyright (c) 2021 denkiwakame <denkivvakame@gmail.com>

import '../scss/theme.scss';
import UIKit from 'uikit';
import Icons from 'uikit/dist/js/uikit-icons';
import Mustache from 'mustache';
import NotionClient from './notion.js';

UIKit.use(Icons);

class TokenManager {
  constructor() {
    this.storageKey = 'notionToken';
    this.setupInput();
    this.setupSaveButton();
    this.client = new NotionClient();
  }
  toggleVisible() {
    if (this.input.type == 'password') {
      this.input.type = 'text';
      this.visibleButton.setAttribute('uk-icon', 'unlock');
    } else {
      this.input.type = 'password';
      this.visibleButton.setAttribute('uk-icon', 'lock');
    }
  }
  setupSaveButton() {
    this.saveButton = document.getElementById('js-save-btn');
    this.saveButton.addEventListener('click', () => {
      this.saveIntegrationToken();
    });
    this.visibleButton = document.getElementById('js-visible-btn');
    this.visibleButton.addEventListener('click', () => {
      this.toggleVisible();
    });
  }
  setupInput() {
    this.input = document.getElementById('js-token-input');
    if (!chrome.storage) return;
    chrome.storage.local.get(this.storageKey, (d) => {
      if (!d) return;
      this.input.value = d[this.storageKey] || '';
    });
  }
  async saveIntegrationToken() {
    const token = this.input.value.trim();
    if (!token) {
      this.renderMessage('danger', 'Enter a Notion integration token.');
      return;
    }
    await chrome.storage.local.set({
      [this.storageKey]: token,
    });
    // Remove credentials saved by versions that used Notion's unsupported
    // getBotToken endpoint.
    await chrome.storage.local.remove('botId');
    await this.connectionTest();
  }
  async connectionTest() {
    const d = await chrome.storage.local.get(this.storageKey);
    this.client.token = d[this.storageKey];
    try {
      await this.client.validateToken();
      this.renderMessage('success', 'Successfully connected to Notion.', true);
    } catch (err) {
      this.renderMessage('danger', err.message, true);
    }
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

new TokenManager();
