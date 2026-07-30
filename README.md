# OnlineIDE

Google AI Studio (Gemini API) のモデルを使ったチャットシステムです。

## 構成

- **バックエンド**: Node.js + Express。`@google/genai` SDK経由でGemini APIを呼び出し、レスポンスをSSE (Server-Sent Events) でストリーミングします。APIキーはサーバー側のみで扱い、フロントエンドには公開されません。
- **フロントエンド**: `public/` 配下の素のHTML/CSS/JS。ビルド不要で、モデル選択・ストリーミング表示・会話履歴のクリアに対応したチャットUIです。

## セットアップ

1. 依存関係をインストール

   ```bash
   npm install
   ```

2. [Google AI Studio](https://aistudio.google.com/apikey) でAPIキーを発行し、`.env` を作成

   ```bash
   cp .env.example .env
   # .env を編集して GEMINI_API_KEY を設定
   ```

3. サーバーを起動

   ```bash
   npm start
   ```

4. ブラウザで `http://localhost:3000` を開く

## 環境変数 (`.env`)

| 変数 | 説明 | デフォルト |
|---|---|---|
| `GEMINI_API_KEY` | Google AI StudioのAPIキー（必須） | - |
| `GEMINI_MODEL` | デフォルトで使用するモデルID | `gemini-2.5-flash` |
| `PORT` | サーバーのポート番号 | `3000` |

## API

- `GET /api/models` — 選択可能なモデル一覧とデフォルトモデルを返す
- `POST /api/chat` — チャットメッセージを送信し、SSEでレスポンスをストリーミング
  - リクエストボディ: `{ "messages": [{ "role": "user" | "model", "text": "..." }], "model": "gemini-2.5-flash" }`
  - レスポンス: `data: {"text": "..."}` のSSEイベントを逐次送信し、完了時に `data: [DONE]`
