# 論文読解アシスタント

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

論文読解アシスタントは、読書の流れを中断せずに学術論文を理解するための Chrome Manifest V3 拡張機能です。選択した文章の説明・簡略化・用語定義、Web ページや PDF 全体の要約、追加質問、結果の保存に対応しています。

## 現在の実装状況

現在、以下の機能が実装されています。

- ポップアップ、設定ページ、サイドパネルを備えた Chrome Manifest V3 拡張機能。
- 選択した文章を説明、簡略化、定義、保存するフローティングツールバー。
- 構造化された結果カードと、文脈を維持した追加質問。
- `chrome.storage.local` を使用した保存項目と論文別の閲覧履歴。
- クリーニング済み HTML による Web ページ全体の要約と、変換失敗時のプレーンテキストへのフォールバック。
- PDF の表示、ページ移動、ズーム、テキスト選択、全文要約に対応したローカル PDF Workspace。
- リポジトリ内の `html_pdf2md/markitdown` を使用した HTML・PDF 変換。
- Mock、実 API、自動フォールバックの各 API モード。
- OpenAI 互換 API のベース URL、モデル、API Key、出力言語の設定。
- 英語、簡体字中国語、日本語の UI。
- リクエスト検証、レート制限、任意の API 認証、リクエスト ID、構造化ログ、機密ヘッダーのマスキング。
- 文章、画像、文書要約リクエストの再試行処理。

> **テスト状況：画像選択機能は未テストです。** 画像領域の選択と画像説明フローは実装済みですが、手動検証はまだ完了していません。

## クイックスタート

### 1. 拡張機能を読み込む

1. Chrome で `chrome://extensions` を開きます。
2. 右上の「デベロッパー モード」を有効にします。
3. 「パッケージ化されていない拡張機能を読み込む」をクリックします。
4. `manifest.json` を含むプロジェクトのルート、または `dist/chrome-extension` を選択します。
5. 拡張機能をツールバーに固定します。

### 2. バックエンドを起動する

拡張機能は Mock モードだけでも利用できます。実際のモデルと文書変換を使用する場合は、バックエンドを起動します。

```powershell
cd backend
npm install
npm run setup:python
npm start
```

`npm run setup:python` は `backend/.venv` を作成し、リポジトリに含まれる MarkItDown を editable モードでインストールします。

デフォルトのバックエンド URL：

```text
http://localhost:3000
```

ヘルスチェック：

```text
http://localhost:3000/api/health
```

### 3. 拡張機能を設定する

拡張機能の設定ページでは、以下を設定できます。

- API モード：`mock`、`real`、`auto`
- バックエンド URL
- バックエンド認証 Token
- OpenAI 互換 API の URL
- LLM API Key
- モデル名
- 出力言語
- リクエストのタイムアウト

実際の API Key は Chrome の `chrome.storage.local` に保存されます。ソースコード、`.env.example`、ログ、Git のコミットには記録しないでください。

### 4. 拡張機能をビルドする

プロジェクトのルートで実行します。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-extension.ps1
```

生成物：

```text
dist/chrome-extension
dist/chrome-extension.zip
```

## 使い方

### 文章を説明する

1. 論文の Web ページまたは PDF Workspace を開きます。
2. 2 文字以上の文章を選択します。
3. フローティングツールバーから「説明」「簡略化」「定義」を選択します。
4. サイドパネルで構造化された結果を確認します。
5. 追加質問、保存、履歴からの再表示ができます。

### Web ページを要約する

1. 論文本文を含む Web ページを開きます。
2. 拡張機能のサイドパネルを開きます。
3. 「全文を要約」をクリックします。
4. クリーニング済み HTML が抽出され、変換に失敗した場合はプレーンテキストが使用されます。

### PDF を要約する

1. PDF Workspace でローカル PDF を開きます。
2. サイドパネルの「全文を要約」をクリックします。
3. PDF がローカルバックエンドに送信され、MarkItDown により Markdown に変換されます。
4. 設定したモデルが構造化された要約を生成します。

デフォルトの PDF サイズ上限は 30 MB です。PDF はバックエンドの一時ディレクトリに保存され、変換の成功・失敗にかかわらず削除されます。

## アーキテクチャ概要

```text
Web ページ / PDF Workspace
          |
          v
Content Script / PDF Viewer
          |
          v
Background Service Worker
          |
          +--> chrome.storage.local
          |
          +--> API Client (mock / real / auto)
                      |
                      v
                Express バックエンド
                      |
            +---------+---------+
            |                   |
            v                   v
       MarkItDown          Mock / OpenAI
```

主要ディレクトリ：

```text
src/background/   メッセージルーティング、状態管理、API クライアント
src/content/      Web の文章選択、本文抽出、画像領域選択
src/pdf-viewer/   ローカル PDF 読書ワークスペース
src/sidepanel/    サイドパネルの状態と UI
src/options/      API とモデルの設定
src/shared/       共通プロトコル、型、定数、翻訳
backend/src/      Express API、モデルアダプター、文書変換
html_pdf2md/      リポジトリ内の MarkItDown ソース
docs/             設計、API、QA ドキュメント
```

## テスト

バックエンドを起動してから実行します。

```powershell
cd backend
node test-smoke.js
```

現在の Smoke Test は、ヘルスチェック、文章処理、追加質問、エラー応答、LLM 設定、文書要約を対象としています。

画像選択機能の手動テストはまだ完了していません。

## セキュリティ

- 実際の API Key をソースコードや Git にコミットしないでください。
- `.env`、`.venv`、`node_modules`、ログ、ビルド生成物は Git の対象外です。
- バックエンドログでは `Authorization`、`X-API-Key`、`X-LLM-Api-Key`、Cookie がマスキングされます。
- API Key が公開ログ、チャット、Git 履歴に表示された場合は、直ちに無効化して再発行してください。

## 関連ドキュメント

- [インタラクション仕様](docs/paper-reading-assistant-interaction-spec.md)
- [サイドパネル状態仕様](docs/paper-reading-assistant-side-panel-state-spec.md)
- [バックエンド API 仕様](docs/paper-reading-assistant-backend-api-spec.md)
- [QA チェックリスト](docs/qa-checklist.md)
