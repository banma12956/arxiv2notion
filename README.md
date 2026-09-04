# arxiv2notion

[![build](https://github.com/denkiwakame/arxiv2notion/actions/workflows/build.yaml/badge.svg)](https://github.com/denkiwakame/arxiv2notion/actions/workflows/build.yaml) [![lint](https://github.com/denkiwakame/arxiv2notion/actions/workflows/lint.yaml/badge.svg)](https://github.com/denkiwakame/arxiv2notion/actions/workflows/lint.yaml)
[![Changelog](https://img.shields.io/badge/changelog-see%20here-blue.svg)](CHANGELOG.md)
[![GitHub release](https://img.shields.io/github/release/denkiwakame/arxiv2notion.svg)](https://github.com/denkiwakame/arxiv2notion/releases)

#### Supported Format

[![arxiv](https://img.shields.io/badge/arxiv.org-API-red.svg)](https://info.arxiv.org/help/api/index.html)
[![openreview](https://img.shields.io/badge/openreview.net-parser-purple.svg)](https://openreview.net/)
[![acl](https://img.shields.io/badge/aclanthology.org-parser-purple.svg)](https://aclanthology.org/)

Easy-to-use arXiv clipper for [Notion](https://www.notion.so) based on [Notion API](https://developers.notion.com/)

![demo](doc/arxiv2notion.gif)
![notion](doc/nerf_example2.png)

## ⬇️ Installation

### a. Install via Chrome Store

- arxiv2notion is now available at [Chrome Store](https://chromewebstore.google.com/detail/arxiv2notion/jfgdgmjlakndggcpknmanlpgjgjbcbli) 🚀.

### b. Install Manually

- download extension package from
  https://github.com/denkiwakame/arxiv2notion/releases/latest
- for Chrome, navigate to `chrome://extension`
  - drag and drop the extension from your file manager anywhere onto the extensions page
  - or unzip the extension and `load unpacked` in developer mode

## ⚙️ Setup

### 1. Add arxiv2notion integration

- navigate to [My Integrations](https://www.notion.so/profile/integrations)
- `+ New Integration`
  - **associated workspace:** select your workspace where you save arXiv articles
  - **Type:** select `Internal`
  - **name:** set any name of your choice
    <img src="https://github.com/user-attachments/assets/137a6dc2-e280-46d9-8f89-43c6bff9da41" height="200" />

> [!NOTE]
> For more detailed information about Notion integration, please refer to the official documentation at https://developers.notion.com/docs/getting-started.

### 2. Configure the extension

- right-click on the extension icon > `Options`
  - open your integration and copy its **Internal Integration Secret**.
  - paste the integration token into the extension Options page and click `+`.
  - if the token is valid, the extension reports a successful connection.

> [!NOTE]
> The integration token is stored in this extension's Chrome local storage and is sent only to `api.notion.com`. Treat it like a password. Remove the extension or clear its storage to remove the saved token.

<img src="https://github.com/user-attachments/assets/b9e5b87a-e981-4ab6-b59e-75c7c2c7c667" height="300"><img src="https://github.com/user-attachments/assets/d82a0b37-fdc3-44b4-a89f-31997b36a19e" height="300">

### 3. Create databases in Notion

#### from template (recommended)

- clone the public template [here](https://denkiwakame.notion.site/597cdd58bded4375b1cbe073b2ed6f5d?v=63fcbfda57824b239b66e52dde841cdf) to your own notion workspace
- add connection to target databases via `...` > (scroll down...) `Connect to` > `{your integration name}`

<img src="https://github.com/user-attachments/assets/1535ef61-749c-4670-8c37-57ac3d5240b4" height="400">

- Integration will have access writes to all child DBs.

![multiple_db](doc/multiple_db.png)

#### or manually

- alternatively, you can follow the following steps to create database from scratch in notion
- login to [notion.so](https://www.notion.so) by admin user
- create databases where you save arXiv articles
  - **follow this instruction** https://www.notion.so/guides/creating-a-database and **add properties listed below.**

> [!CAUTION]
> Do **NOT** create a new database by `/database` !
> Make sure to create properties with **exactly the same names and types as those listed.**

| property  | type   |
| --------- | ------ |
| Title     | Title  |
| URL       | URL    |
| Authors   | Text   |
| Published | Date   |
| Publisher | Select |

To save the paper's current citation count, add this optional property:

| property  | type   |
| --------- | ------ |
| Citation | Number |

Citation counts are resolved at save time using Google Scholar, Semantic
Scholar, OpenAlex, and Crossref. The highest count from exact title or identifier
matches is saved. Google Scholar does not offer a public citation API, so that
lookup is best-effort; if every provider fails, the paper is still saved and the
citation field is left empty.

> [!NOTE]
> **migration from Multi-Select Authors to Text Authors**
> Notion displays this property type as `Text`; the Notion API type is `rich_text`.

- Back up or duplicate your Notion database first.
- Rename the old `Authors` property to `Authors_old`.
- Add a new `Authors` property with type `Text`.
- Copy the author tag values from `Authors_old` into `Authors` as comma-separated text, for example `Richard S. Sutton, David McAllester, Satinder Singh, Yishay Mansour`.
- Keep `Authors_old` until you have tested saving new papers with the extension.
- Legacy databases where `Authors` is still `Multi-Select` are still supported, but `Text` is the recommended schema.
- Legacy databases with a `Comments` URL property are still supported, but `Comments` is no longer required.
- Legacy databases with an `Abstract` Text property are still supported, but `Abstract` is no longer required or written by the extension.

> [!NOTE]
> **migration from v0.1.x → v1.0.0**

- v1.0.0 changed `Authors` from `Text` to `Multi-Select` and added `Published` and `Comments`.
- Current versions use `Text` for `Authors`, while legacy `Multi-Select` author databases are still supported. `Comments` is no longer required.
- Change your existing database properties as follows to use the current schema.

| property      | type(^v0.1.x) | type(v1.0.0-1.4.x) | current type |
| ------------- | ------------- | ------------------ | ------------ |
| Authors       | Text          | Multi-Select       | **Text**     |
| **Published** | --            | Date               | **Date**     |
| Comments      | --            | URL                | --           |

> [!TIP]
> You can add extra columns of your choice alongside the default ones in your databases.

#### :bulb: w/ Notion Formula (optional)

- [Notion Formula](https://www.notion.so/help/formulas) allows you to add **custom autofill property** defined by formula.
- For instance, `replace(URL, "arxiv", "ar5iv")` formula adds an [ar5iv link](https://ar5iv.labs.arxiv.org/) column by substituting "arxiv.org" with "ar5iv.org" 🚀
  <img src="https://github.com/denkiwakame/arxiv2notion/assets/1871262/687c0e6f-0f63-4f0c-81ce-0b2468c90b0e" height="200">

#### :bulb: w/ Notion AI Property (optional)

- [Notion AI Property](https://www.notion.so/ja-jp/help/guides/5-ai-prompts-to-surface-fresh-insights-from-your-databases) allows you to add **custom autofill property** to each DB record.
- Add column to your Notion DB and select `AI custom autofill`
- Set any prompt you like (e.g. summarization, extracting key ideas ...)
  <img src="https://github.com/denkiwakame/arxiv2notion/assets/1871262/b1a6149a-cf55-41f8-9e83-4578a64530e6" height="200"><img src="https://github.com/denkiwakame/arxiv2notion/assets/1871262/8b30bd04-ffc3-4525-b684-90f8b62dda92" height="200">
- Save an article via `arxiv2notion` ,and then the preset `AI property` will be automatically generated.
  ![image](https://github.com/denkiwakame/arxiv2notion/assets/1871262/ad698cf0-dce0-4b29-8511-47f4c796a694)

## :technologist: Build locally (for Developers)

- See also [CONTRIBUTING.md](CONTRIBUTING.md)

```bash
$ git clone https://github.com/denkiwakame/arxiv2notion.git
$ npm install
$ npm run build
$ npm run watch # debug locally
$ npm run pack  # packaging to zip
```

## Contributors

- Maintainers: [@denkiwakame](https://github.com/denkiwakame), [@wangjksjtu](https://github.com/wangjksjtu)
  <a href="https://github.com/denkiwakame/arxiv2notion/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=denkiwakame/arxiv2notion" />
  </a>
