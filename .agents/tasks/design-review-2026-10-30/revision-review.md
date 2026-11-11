# 改訂レビュー: `docs/DESIGN.md`（design-review-2026-10-30 の指摘反映）

`docs/DESIGN.md` を設計レビュー報告（`report.md` §4）の指摘に沿って改訂したコミット（`2d9a086`）のレビュー。改訂は COBOL→CFN トランスパイラ企画書に、意味論の写像表・リージョン決定ルール・デプロイ側エラー処理・パーサ受理サブセット・認証経路・非ゴール節など、実装着手前に必要な論点を追記した。日本語・トーン・節番号・✅/⚠️ 凡例は保持され、§16（実機検証ログ）・§9（テスト戦略）・CDK/jsii 区別も削られていない。H1〜H3・M1〜M5・L1〜L4 の 13 指摘すべてが、指摘された節に 1 回ずつ反映されている（confirmed）。サンプル編集は許可された `54-db.cbl` の `OBJECT-COMPUTER` 1 行のみ（confirmed）。

Watch for:
- （likely）`verify/` はこのコミットが初回のため `54-db.cbl` は「編集」ではなく「新規追加」として記録されている。ただし追加された内容は §5.4 と逐語一致し、許可された `OBJECT-COMPUTER. AWS-AP-NORTHEAST-1.` 1 行を含む形になっており、タスクの「1 行の OBJECT-COMPUTER 追記」制約の趣旨を満たす。他サンプル（51/52/53/deploy）は未変更（confirmed）。
- （confirmed）ブロッキングな指摘・未反映項目・矛盾は検出されなかった。

**Verdict**: APPROVED

## High-level view

H1 は §4.7「COBOL → CFN 写像表」として新設され、S3 / IAM Role・ManagedPolicy / Lambda / DynamoDB の 4 リソースを COBOL 項目→CFN プロパティの行単位で定義し、サンプルに欠ける必須プロパティ（Lambda `Code`/`Role`、IAM `AssumeRolePolicyDocument`/`PolicyDocument`、S3 `VersioningConfiguration`/`PublicAccessBlockConfiguration`）の補完方針まで含む。これで [3]Semantic / [5]Emitter の実装前提が揃った。

H2 のリージョン二重定義は §4.5 の「リージョン決定ルール」で一本化された。`OBJECT-COMPUTER` を主リージョンの唯一の起点とし、`-REGIONS` は MRSC 構成情報のみ、`REPLICA-1` は主リージョンと一致、`CONFIGURATION SECTION` 欠落時は MRSC に限り `REPLICA-1` をフォールバック、という優先順位を定義。あわせて `54-db.cbl` に `OBJECT-COMPUTER. AWS-AP-NORTHEAST-1.` を 1 行追記し、`51-s3.cbl` と対称化して主リージョンが一意に決まるようにしている。

H3 は §5 冒頭の注記で「サンプルは有効な COBOL の実証であって、そのままデプロイ可能な CFN ではない」と明言し、各サンプルを MVP でデプロイ可能にする拡張（特に Lambda の `Code`）を §4.7(c) と結び、§12 W2 の実デプロイ目標と矛盾しない形にした。

M1〜M5 はそれぞれ §4.6（デプロイ側エラー処理、UI 層とロジック層の分離）、§4.8（パーサ受理サブセット表）、§8（鍵をブラウザに渡さない認証経路）、§9.2（ゴールデン初期作成フロー＋`UPDATE_GOLDEN`）、§4.6/§11（CLI `compile` の MVP 位置づけ）に反映。L1〜L4 は §11 の非ゴール節集約、§5/§6 の Emitter 自動生成を MVP 外と明記、§1 デモ②の witness=ソウル明記、§4.6/§9.6 の `--yes`/`--force` 非対話フラグで対応。

節間の相互参照（§4.5↔§4.7↔§5.4、§4.6↔§9.6、§4.7↔§9.2 など）は実在する節を指しており、日本語の記述は一貫して読める。

<details>
<summary>Issues (0)</summary>

ブロッキング／非ブロッキングを問わず、対応すべき指摘は検出されなかった。全 13 項目が指摘どおりの節に過不足なく反映され、保持要件（§16・§9・CDK/jsii 区別・✅/⚠️ 凡例・既存の検証済みクレーム）も満たされている。

</details>

<details>
<summary>Details</summary>

### H1 — §4.7 の COBOL→CFN 写像表（confirmed）

§4.7 が新設され、共通規約（`01`→論理 ID の PascalCase 化、`RESOURCE-TYPE VALUE`→`Type`、`REF:`/`GETATT:` の解決スコープ＝同一ファイルの `01` 名のみ）に続き、4 リソースを個別表で定義している。指摘された「サンプルに無い CFN 必須プロパティの補完」は漏れなく埋まっている:

- S3: `VersioningConfiguration.Status`（`"Y"`→`Enabled`）、`PublicAccessBlockConfiguration` の 4 フラグ（省略時 Security by default で全 `true`）。
- IAM Role: `AssumeRolePolicyDocument` を `TRUST-SERVICE` から定型 JSON 生成（テンプレート文字列を明記）。ManagedPolicy: `PolicyDocument` を `STMT OCCURS` から組み、`Version` 付与。
- Lambda: `Role` は `FN-ROLE-ARN`（`GETATT:` 規約）で供給済み、`Code` は新規項目 `FN-CODE-S3`／`FN-CODE-INLINE` の導入で `Code.S3Bucket`/`S3Key`／`ZipFile` に対応。両方欠落はデプロイ対象で明示エラー、`compile` のみ警告。
- DynamoDB: `DYNAMODB`（単一）と `DYNAMODB-MRSC`（`MultiRegionConsistency: STRONG` 固定）を `ASSIGN TO` で分岐、キー・GSI・レプリカ・witness・主リージョンの対応を定義。

§5 Emitter 行と §11 非ゴール節が「MVP は §4.7 の手書き写像表を正とする」と一致して参照しており、重複記述ではなく単一の正本（§4.7）を指している。

### H2 — リージョン決定ルールの一本化（confirmed）

§4.5 に「リージョン決定ルール」小節が入り、`OBJECT-COMPUTER`＝主リージョンの唯一の起点、`-REGIONS`＝MRSC 構成情報のみ（主リージョンを上書きしない）、`REPLICA-1`＝主リージョンと一致、`CONFIGURATION SECTION` 欠落時は MRSC に限り `REPLICA-1` をフォールバック、Semantic 段で `OBJECT-COMPUTER` と `REPLICA-1` 不一致を警告（`OBJECT-COMPUTER` 優先）、という優先順位が明示された。

タスクが許した対応（「DB 主リージョン＝REPLICA-1 を文書化」か「54-db.cbl に 1 行 OBJECT-COMPUTER を追記」）のうち、コミットは後者を選択。`54-db.cbl` 5 行目 `000450 OBJECT-COMPUTER. AWS-AP-NORTHEAST-1.` が §5.4 のコードブロックと逐語一致し、`REPLICA-1`（`ap-northeast-1`）と整合。`51-s3.cbl` との非対称が解消され、主リージョンが一意に決まる。構文・実行の再検証も §16.2/§16.3・コミットメッセージに記録済み。

### H3 — サンプルの CFN 妥当性注記（confirmed）

§5 冒頭に「現サンプルは有効な COBOL の実証であって、そのままデプロイ可能な CFN の実証ではない」注記が加わり、各リソースの拡張要否（Lambda のみ `Code` 追加が必要、IAM/S3/DynamoDB は Emitter 補完で拡張不要）を列挙。構文実証サンプル（`verify/samples/`）とデプロイ用サンプルは目的が異なると整理し、§12 W2 の実デプロイ目標と矛盾させない旨を明記。§4.7(c) の Lambda `Code` 補完方針と相互参照している。

### M1 — デプロイ側エラー処理（confirmed、§4.6）

§4.6 に「デプロイ側エラー処理（UI 層とロジック層を分離）」節を追加。ChangeSet 作成失敗・実行失敗・自動ロールバック・スタック既存（UPDATE への切替、未完スタックは削除促し）・認証失敗（鍵値を印字しない）を表で分類し、各々に終了コードと UI（`CHANGESET REJECTED`/`ABEND S0C7` 風ダンプ/`ROLLBACK`/`SECURITY VIOLATION`）を割り当て。演出（§7 の ABEND UI）は分岐判断を持たず、ロジック層が正規化した結果を印字するだけ、と分離が明文化されている。失敗モードの性格づけ（`NO_CHANGES` は正常終了、非 0 はすべて CI を赤）が保持されている。

### M2 — パーサ MVP 受理サブセット（confirmed、§4.8）

§4.8 に受理／明示エラーの線引き表を新設。継続行（文字列分割のみ受理、数値・非リテラルは明示エラー）、ピリオド（冗長／欠落は警告）、複数 `MOVE`（最後の MOVE を採用、条件分岐下は非対象）、`OCCURS` 添字範囲（定数 1..n 受理、範囲外・変数添字は明示エラー）、`REF:`/`GETATT:` 循環参照（明示エラー）、未定義参照（明示エラー）を網羅。サブセット外文法（`PERFORM`/算術/`IF`/`EVALUATE`）は `UNSUPPORTED IN MVP` とし黙って無視しない方針。§13 の「パーサ沼」リスク・§7/§9.1 のエラー方針と整合。

### M3 — ブラウザ内コンパイル→実デプロイの認証経路（confirmed、§8）

§8 に「認証経路」節を追加。AWS の鍵をブラウザに一切渡さず、`compile`（副作用なし）はブラウザ内完結、実デプロイのみ認証付きバックエンドに委譲。資格情報はサーバー側のみ（デモ専用 IAM ロールへの `AssumeRole` による短期クレデンシャル／インスタンスロール）、長期キーは埋め込まない、エラー時も鍵値を帳票・ログに出さない、と明記。§4.6 の認証失敗ハンドリングと一致。トラスト境界（ブラウザ↔バックエンド↔AWS）の資格情報配置が明示されており、鍵漏洩面のセキュリティ観点が適切に surfaced されている。

### M4 — ゴールデン期待値の初期作成フロー（confirmed、§9.2）

§9.2 に「期待 CFN の初期作成フロー」を追加。初回は「生成→人手レビュー（§4.7 写像表と cfn-lint に照合）→確定」、小さな決定的ケースは手書き併用で二重確認、以後の変更のみ `UPDATE_GOLDEN=1` で差分更新しレビュー必須、CI では `UPDATE_GOLDEN` 無効化、という運用が `UPDATE_GOLDEN` ガードとセットで定義された。

### M5 — CLI `compile` の MVP 位置づけ（confirmed、§4.6/§11）

§4.6 に「`compile`（副作用なし CFN 出力）は必達。ゴールデンテスト（§9.2）と CI（§9.6）が依存するため `deploy`/`destroy` 以前に成立すべき基盤コマンド」と明記。§11 MVP でも「CLI `compile`＝必達の基盤コマンド」と同一趣旨で記述され、§4.6 と §11 の記述が揃った。

### L1〜L4（confirmed）

- L1: §11 に「非ゴール（散在していた非ゴールの集約）」小節を新設し、jsii 非依存・`EXEC SQL` 不使用・Skeleton Crew 対象外・Emitter 自動生成 MVP 外・DSQL ストレッチ・クロスファイル参照非対象・サブセット外文法・CDK L1 相互運用ストレッチを参照付きで一覧化。
- L2: §5 Emitter 行と §6[5]・§11 非ゴールで「Emitter 写像表の自動生成は MVP 外（ストレッチ）、MVP は §4.7 の手書き表が正」と明記し、⚠️ 案の浮きを解消。
- L3: §1 デモ②が「レプリカ 2 リージョン（東京・大阪）＋第 3 のリージョンに置く witness（ソウル）」と witness のリージョンを明示。
- L4: §4.6 に `destroy`/`deploy` の `--yes`（別名 `--force`）非対話フラグを CLI 仕様へ追加し、§9.6 の nightly 非対話 DESTROY が `cdk-cobol destroy --yes` を使うと明記。対話プロンプト（§4.6）と CI 非対話（§9.6）が 1 フラグで両立。

### 保持要件の確認（confirmed）

- §16（実機検証ログ 16.1〜16.6）は全小節が残存。GnuCOBOL 3.2.0 構文チェック・実行実証・MRSC 単一スタック確認・予約語 1006 語チェックの ✅ クレームは未改変。
- §9（テスト戦略 9.1〜9.6）は Vitest・ゴールデン・GnuCOBOL CI・cfn-lint・cobol-check が残存し、M4 の初期作成フロー追記で拡張されたのみ。
- CDK/jsii の技術的区別は §1 注記・§6 冒頭ノート・§6 本文で保持。
- ✅/⚠️ 凡例（冒頭「✅ = 確認済み / ⚠️ = 未検証・要確認」）は維持。既存の検証済みクレーム（§4.4 予約語、§4.5 MRSC、§5 構文チェック）は改変なし。

### サンプル編集範囲（confirmed）

`git show --stat HEAD -- verify/` は `verify/samples/54-db.cbl` のみの変更を示す。51/52/53/deploy.cbl は未変更。54-db.cbl の変更内容は許可された `OBJECT-COMPUTER` 行を含み §5.4 と一致。許可範囲を超えるサンプル編集は無く、この点の finding は無い。

### README 整合（confirmed）

README の方針（「純粋な固定形式 COBOL で AWS の IaC を書き、CloudFormation にコンパイルするフレームワーク」「10/30 まで企画・設計のみ」）と改訂後の DESIGN（独自トランスパイラ、企画段階ステータス）は矛盾しない。

</details>

<details>
<summary>File map</summary>

- `docs/DESIGN.md` — 設計メモ全体。H1（§4.7）・H2（§4.5）・H3（§5）・M1（§4.6）・M2（§4.8）・M3（§8）・M4（§9.2）・M5（§4.6/§11）・L1〜L4（§11/§5/§6/§1/§4.6/§9.6）を追記。
- `verify/samples/54-db.cbl` — H2 の `OBJECT-COMPUTER. AWS-AP-NORTHEAST-1.` 1 行（§5.4 と一致）を含む DB サンプル。

全差分: `git -C /Users/tetsuya/Desktop/work/development/kiroween2026 show 2d9a086`

</details>
