# Karotter tbot

Karotterの投稿中に書かれた`@tbot コマンド`を検出し、本文をテーマ画像へ変換して画像付きリプライを返すRender向けNode.jsサービスです。

## 対応コマンド

`help`, `quote`, `fancy`, `neon`, `glitch`, `stamp`, `pixel`, `banner`, `speech`, `mono`, `rainbow`, `sticker`, `code`, `gold`, `post`, `poem`, `impact`, `iconquote`

`@tbot+quote`と`@tbot quote`の両方を受け付け、日本語エイリアスにも対応します。

## Karotter APIとの接続

公式の[Karotter Developer API](https://karotter.com/api-docs)を使用します。

- 認証: OAuth 2認可コードフロー（PKCE）で取得した`Authorization: Bearer`トークン
- 必要スコープ: `canReadPosts`, `canCreatePosts`
- 通知取得: `GET /api/developer/notifications?type=MENTION,REPLY`
- 投稿取得: `GET /api/developer/posts/:postId`
- 画像返信: `POST /api/developer/posts`の`media`と`parentId`
- 処理済み通知: `PATCH /api/developer/notifications/:notificationId/read`

サーバー起動時刻より前に作成された未読通知は画像返信せず、既読化だけ行います。これにより再起動時に過去のメンションへ再返信しません。古い通知が残っていても、起動後の新しい通知は同じポーリング内で通常どおり処理します。

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

1. Karotterの設定画面でOAuthアプリを作成し、`canReadPosts`と`canCreatePosts`を付与します。リダイレクトURIは`https://<Renderのサービス名>.onrender.com/oauth/callback`と完全一致させます。
2. このリポジトリからRender Blueprintを作成します。
3. `KAROTTER_OAUTH_CLIENT_ID`、`KAROTTER_OAUTH_CLIENT_SECRET`、`KAROTTER_OAUTH_REDIRECT_URI`をRenderのSecret環境変数へ設定します。
4. OAuth開始画面を第三者に操作されないよう、十分に長いランダム値を`TBOT_SETUP_SECRET`へ設定します。
5. 先に同じブラウザでKarotterへログインしてから、`https://<サービス名>.onrender.com/oauth/start`を開きます。Basic認証のユーザー名には`tbot`、パスワードには`TBOT_SETUP_SECRET`を入力します。
6. 遷移したKarotter公式画面で対象アカウントのID・パスワードを入力し、OAuth認可を完了します。ID・パスワードがtbotへ送られたり保存されたりすることはありません。
7. `/oauth/status`の`authorized`と`/ready`の`ok`が`true`になることを確認します。

`render.yaml`は無料Web Serviceを前提にしています。ビルド時にGoogle Fonts公式リポジトリからNoto Sans JP / Noto Serif JPを取得するため、Render上でも日本語が豆腐文字になりません。無料プランは15分間受信トラフィックがないとスリープし、その間は通知を処理できません。またローカルファイルが失われる再起動後はOAuthの再認可が必要です。常時運用ではスリープしないプランとPersistent Diskを使用してください。

## 環境変数

| 名前 | 既定値 | 用途 |
|---|---:|---|
| `KAROTTER_AUTH_MODE` | `oauth` | 推奨は`oauth`。互換用に`x-api-key`と`bearer`も利用可能 |
| `KAROTTER_API_BASE_URL` | `https://karotter.com/api/developer` | APIベースURL |
| `KAROTTER_OAUTH_CLIENT_ID` | なし | OAuthアプリのClient ID |
| `KAROTTER_OAUTH_CLIENT_SECRET` | なし | OAuthアプリのClient Secret |
| `KAROTTER_OAUTH_REDIRECT_URI` | なし | 登録済みの`/oauth/callback` URL |
| `KAROTTER_OAUTH_BASE_URL` | `https://api.karotter.com/api/oauth` | OAuth認可・トークンのベースURL。ログインセッションを共有するAPIホストを使用 |
| `KAROTTER_OAUTH_SCOPE` | `profile offline_access` | Karotterへ要求するOAuthスコープ |
| `KAROTTER_OAUTH_TOKEN_PATH` | `./data/oauth.json` | OAuthトークンの保存先 |
| `TBOT_SETUP_SECRET` | なし | `/oauth/start`を保護するBasic認証パスワード |
| `KAROTTER_API_KEY` | なし | 旧APIキー認証を使う場合のみ |
| `TBOT_USERNAME` | `tbot` | 検出するメンション名 |
| `TBOT_TIME_ZONE` | `Asia/Tokyo` | 投稿日の表示タイムゾーン |
| `POLL_INTERVAL_MS` | `15000` | 通知ポーリング間隔 |
| `KAROTTER_REQUESTS_PER_MINUTE` | `55` | 公式上限60回/分に対するクライアント側上限 |
| `AVATAR_ALLOWED_HOSTS` | `karotter.com,api.karotter.com` | アイコン取得を許可するホスト |
| `STATE_PATH` | `./data/state.json` | 生成投稿の参照元を保存する場所 |
| `ENABLE_POLLING` | `true` | ポーリングの有効化 |

`STATE_PATH`は生成画像への再返信で元投稿を引き継ぐために使います。Renderのローカルファイルは再起動や再デプロイで失われます。再デプロイをまたいで保持する場合は有料サービスへPersistent Diskを接続し、`STATE_PATH=/var/data/state.json`、`KAROTTER_OAUTH_TOKEN_PATH=/var/data/oauth.json`のように指定してください（無料Web ServiceにはPersistent Diskを接続できません）。

## 運用上の安全性

- KarotterのID・パスワードはKarotter公式認可画面にだけ入力し、tbotでは受信・保存しません。
- OAuthトークン、Client Secret、セットアップ用Secretはログやリポジトリへ保存しません。
- アイコンURLはHTTPSかつ許可ホストの画像だけ取得します。
- 取得画像は8MBまで、API通信はタイムアウト付きです。
- 通知は作成日時順に直列処理し、APIの60リクエスト/分制限に対して55回/分で事前抑制し、429応答の`Retry-After`も尊重します。
- 画像だけの返信を成立させるため、必須の`content`には不可視区切り文字を1文字送ります。
