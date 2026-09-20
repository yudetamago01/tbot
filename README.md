# Karotter tbot

Karotterの投稿中に書かれた`@tbot コマンド`を検出し、本文をテーマ画像へ変換して画像付きリプライを返すRender向けNode.jsサービスです。

## 対応コマンド

`help`, `quote`, `fancy`, `neon`, `glitch`, `stamp`, `pixel`, `banner`, `speech`, `mono`, `rainbow`, `sticker`, `code`, `gold`, `post`, `poem`, `impact`, `iconquote`

`@tbot+quote`と`@tbot quote`の両方を受け付け、日本語エイリアスにも対応します。

## Karotter APIとの接続

公式の[Karotter Developer API](https://karotter.com/api-docs)を使用します。

- 認証: `x-api-key`または`Authorization: Bearer`
- 必要スコープ: `canReadPosts`, `canCreatePosts`
- 通知取得: `GET /api/developer/notifications?type=MENTION,REPLY`
- 投稿取得: `GET /api/developer/posts/:postId`
- 画像返信: `POST /api/developer/posts`の`media`と`parentId`
- 処理済み通知: `PATCH /api/developer/notifications/:notificationId/read`

親投稿へのコマンドだけの返信では親投稿の本文・投稿日・反応数・投稿者アイコンを使用します。通常投稿の「本文 + post」では反応数をすべて0として描画します。

## ローカル起動

Node.js 20.12以上が必要です。

```bash
cp .env.example .env
npm install
npm run fonts:install
npm test
npm start
```

Node.jsは`.env`を自動では読みません。ローカルではシェルから環境変数を設定するか、`node --env-file=.env src/server.js`で起動してください。

## Render

1. Karotterの設定画面でAPIキーを作成し、`canReadPosts`と`canCreatePosts`を付与します。
2. このリポジトリからRender Blueprintを作成します。
3. RenderのSecret環境変数`KAROTTER_API_KEY`へAPIキーを設定します。
4. デプロイ後に`/health`が`200`、`/ready`が`200`になることを確認します。

`render.yaml`は無料Web Serviceを前提にしています。ビルド時にGoogle Fonts公式リポジトリからNoto Sans JP / Noto Serif JPを取得するため、Render上でも日本語が豆腐文字になりません。無料プランは15分間受信トラフィックがないとスリープし、その間は通知を処理できません。常時応答が必要ならスリープしないプランを使用してください。

## 環境変数

| 名前 | 既定値 | 用途 |
|---|---:|---|
| `KAROTTER_API_KEY` | なし | 必須。Karotter APIキー |
| `KAROTTER_AUTH_MODE` | `x-api-key` | `x-api-key`または`bearer` |
| `KAROTTER_API_BASE_URL` | `https://karotter.com/api/developer` | APIベースURL |
| `TBOT_USERNAME` | `tbot` | 検出するメンション名 |
| `TBOT_TIME_ZONE` | `Asia/Tokyo` | 投稿日の表示タイムゾーン |
| `POLL_INTERVAL_MS` | `15000` | 通知ポーリング間隔 |
| `KAROTTER_REQUESTS_PER_MINUTE` | `55` | 公式上限60回/分に対するクライアント側上限 |
| `AVATAR_ALLOWED_HOSTS` | `karotter.com,api.karotter.com` | アイコン取得を許可するホスト |
| `STATE_PATH` | `./data/state.json` | 生成投稿の参照元を保存する場所 |
| `ENABLE_POLLING` | `true` | ポーリングの有効化 |

`STATE_PATH`は生成画像への再返信で元投稿を引き継ぐために使います。Renderのローカルファイルは再起動や再デプロイで失われます。再デプロイをまたいで保持する場合は有料サービスへPersistent Diskを接続し、例として`/var/data/state.json`を指定してください（無料Web ServiceにはPersistent Diskを接続できません）。

## 運用上の安全性

- APIキーはリポジトリへ保存しません。
- アイコンURLはHTTPSかつ許可ホストの画像だけ取得します。
- 取得画像は8MBまで、API通信はタイムアウト付きです。
- 通知は作成日時順に直列処理し、APIの60リクエスト/分制限に対して55回/分で事前抑制し、429応答の`Retry-After`も尊重します。
- 画像だけの返信を成立させるため、必須の`content`には不可視区切り文字を1文字送ります。
