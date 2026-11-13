# COBOL DEPLOY DIVISION (`cobolform`)

[English](README.md)

> 純粋な固定形式 COBOL を書くと、AWS CloudFormation にコンパイルされる。
> **"Pure fixed-format COBOL, now deploying multi-region AWS — `CALL "DEPLOY".`"**

[Kiroween 2026](https://kiroween.devpost.com/)（Devpost、2026/10/30〜12/4、締切 JST 12/5 07:00）への応募作品です。本命は **Resurrection** 部門で、Frankenstein と Costume Contest をサブに想定しています。

> **ステータス: 実装の初期段階。** `cobf compile` は、Network、Compute、Databases、コンテナ（ECS、EKS）、メッセージング（SQS、SNS）、エッジ（CloudFront、ACM、Route 53）に加えて S3、IAM、Lambda、DynamoDB まで、46 種類のリソースの COBOL を CloudFormation に変換し、出力は `cfn-lint` を通ります。`cobf deploy` と `cobf destroy` は一通り動き、S3、IAM、Lambda、DynamoDB（MRSC を含む）と、3 層構成のスタック一式（VPC、ALB、EC2 の Auto Scaling、RDS）は、実際の AWS アカウントにデプロイ済みです。ブラウザデモと、ほとんどの「癖」機能は未実装です。ルール上、応募対象は期間中に書いたコードのみです。

## コンセプト

COBOL は死んでいません。日本の自治体や金融の基幹系では今も動いています。ただ、クラウドのインフラを書く言語としては存在しません。

このプロジェクトは、COBOL を IaC 言語としてよみがえらせます。本物の固定形式 COBOL を書くと、独自のトランスパイラが CloudFormation に変換します。

- `01` グループ項目 = リソース
- `VALUE` 句 = プロパティ
- `SELECT ... ASSIGN TO` と `FD` = マネージド DB
- `CALL "DEPLOY"` = デプロイの意図の宣言

作者はかつて Oracle 8i のシステムを保守していました。当時はクラスタを組めず、DB サーバー間に DB リンクを手作業で張り巡らせて冗長化していました。いまは同じ意図を、マルチリージョン強整合の DynamoDB テーブルとして COBOL 数行で宣言できます。

### CDK ではなく、jsii でもない

CDK の多言語対応は jsii によるもので、1 つの TypeScript 実装を他言語から呼び出す仕組みです。本作は別物で、**静的トランスパイラ**です。`.cbl` を実行せず、テキストとして解析して CloudFormation を出力します。「CDK の新しい対応言語」は、開発体験を伝えるための比喩にすぎません。

## サンプル

東京・大阪にレプリカ、ソウルに witness を置く、マルチリージョン強整合（MRSC）の DynamoDB テーブルです。

```cobol
000100 IDENTIFICATION DIVISION.
000200 PROGRAM-ID. ORDER-DB.
000300 ENVIRONMENT DIVISION.
000400 CONFIGURATION SECTION.
000450 OBJECT-COMPUTER. AWS-AP-NORTHEAST-1.
000500 INPUT-OUTPUT SECTION.
000550 FILE-CONTROL.
000600     SELECT ORDERS-FILE ASSIGN TO "DYNAMODB-MRSC"
000700         ORGANIZATION IS INDEXED
000800         ACCESS MODE IS DYNAMIC
000900         RECORD KEY IS ORDER-ID
001000         ALTERNATE RECORD KEY IS ORDER-STATE WITH DUPLICATES
001100         FILE STATUS IS WS-FS.
001200 DATA DIVISION.
001300 FILE SECTION.
001400 FD  ORDERS-FILE.
001500 01  ORDER-REC.
001600     05  ORDER-ID         PIC X(36).
001700     05  ORDER-STATE      PIC X(10).
001800     05  ORDER-AMOUNT     PIC 9(9).
001900 WORKING-STORAGE SECTION.
002000 01  WS-FS                PIC XX.
002100 01  ORDERS-FILE-REGIONS.
002200     05  REPLICA-1        PIC X(20) VALUE "ap-northeast-1".
002300     05  REPLICA-2        PIC X(20) VALUE "ap-northeast-3".
002400     05  WITNESS-REGION   PIC X(20) VALUE "ap-northeast-2".
002500 PROCEDURE DIVISION.
002600 MAIN-PARA.
002700     CALL "DEPLOY".
002800     STOP RUN.
```

変換: `RECORD KEY` はパーティションキー、`ALTERNATE RECORD KEY` は GSI、`ASSIGN TO "DYNAMODB-MRSC"` は、トップレベルの `MultiRegionConsistency: STRONG`、2 つの `Replicas`、`GlobalTableWitnesses` の 1 要素を持つ `AWS::DynamoDB::GlobalTable` になります。

## 言語設計

方針は **「まず本物の COBOL として有効であること」** です。すべてのサンプルは GnuCOBOL の固定形式構文チェックを通します。独自予約語や Pro\*COBOL／`EXEC SQL` は使わず、IaC としての意味は規約（convention）で表現します。

| COBOL の要素 | インフラでの意味 |
|---|---|
| `PROGRAM-ID` | スタック名 |
| `OBJECT-COMPUTER` | 主リージョン（`AWS-AP-NORTHEAST-1` → `ap-northeast-1`） |
| `01` グループ項目 | リソース（論理 ID はデータ名の PascalCase） |
| `05 RESOURCE-TYPE ... VALUE "AWS::S3::Bucket"` | CloudFormation のリソース型 |
| 下位項目と `VALUE` | プロパティ |
| `PIC X(n)` / `PIC 9(n)` | 文字列／数値。長さを検証（`VALUE` が `n` 超ならエラー） |
| `OCCURS n TIMES` | 配列（IAM ステートメント、タグ） |
| `"REF:NAME"` / `"GETATT:NAME.ATTR"` | `Ref` / `Fn::GetAtt`（同一ファイル内の参照のみ） |
| `SELECT ... ASSIGN TO "DYNAMODB"`, `"DYNAMODB-MRSC"`, `"AURORA-DSQL"` | マネージド DB の宣言 |
| `ASSIGN TO "DBLINK"` | 意図的なエラー（DB リンクで冗長化する時代は終わりました） |
| `CALL "DEPLOY"` / `"DESTROY"` / `"DIFF"` | 既定アクションの宣言 |

### 対応しているリソース

COBOL から CloudFormation への変換は、[`src/mapping/`](src/mapping/) の対応表にあります。プロパティごとに 1 行で、読み取るエンジンは 1 つだけです。リソース型を足すときは、コードではなく表に行を足します。表のプロパティ名と列挙値は、すべて `cfn-lint` 同梱の公式 CloudFormation スキーマと突き合わせています。表の書き間違いは、デプロイではなくテストで失敗します。

| 分野 | リソース型 |
|---|---|
| Network | VPC、Subnet、InternetGateway、VPCGatewayAttachment、RouteTable、Route、SubnetRouteTableAssociation、EIP、NatGateway、SecurityGroup（インラインの ingress / egress ルールつき）、SecurityGroupIngress、SecurityGroupEgress |
| エッジ | Route 53 の HostedZone と RecordSet、ACM の Certificate、CloudFront の Distribution |
| Compute | EC2 Instance、IAM InstanceProfile、LaunchTemplate、AutoScalingGroup、Application / Network Load Balancer（同じ型で、`LB-TYPE` で切り替え）、TargetGroup、Listener、Classic Load Balancer |
| Databases | RDS の DBInstance、DBSubnetGroup、Aurora の DBCluster、ElastiCache（SubnetGroup、ReplicationGroup、CacheCluster）、DynamoDB（単一テーブルと MRSC グローバルテーブル） |
| コンテナ | ECS の Cluster、TaskDefinition（コンテナ 1 つ、環境変数の表）、Service、EKS の Cluster と Nodegroup、CloudWatch Logs の LogGroup |
| メッセージング | SQS の Queue（FIFO、デッドレターキュー）と QueuePolicy、SNS の Topic と Subscription |
| コア | S3 Bucket、IAM Role と ManagedPolicy、Lambda Function |

表で動くすべてのリソースに共通する決まり:

- 項目名の綴り間違いは、「もしかして」のヒントつきのエラーになり、黙って無視されません。安全設定の書き損じが消えてはいけないからです。
- 安全な既定値: EC2 と起動テンプレートは IMDSv2 必須、EBS は暗号化、RDS は暗号化ありで非公開、ユーザー名だけでパスワードが無い DB は RDS にパスワードを管理させます。平文のパスワードはエラーで、`SECRET:` か `SSM:` を使います。
- 危険な選択には警告: SSH、RDP、DB のポートを `0.0.0.0/0` に開く、DB の公開、IMDSv1、Classic Load Balancer、公開された Kubernetes API サーバー、公開 IP を持つタスク、暗号化されていないキューやキャッシュ、平文の HTTP や未確認のメールによる SNS 購読
- さらに安全な既定値: ECS のタスクには公開 IP を付けず、EKS はアクセスエントリ（API 認証）を使い、SQS は SSE、ElastiCache は保管時と転送時の暗号化、ロググループは指定が無ければ 30 日で消えます。
- `DEPENDS-ON`、`DELETION-POLICY`、`NAME-TAG` は、どのリソースでも使えます。AMI の値には `SSM:/aws/service/...` を書けます。
- 証明書つきの CloudFront は `AWS-US-EAST-1` で書く必要があります。CloudFront が証明書を受け付けるリージョンが、そこだけだからです。それ以外はエラーです。

ロードバランサー、EC2、RDS が 1 つのプログラムにそろうと、コンパイラは最後に 1 行足します。王道の 3 層構成を、また作りました。1998 年が返してほしがっています。[`examples/three-tier.cbl`](examples/three-tier.cbl) を見てください。

Aurora DSQL はストレッチ目標です。

### 固定形式のルール

| 桁 | 領域 | 扱い |
|---|---|---|
| 1–6 | 一連番号 | 任意。`--strict-sequence` では昇順必須 |
| 7 | 標識 | `*` コメント、`-` 継続行、`D` デバッグ行 |
| 8–11 | A 領域 | DIVISION、SECTION、段落名、`FD`、`01`・`77` レベル |
| 12–72 | B 領域 | 文、下位レベル項目 |
| 73–80 | 識別領域 | 無視。値を書くと警告 |

そのほかの「癖」: 文字列リテラル外の大文字強制、タブ禁止、80 桁超はエラー。

## はじめかた

パッケージはまだ npm に公開していないので、ソースからビルドします。Node.js 20 以上が必要です。GnuCOBOL は任意です。

```
npm install
npm run build
node dist/cli.js compile verify/samples/51-s3.cbl
```

公開後は、同じコマンドを `npx cobf ...` で実行できるようになります。

### ブラウザデモ

```
npm run web:build
cd web && python3 -m http.server 8791 --bind 127.0.0.1
```

その後、`http://127.0.0.1:8791/` を開きます。80 桁のルーラ（7・12・72 桁目にガイド線）つきの緑画面 CRT エディタの隣に、グリーンバー用紙の仮想ラインプリンターが並びます。コンパイルはページの中だけで動くので、AWS の資格情報がブラウザに渡ることはありません。エラーは血のように赤いインクで印字され、`ASSIGN TO "DBLINK"` を書くと 8i のサーバーの亡霊が現れます。ドットインパクト音は、既定で OFF です。実際のデプロイはページには含まれないので、`cobf deploy` を使ってください。

## CLI

パッケージは 1 つのバイナリを、正式名 `cobolform` と短縮別名 `cobf` の 2 つのコマンド名でインストールします。`compile`、`diff`、`deploy`、`destroy` はすべて実装済みです。`diff` は、表示のためだけに ChangeSet を作り、実行はせず、終了後に必ず削除します。

```
cobf compile <file.cbl> [--format json|yaml]   # CloudFormation 出力のみ（副作用なし）
cobf diff    <file.cbl>                         # 既存スタックとの ChangeSet 差分
cobf deploy  <file.cbl> [--yes | --force]       # ChangeSet 作成→実行→132桁帳票
cobf destroy <file.cbl> [--yes | --force]       # スタック削除（既定で確認プロンプト）
```

CLI でサブコマンドを明示した場合はそれが最優先です。省略した場合は、`.cbl` 内の `CALL` 文を既定アクションとして使います。ゴールデンテストと CI は `compile` に依存します。`--yes` は、非対話実行で確認プロンプトを省くためのフラグです。`--strict-sequence` はどのコマンドでも使え、連番が乱れていると拒否します。

## アーキテクチャ

```
.cbl -> [1] Card Reader -> [2] Parser -> AST -> [3] Semantic
     -> [4] IR -> [5] Emitter（CloudFormation JSON/YAML）
     -> [6] ラインプリンター帳票（132桁） / Deployer（CloudFormation API）
```

- 実装言語: TypeScript（Node.js）
- パーサ: 手書き。設計メモで決めたサブセットに限定し、範囲外は黙って無視せず `UNSUPPORTED-IN-MVP` の明示エラーにします。
- デプロイ: AWS SDK for JavaScript v3（`@aws-sdk/client-cloudformation`）と ChangeSet
- 配布: npm / `npx`。COBOL ランタイムは不要です。GnuCOBOL は「本物の COBOL か」を確かめる構文チェック用の任意依存です。

## 「癖」機能

以下はすべて動作します。

- 行と桁つきの桁ずれエラー。IBM 風のパロディのメッセージ番号つき（例: `file.cbl:1:7: CBF-0003-S SEVERITY 12: ...`）。`CBF` という接頭辞は独自のもので、実在の IBM のメッセージ ID は流用しません。警告は `SEVERITY 4` です。
- 小文字を書くと `LOWERCASE IS HERESY`
- `--strict-sequence`。1〜6 桁目の連番が昇順でないと、「カードデッキが乱れています」で失敗します。
- `STOP RUN` を書き忘れると、「JOB DID NOT TERMINATE」の警告
- `deploy` と `destroy` の 132 桁ラインプリンター帳票。ページヘッダ、頁番号、`TOTAL RESOURCES CREATED / UPDATED / DELETED` の合計行つき
- 失敗時の `ABEND S0C7` 風ダンプ。失敗処理のロジックと演出は分離しており、CI 向けの終了コードは正確に保ちます。
- IAM アクションの「呪われたワイルドカード」（`*`）警告と、S3 のパブリックアクセス遮断などの安全な既定値
- `DBLINK` は意図的なエラー

## 検証済みの内容

- **GnuCOBOL 3.2.0:** [`verify/samples/`](verify/samples/) の 4 本（`51-s3.cbl`, `52-lambda.cbl`, `53-policy.cbl`, `54-db.cbl`）が `cobc -fsyntax-only --fixed` を通過し、`-std=cobol85` モードでも通過しました。
- **実行確認:** ダミーのサブプログラム [`deploy.cbl`](verify/samples/deploy.cbl) とリンクして `cobc -x` でコンパイル・実行できました。`CALL "DEPLOY"` が通常の COBOL と同じく実行時に解決されることを示します。
- **CloudFormation のスキーマ:** `AWS::DynamoDB::GlobalTable` で MRSC を単一スタックに宣言できます。東京・大阪・ソウルは同じ AP region set に収まるため、サンプルの witness 配置は妥当です。
- **トランスパイラの出力:** [`tests/golden/`](tests/golden/) のゴールデン（S3、IAM ポリシー、Lambda、DynamoDB MRSC、3 層構成・エッジ・いにしえの例）が `cfn-lint` を通り、Vitest も通っています。
- **本物の CloudFormation（何も作らずに）:** 3 層構成・いにしえ・エッジ・コンテナ・EKS・キャッシュ・メッセージングの例に `cobf diff` を実行すると、CloudFormation は ChangeSet として受け付けました。ChangeSet は削除し、スタックも残っていません。
- **実際の AWS:** 実アカウントで、`examples/smoke-s3.cbl` をデプロイし、再デプロイ（変更なし）、削除まで行いました。バケットは、COBOL に書いたとおり、バージョニングが有効で、パブリックアクセスブロックの 4 項目がすべて有効でした。Lambda のゴールデン（IAM ロールと関数）もデプロイでき、関数を呼び出すと `{"statusCode":200}` が返りました。ポリシーのゴールデンもデプロイでき、ポリシー文書の中でバケットの ARN が解決されていました。
- **実際の失敗:** わざと不正なバケット名にしたところ、`ROLLBACK_FAILED` になりました。このとき、帳票が「元の状態に戻した」と表示する不具合が見つかりました。修正済みで、テストもあります。

- **MRSC:** DynamoDB のゴールデンが、東京・大阪にレプリカ、ソウルに witness を持つ強整合のグローバルテーブルとしてデプロイできました。東京に書き込んだ項目を、大阪から強整合読み取りで読み戻せました。最初の 1 回は、CloudFormation の内部で一時的な `UnrecognizedClientException` が出て失敗しました。ほかの形のグローバルテーブルでの実験は成功し、何も変えずに再実行しても成功したので、テンプレートの問題ではありません。

- **3 層構成:** `examples/three-tier.cbl` が 21 個のリソース（VPC、サブネット 4 つ、インターネットゲートウェイ、セキュリティグループ 3 つ、ALB、Auto Scaling グループ、RDS MySQL）としてデプロイできました。ALB は HTTP で `COBOL` と答え、ターゲットは `healthy` でした。EC2 に直接つなぐとブロックされたので、セキュリティグループの連鎖が効いています。インスタンスは IMDSv2 必須で、RDS は暗号化あり、非公開で、パスワードは Secrets Manager の管理でした。`destroy` で 21 個すべてを削除し、課金されるものは何も残りませんでした。
- **更新:** `VERSIONING-FLAG` を `"Y"` から `"N"` に変えて再デプロイすると、既存のスタックがその場で更新され（`UPDATE_COMPLETE`）、バケットのバージョニングが Enabled から Suspended に変わりました。

まだ検証していないこと: エッジのリソース（CloudFront、ACM、Route 53）、いにしえのロードバランサー、ECS、EKS、ElastiCache、SQS、SNS の例は、ChangeSet として受け付けられたものの、デプロイはしていません（ACM の検証には実ドメインが要り、EKS と ElastiCache は費用と時間がかかるためです）。更新が失敗したときのロールバックも未検証です。元の `52-lambda.cbl` には `Code` 項目が無いため、警告つきでコンパイルできますが、デプロイはできません。`tests/golden/lambda/` のように `FN-CODE-INLINE` か `FN-CODE-S3` を使ってください。`53-policy.cbl` は別ファイルで定義したバケットを参照するため、単体では失敗します。参照は 1 ファイル内でだけ解決します。

```
cd verify/samples
cobc -fsyntax-only --fixed 51-s3.cbl
cobc -x -o run 51-s3.cbl deploy.cbl && ./run
```

## ロードマップ

1. 完了: Card Reader、パーサ、セマンティックチェック。Vitest とゴールデンテスト（`.cbl` → 期待する CloudFormation）で固める
2. 完了: S3、IAM、Lambda、DynamoDB、Network、Compute、Databases、コンテナ、メッセージング、エッジの Emitter。ゴールデンの出力に `cfn-lint` を実行
3. ほぼ完了: Deployer と 132 桁帳票。更新が失敗したときのロールバックを、実アカウントで試すことが残っています。
4. 初版完了: ブラウザデモ。緑画面の CRT エディタと仮想ラインプリンターが、ページ内でコンパイルします。残り: 実デプロイのための認証付きバックエンド（AWS 資格情報をブラウザに渡さないため）。
5. ストレッチ: Aurora DSQL、CDK L1 出力、cfn-guard によるセキュリティポリシーチェック

## Kiro での開発

Kiro の Specs（EARS 記法の requirements → design → tasks）、Hooks（`.cbl` 保存時の構文チェックと CloudFormation 生成）、Steering（COBOL 規約と AWS セキュリティ規約）、MCP（AWS ドキュメント参照）を使う予定です。

## リポジトリ構成

```
README.md / README_ja.md   このファイル（英語／日本語）
docs/DESIGN.md             設計メモ全文（日本語）
src/                       トランスパイラと CLI（TypeScript）
tests/                     Vitest の単体テストとゴールデン
examples/                  デプロイして試せるプログラム（smoke-s3.cbl）
web/                       ブラウザデモ（エディタ、ラインプリンター）
verify/samples/            GnuCOBOL で検証済みのサンプル
```

## 関連プロジェクト

- [yomiyasu（よみやす）](https://github.com/nanaism/yomiyasu): nanaism 氏による、AI が生成した日本語を自然で読みやすい日本語に推敲する Agent Skill。技術記事、設計書、PR 説明文に向いており、本プロジェクトの日本語ドキュメント（`README_ja.md`、`docs/DESIGN.md`）の推敲に使えます。

## 作者

柴尾 哲也（AWS Community Builder – Security / JAWS-UG 佐賀）

## ライセンス

MIT（[LICENSE](LICENSE) を参照）
