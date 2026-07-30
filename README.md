# OnlineIDE

Google AI Studio (Gemini API) のモデルを使ったチャットシステムです。

## 構成

- **バックエンド**: Node.js + Express。`@google/genai` SDK経由でGemini APIを呼び出し、レスポンスをSSE (Server-Sent Events) でストリーミングします。APIキーはサーバー側のみで扱い、フロントエンドには公開されません。
- **フロントエンド**: `public/` 配下の素のHTML/CSS/JS。ビルド不要で、モデル選択・ストリーミング表示・会話履歴のクリアに対応したチャットUIです。

## GitHub Codespacesで起動する

このリポジトリには `.devcontainer/devcontainer.json` が含まれているため、GitHub上で「Code」→「Codespaces」→「Create codespace on main」を選ぶだけで起動できます。コンテナ作成時に `npm install` が自動実行されます。

APIキーは以下のいずれかの方法で設定してください。

- **推奨**: リポジトリの Settings → Secrets and variables → Codespaces で `GEMINI_API_KEY` を登録しておくと、Codespace起動時に環境変数として自動的に渡されます
- もしくはCodespace内のターミナルで `cp .env.example .env` を実行し、`.env` に直接APIキーを記入

起動後は Codespaces のターミナルで `npm start` を実行してください。ポート3000が自動的にフォワーディングされ、プレビューが開きます。

## ローカルでのセットアップ

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
| `COLAB_ENDPOINT_URL` | Colab GPUで動かすHugging Faceモデルの公開URL（任意） | - |
| `COLAB_API_KEY` | 上記エンドポイントを保護するAPIキー（任意） | - |

## Colab GPUでHugging Faceモデルを使う（任意）

Gemini APIだけでなく、Google ColabのGPU上でHugging Faceのモデルを動かして
チャットに使うこともできます。

1. `colab/huggingface_gpu_server.ipynb` を [Google Colab](https://colab.research.google.com/) で開く
2. ランタイム → ランタイムのタイプを変更 → **GPU** を選択
3. 上から順に全セルを実行する（初回はモデルのダウンロードに数分かかります）
4. 最後のセルに表示される `COLAB_ENDPOINT_URL` と `COLAB_API_KEY` を、OnlineIDE側の `.env` に追記する
5. OnlineIDEを再起動し、モデル選択で「Hugging Face モデル (Colab GPU)」を選ぶ

ノートブックはデフォルトで `Qwen/Qwen2.5-3B-Instruct`（ゲート無し）をロードします。ノートブック内の `MODEL_ID` を書き換えれば他のHFモデルにも切り替えられます。公開URLは`cloudflared`のクイックトンネルによる誰でもアクセス可能なURLなので、ランダム生成されたAPIキーで保護されているとはいえ、他人に共有しないでください。また、Colab側のセッションが切れるとURLが無効になるため、その都度ノートブックを再実行して`.env`を更新する必要があります。

このモデルには画像・PDF・音声などの添付ファイルは送信されません（Excelファイルはテキスト変換されるため引き続き利用できます）。

## API

- `GET /api/models` — 選択可能なモデル一覧とデフォルトモデルを返す
- `POST /api/chat` — チャットメッセージを送信し、SSEでレスポンスをストリーミング
  - リクエストボディ: `{ "messages": [{ "role": "user" | "model", "text": "..." }], "model": "gemini-2.5-flash" }`
  - レスポンス: `data: {"text": "..."}` のSSEイベントを逐次送信し、完了時に `data: [DONE]`
