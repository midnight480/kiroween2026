# デモ動画の台本（3 分未満・英語ナレーション）

Devpost の要件: **3 分未満**、YouTube に**公開**、実機の映像、著作権のある音楽・素材は使わない。
審査基準の「Presentation」は、*課題・誰のため・なぜ重要か* が伝わり、**エンドツーエンドで動くこと**を見せているかを見る。
この台本は 2:50（10 秒の余裕）。ナレーションは 287 語で、どの場面も毎分 120 語以下（ゆっくり読める）。

> 台本で言っている内容は、すべて実機かテストで確認済み。言えないこと（未確認）は末尾の「言ってはいけないこと」に書いた。

## 構成

| 時間 | 見せるもの | 画面の操作 |
|---|---|---|
| 0:00–0:12 | 固定形式の COBOL | ブラウザデモ。サンプル「The classic three-tier」を表示。ルーラの 7・12・72 桁目の縦線にカーソルを当てる |
| 0:12–0:35 | 動機（8i の DB リンク） | 黒地に文字カード「Oracle 8i · DB links · 3 + 1 servers」。続けてブラウザデモのサンプル「DBLINK (the ghost of 8i)」を見せ、亡霊が現れる |
| 0:35–1:02 | 本物の COBOL・桁ずれ・小文字・DBLINK | ターミナルで `cobc -fsyntax-only --fixed examples/three-tier.cbl && echo valid COBOL`。ブラウザで「Shifted column」→「Lower case」→「DBLINK」を順に選ぶ（血のインクで赤く出る） |
| 1:02–1:30 | 46 種類・公式スキーマ・安全な既定値 | ブラウザで「The classic three-tier」を選ぶ。帳票をゆっくりスクロール（`MetadataOptions`、`StorageEncrypted: true`、`PubliclyAccessible: false` で止める） |
| 1:30–2:08 | 実デプロイ | ターミナルで `cobf examples/messaging.cbl`（`CALL "DEPLOY"` が既定動作）→ 確認に `y`。完成したら `publish` と `receive`。続けて**事前に撮った**3 層構成のクリップ（ALB が `COBOL` と返す → `destroy`） |
| 2:08–2:22 | 落ち | ブラウザデモの帳票の末尾。紫の「1998 CALLED. THEY WANT THEIR ARCHITECTURE BACK.」を大きく映す |
| 2:22–2:50 | Kiro と締め | リポジトリ画面（`.kiro/`、テスト 308 件のターミナル出力）→ 最後に `CALL "DEPLOY".` の 1 行を大きく映して終わる |

## ナレーション（場面ごと）

**1. 0:00–0:12**

> Pure fixed-format COBOL. Columns one to six, a sequence number. Column seven, an indicator. Code starts in column eight. And this file deploys AWS.

**2. 0:12–0:35**

> Twenty years ago I kept an Oracle 8i system alive. No clustering, so redundancy meant four servers wired together with database links, by hand. Today, the same intent is a few lines of COBOL.

**3. 0:35–1:02**

> It is real COBOL. GnuCOBOL compiles it. A transpiler reads it as text and emits CloudFormation. It is not a CDK binding. Shift one column, and the card reader tells you where. Write in lower case, and you are told it is heresy. Mention a database link, and the ghost of 8i appears.

**4. 1:02–1:30**

> A record is a resource. A value is a property. Forty-six AWS resource types: networks, servers, load balancers, databases, containers, queues, CloudFront. Every property name is checked against the official CloudFormation schemas. Defaults are secure: encrypted databases, IMDS version two, no public IPs. Plain-text passwords are rejected.

**5. 1:30–2:08**

> Now for real. CALL DEPLOY, against a live AWS account. A change set, then events on a one-hundred-thirty-two column printer. Publish to the topic, and the message lands in the queue. And here is a full three-tier stack I deployed earlier. The load balancer answers: COBOL. Then destroy, and nothing is left behind.

**6. 2:08–2:22**

> Ancient language, modern cloud, and what did I build? A load balancer, servers, and a database. The classic three-tier. Nineteen ninety-eight called. They want their architecture back.

**7. 2:22–2:50**

> I built this with Kiro. Workflow agents reviewed the design and every revision. A hook keeps the Japanese README in sync. Three hundred eight tests guard it, including one that fails if a message is left untranslated. The browser never sees an AWS key. Fixed format, forever. CALL DEPLOY.

## ナレーション（通しで。CapCut の読み上げに貼る用）

```
Pure fixed-format COBOL. Columns one to six, a sequence number. Column seven, an indicator. Code starts in column eight. And this file deploys AWS.
Twenty years ago I kept an Oracle 8i system alive. No clustering, so redundancy meant four servers wired together with database links, by hand. Today, the same intent is a few lines of COBOL.
It is real COBOL. GnuCOBOL compiles it. A transpiler reads it as text and emits CloudFormation. It is not a CDK binding. Shift one column, and the card reader tells you where. Write in lower case, and you are told it is heresy. Mention a database link, and the ghost of 8i appears.
A record is a resource. A value is a property. Forty-six AWS resource types: networks, servers, load balancers, databases, containers, queues, CloudFront. Every property name is checked against the official CloudFormation schemas. Defaults are secure: encrypted databases, IMDS version two, no public IPs. Plain-text passwords are rejected.
Now for real. CALL DEPLOY, against a live AWS account. A change set, then events on a one-hundred-thirty-two column printer. Publish to the topic, and the message lands in the queue. And here is a full three-tier stack I deployed earlier. The load balancer answers: COBOL. Then destroy, and nothing is left behind.
Ancient language, modern cloud, and what did I build? A load balancer, servers, and a database. The classic three-tier. Nineteen ninety-eight called. They want their architecture back.
I built this with Kiro. Workflow agents reviewed the design and every revision. A hook keeps the Japanese README in sync. Three hundred eight tests guard it, including one that fails if a message is left untranslated. The browser never sees an AWS key. Fixed format, forever. CALL DEPLOY.
```

読み上げの前に、必ず人の目で見直す（設計書の手順どおり）。数字は「Forty-six」「one-hundred-thirty-two」「Three hundred eight」と綴ってあるので、読み上げが数字を取り違えない。

## 撮影前の準備（映さない）

1. **アカウント ID を映さない。** AWS のプロファイル名（`AdministratorAccess-…`）にアカウント ID が入っている。撮影用のターミナルで、画面に出る前に設定して `clear` する。`aws sts get-caller-identity` や ARN を出すコマンドは、画面で実行しない。
2. ビルドとサーバー:
   ```
   npm run build && npm run web:build
   cd web && python3 -m http.server 8791 --bind 127.0.0.1
   ```
   ブラウザは**強制再読み込み**（キャッシュが古い JavaScript を返すことがあった）。音は OFF のままか、ON にする場合は声と重ならない音量に。
3. ターミナル: `alias cobf='node dist/cli.js'`、`export COBF_LANG=en`。帳票は 132 桁なので、ウィンドウを 140 桁以上にする（フォントは大きめ、1080p で読める大きさ）。
4. 撮影中に出る ARN を隠すため、次の 2 つを**映さずに**定義しておく（トピックの ARN にアカウント ID が入っているため）:
   ```
   publish() { aws sns publish --topic-arn "$(aws sns list-topics --query 'Topics[?contains(TopicArn,`cobolform-orders-events`)].TopicArn|[0]' --output text)" --message "$1" --query MessageId --output text >/dev/null && echo "published: $1"; }
   receive() { aws sqs receive-message --queue-url "$(aws sqs get-queue-url --queue-name cobolform-orders --query QueueUrl --output text)" --wait-time-seconds 5 --query 'Messages[0].Body' --output text; }
   ```
5. 3 層構成の映像は、**別に撮る**（デプロイに約 10 分かかる）: `cobf examples/three-tier.cbl` → 完了 → `curl -s http://<ALB の DNS 名>/`（DNS 名にアカウント ID は含まれない）→ `cobf destroy examples/three-tier.cbl --yes`。編集で早送りにして、画面に **「sped up」** と入れる（実時間でないことを隠さない）。
6. 実デプロイは**撮影のたびに課金**される（3 層構成は数十円、messaging はほぼ無料）。撮り終えたら、必ずスタックを削除して確認する。

## 撮影のコツ

- 画面録画は 1 場面ずつ別ファイルで撮り、CapCut でつなぐ。ナレーションは通しで先に作り、映像をそれに合わせる。
- **音楽は入れない。** 著作権のある曲は禁止。ブラウザデモのドットインパクト音は自作（WebAudio）なので使ってよいが、ナレーションを邪魔しない小ささで。
- 英語の文字起こし（字幕）を付けると、音声が聞き取りにくい審査員にも伝わる。
- 最初の 10 秒で「COBOL が AWS をデプロイする」と分かるように。審査員は 3 分を超えて見ない。

## 言ってはいけないこと（未確認・未実装）

- 「あらゆる AWS リソースに対応」→ 対応は **46 種類**。EKS、ElastiCache、CloudFront/ACM/Route 53、Classic LB は、CloudFormation が ChangeSet として受け付けただけで、**実際にはデプロイしていない**。
- 「Kiro の Specs / Steering を使った」→ リポジトリの `.kiro/` にあるのは**フック 1 つ**だけ。Specs と Steering は作っていない。台本の Kiro の部分は、実際にあるもの（ワークフローのエージェントによる設計とその修正のレビュー、フック）だけに絞ってある。
- 「ブラウザからデプロイできる」→ できない。ブラウザは**コンパイルだけ**で、デプロイは CLI。台本もそう言っている（"The browser never sees an AWS key"）。
- 「本番向け」→ デモ用の作品。更新が失敗したときのロールバックは、実機では未確認。

## YouTube に出すとき

- 公開設定は**公開**（限定公開は不可）。3 分未満であること。
- タイトル案: `COBOL DEPLOY DIVISION: pure fixed-format COBOL that deploys AWS (Kiroween 2026)`
- 説明文に GitHub のリポジトリ URL、カテゴリ（Resurrection）、`#KiroweenHackathon26` を入れる。
- 動画に第三者の商標・音楽・素材が入っていないか、最後に確認する。
