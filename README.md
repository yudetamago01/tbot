# Karotter tbot

Karotterの投稿中に書かれた`@tbot コマンド`を検出し、本文をテーマ画像へ変換して画像付きリプライを返すRender向けNode.jsサービスです。

## 対応コマンド

`help`, `quote`, `fancy`, `neon`, `glitch`, `stamp`, `pixel`, `banner`, `speech`, `mono`, `rainbow`, `sticker`, `code`, `gold`, `post`, `poem`, `impact`, `iconquote`

`@tbot+quote`と`@tbot quote`の両方を受け付け、日本語エイリアスにも対応します。

## Markdown・数式

横書きの画像テーマと`post`・`iconquote`では、画像生成時にMarkdownを解釈します。`**太字**`、`*斜体*`、`~~取消線~~`（Karotter互換の`~取消線~`も可）、`` `code` ``、見出し、リンク表示に対応しています。

インライン数式は`$E=mc^2$`または`\\(E=mc^2\\)`、独立した数式行は`$$\\frac{a}{b}$$`または`\\[\\frac{a}{b}\\]`の形式です。区切り記号内側の空白も許容します。分数、平方根、上下付き、ギリシャ文字、総和・積分に加え、`\\color{#7c83ff}{本文}`と`\\textcolor{#7c83ff}{本文}`にも対応し、外部CDNなしで直接PNGへ描画します。

ユーザーの本文は文字数や行数で切り捨てず、自動で`…`へ置き換えません。`post`以外のテーマは、短文では従来の文字サイズを保ち、表示領域を超える場合だけ文字・行間・テーマ効果を段階的に縮小して約200文字まで収めます。それを超えて最小倍率に達した場合も本文は削除せず描画を続けます。SNS投稿レイアウトを保つため、`post`の文字サイズは固定です。Renderのビルド時にはNoto Color Emojiも取得し、Linux上でも絵文字をカラーで描画します。

## Karotter APIとの接続

Karotter公式Webクライアントと同じアカウントAPIを使用します。OAuthやDeveloper API方式も互換用として残しています。

- 認証: 起動時にKarotterのID・パスワードで通常ログインし、取得した`Authorization: Bearer`トークンを使用。OAuth同意画面は互換用として残しています
- 通知取得: `GET https://api.karotter.com/api/notifications?types=MENTION,REPLY`
- 投稿取得: `GET https://api.karotter.com/api/posts/:postId`
- 画像返信: `POST https://api.karotter.com/api/posts`の`media`と`parentId`
- 処理済み通知: ローカル状態ファイルで管理し、新しい通知だけを返信対象にします

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

1. Karotterでtbot用アカウントを作成し、ユーザー名を`tbot`にします。
2. このリポジトリからRender Blueprintを作成します。
3. RenderのSecret環境変数として`KAROTTER_IDENTIFIER`と`KAROTTER_PASSWORD`を設定します。GitHubのソースへ認証情報を直接コミットしないでください。
4. OAuth開始画面を第三者に操作されないよう、十分に長いランダム値を`TBOT_SETUP_SECRET`へ設定します。
5. デプロイ時にtbotがID・パスワードで自動ログインします。手動で認証し直す場合だけ`https://<サービス名>.onrender.com/oauth/start`を使用します。
6. `/oauth/status`の`authorized`と`/ready`の`ok`が`true`になることを確認します。

`render.yaml`は無料Web Serviceを前提にしています。ビルド時にGoogle Fonts公式リポジトリからNoto Sans JP / Noto Serif JP / Noto Color Emojiと、`poem`用のYuji Syukuを取得するため、Render上でも日本語・筆文字・絵文字が正しく描画されます。無料プランは15分間受信トラフィックがないとスリープし、その間は通知を処理できません。再起動後はRender SecretのID・パスワードで自動的に再ログインします。常時運用ではスリープしないプランを使用してください。

## 環境変数

| 名前 | 既定値 | 用途 |
|---|---:|---|
| `KAROTTER_AUTH_MODE` | `account` | ID・パスワードによる通常ログイン。互換用に`oauth`、`x-api-key`、`bearer`も利用可能 |
| `KAROTTER_API_BASE_URL` | `https://api.karotter.com/api` | 通常ログイン時のKarotter本体APIベースURL |
| `KAROTTER_IDENTIFIER` | なし | Karotterのユーザー名またはメールアドレス（Render Secret） |
| `KAROTTER_PASSWORD` | なし | Karotterのパスワード（Render Secret） |
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

- KarotterのID・パスワードはRender Secretから読み、起動時にKarotterのログインAPIへ直接送信します。パスワードはtbotのファイル・状態データ・ログへ書き込みません。
- OAuthトークン、Client Secret、セットアップ用Secretはログやリポジトリへ保存しません。
- アイコンURLはHTTPSかつ許可ホストの画像だけ取得します。
- 取得画像は8MBまで、API通信はタイムアウト付きです。
- 通知は作成日時順に直列処理し、APIの60リクエスト/分制限に対して55回/分で事前抑制し、429応答の`Retry-After`も尊重します。
- 画像だけの返信を成立させるため、必須の`content`には不可視区切り文字を1文字送ります。
