# COBOL DEPLOY DIVISION — Kiroween 2026 設計メモ

- 作成: 2026-10-16（JST） / 作成者: 柴尾 哲也（AWS Community Builder – Security / JAWS-UG 佐賀）
- ステータス: **企画段階（実装は 10/30 解禁後）** / 2026-10-30 に技術前提の実機検証を実施（§16）
- 凡例: ✅ = 確認済み / ⚠️ = 未検証・要確認（2026-10-30 検証分は本文に ✅ と日付を付記）

---

## 0. 前提とルール

| 項目 | 内容 |
|---|---|
| ハッカソン | Kiroween 2026（https://kiroween.devpost.com/） |
| 期間 | 2026/10/30 〜 12/4 |
| 締切 | **JST 2026/12/5（土）07:00** |
| 審査基準・提出要件・賞 | ⚠️ TBD（10/30 公開予定）。公開後に本メモを更新 |
| 新規性ルール | 期間中に新規作成したプロジェクトのみ対象 → **本メモは計画のみ**（構文例レベルに留める） |
| 部門 | **Resurrection（本命）**、Frankenstein / Costume Contest（サブ） |
| 言語方針 | **純粋な標準 COBOL（固定形式）のみ**。Pro\*COBOL / `EXEC SQL` は使わない |

---

## 1. ストーリー / ピッチ

### One-liner（英語）
> **"Pure fixed-format COBOL, now deploying multi-region AWS — `CALL "DEPLOY".`"**
>
> 別案: *"The redundancy that an Oracle 8i app once built from DB links is now a dozen lines of COBOL."*

### 日本語ピッチ
学生時代〜駆け出しの頃、固定形式の COBOL（1〜6桁目に連番、7桁目に標識、8桁目からコード）を解析し、プリンターに直接書き出す処理など COBOL の「癖」をたっぷり見てきた。

解析したのは、COBOL / Pro\*COBOL で書かれ、バックエンドが Oracle 8i の業務アプリケーションで、目的は Java 化だった。当時の 8i はクラスタ（RAC）を組めず、DB サーバー 3 台（厳密には 4 台：3 台アクティブ＋1 台スタンバイ、結局全部アクティブ）が **DB リンクで相互にデータをやり取りして**、冗長構成を取っていた。

それから 20 年あまり。かつてそのアプリが DB リンクで実現していた冗長化は、いまや **COBOL の `SELECT ... ASSIGN` と `FD` 数行で、マルチリージョン・強整合のマネージド DB として宣言できる**。COBOL を CDK の「新しい対応言語」のように扱い、CloudFormation にコンパイルするフレームワークで、死んだ言語をクラウドによみがえらせる。

> ⚠️ **CDK との技術的な区別（説明・審査対策）**: CDK の多言語対応は**トランスパイルではなく jsii**（TypeScript 実装を各言語から呼び出すバインディング生成）で実現されている。本作は jsii で「CDK の対応言語に COBOL を足した」のではなく、**COBOL ソースを静的に解析して CloudFormation を出力する独自トランスパイラ**である（§6）。したがって対外的には「CDK **的な開発体験**（IaC をプログラミング言語で書く）を、COBOL から**独自トランスパイラで再現した**」と表現する。「CDK の新言語」はあくまでキャッチコピー／比喩として使い、技術説明では jsii との混同を避ける（CDK を知る審査員対策）。

※ 8i の DB リンク構成は**語り（ナラティブ）としてのみ**使い、コード上は標準 COBOL のファイル定義で表現する。

### デモの山場（3分動画想定）
1. 緑画面で `.cbl` を書く。7桁目をずらすと怖い演出つきで**桁ずれエラー**
2. `SELECT ORDERS-FILE ASSIGN TO "DYNAMODB-MRSC"` と `FD` を書く → レプリカ 2 リージョン（東京・大阪）＋**第 3 のリージョンに置く witness（ソウル）**によるマルチリージョン強整合（MRSC）テーブルに化ける
3. `CALL "DEPLOY"` → **132桁ラインプリンター帳票**でデプロイ結果が印字される
4. 「2005年: DB リンク相互接続 + 手順書」対「2026年: COBOL 十数行」の対比で締め

---

## 2. なぜ COBOL が Resurrection に当てはまるか

- **COBOL は「死んだ」のではなく「クラウドの世界で死んでいる」**。日本の自治体や金融の基幹系ではいまも稼働している（柴尾が触れたシステムも当時すでに約 30 年もので、今も動いているかもしれない）。一方で、クラウドや IaC を書く言語としては完全に存在しない。
- つまり「延命・移行」ではなく、**COBOL そのものをクラウド構築言語としてよみがえらせる**のが本作のフレーミング。CDK の対応言語（TypeScript / Python / Java / C# / Go）に COBOL が並ぶ、という絵が Resurrection の「意外性」になる。
- 作者は COBOL / Pro\*COBOL のアプリケーションを実際に**解析し、Java 化しようとした**経験がある（日常的に COBOL を書いていたわけではない）。8i の DB リンクによる冗長構成も、その解析で知った。この**解析者としての視点**が説得力になる。

### 検討して見送った案：Struts 1 / Struts 2 / Spring
- ✅ Struts 1 は **2013/4/5 に EOL**（最終リリース 1.3.10、2008/12）。Struts 2.3 は 2019/9/12、2.5 は 2023/10/30 に EOL。
- 見送り理由: 「古い Java Web アプリを新基盤へ」は**移行ツールっぽく見え**、意外性が薄い。Spring は現役で「復活」にならない。
- **デモの小ネタとして採用可**: COBOL で定義した Lambda の上で、Struts 1 時代風（`.do` URL、テーブルレイアウト、`<html:form>` 風）の画面を返す。⚠️ ストレッチ

---

## 3. 部門フィット

| 部門 | 主張 | 強さ |
|---|---|---|
| **Resurrection** | 基幹系に閉じ込められた COBOL を、IaC 言語としてクラウドに復活 | ◎ 本命 |
| Frankenstein | 1959年生まれの COBOL × CloudFormation × マルチリージョン強整合 DB という縫い合わせ | ○ |
| Costume Contest | 緑の CRT／グリーンバー連続帳票のホラー UI | ○（本命 UI で兼ねる） |
| Skeleton Crew | 対象外（余力があれば COBOL→IR の骨格から Terraform 版を派生） | △ |

⚠️ 複数部門への同時応募可否は 10/30 公開の規約で確認。

---

## 4. 言語設計

### 4.1 設計方針：**「本物の COBOL としても有効」**
- 全サンプル `.cbl` は **GnuCOBOL の固定形式構文チェックを通す**（§9）。「COBOL 風 DSL」ではなく「本物の COBOL」と言い切るため。
- 独自予約語は作らず、**規約（convention）**で IaC の意味を表す：
  - リソース = `WORKING-STORAGE` の `01` グループ項目
  - リソース型 = `05 RESOURCE-TYPE PIC X(..) VALUE "AWS::S3::Bucket".`
  - プロパティ = 下位レベル項目と `VALUE` 句（または `PROCEDURE DIVISION` の `MOVE`）
  - データベース = `FILE-CONTROL` の `SELECT ... ASSIGN TO` ＋ `FILE SECTION` の `FD`
  - 操作 = `CALL "DEPLOY"` / `CALL "DESTROY"` / `CALL "DIFF"`（標準の CALL 文。意図の宣言。実行制御は CLI＝§4.6）
- Pro\*COBOL / `EXEC SQL` は**一切使わない**。

### 4.2 固定形式（Fixed Format）ルール ✅（GnuCOBOL マニュアル準拠。GnuCOBOL の既定も fixed）

| 桁 | 領域 | 本フレームワークでの扱い |
|---|---|---|
| 1–6 | 一連番号領域 | 任意。`--strict-sequence` では昇順必須（「カードデッキを床にぶちまけた」再現） |
| 7 | 標識領域 | `*` コメント、`-` 継続行、`D` デバッグ行（`--debug` 時のみ出力に反映） |
| 8–11 | A 領域 | DIVISION / SECTION / 段落名、`FD`、`01`・`77` レベル |
| 12–72 | B 領域 | 文、下位レベル項目、SELECT 句 |
| 73–80 | 識別領域 | 無視。ここに値を書くと警告「73桁目以降は読まれない」 |

追加の「癖」ルール: 予約語・データ名の**大文字強制**（文字列リテラル内は可）、タブ禁止、80桁超エラー。

### 4.3 DIVISION のマッピング

| DIVISION / SECTION | IaC での意味 | CFN 出力 |
|---|---|---|
| `IDENTIFICATION` | `PROGRAM-ID` = スタック名、`AUTHOR` 等 = タグ | `Description`, `Metadata`, タグ |
| `ENVIRONMENT` › `CONFIGURATION` | `SOURCE-COMPUTER` = アカウント、`OBJECT-COMPUTER` = **主リージョン**（`AWS-AP-NORTHEAST-1` → `ap-northeast-1`）。リージョン決定の唯一の起点（§4.5 のリージョン決定ルール参照） | デプロイ先 |
| `ENVIRONMENT` › `INPUT-OUTPUT` › `FILE-CONTROL` | `SELECT 論理名 ASSIGN TO "<DBエンジン>"` = DB 宣言 | DB リソース |
| `DATA` › `FILE SECTION` | `FD` + レコード定義 = テーブルスキーマ（キー属性） | 属性定義・キー |
| `DATA` › `WORKING-STORAGE` | リソース群、および DB のリージョン設定 | `Resources` |
| `DATA` › `LINKAGE SECTION` | パラメータ | `Parameters` |
| `PROCEDURE` | `MOVE`（値設定）、`DISPLAY`（Outputs 表示）、`CALL "DEPLOY"` 等（意図の宣言＝§4.6）、`STOP RUN` | CLI アクション |

### 4.4 レベル番号・PIC 句
- `01` = リソース（論理 ID はデータ名を PascalCase 化：`LOGS-BUCKET` → `LogsBucket`）
- `05` = プロパティ、`10` 以降 = ネストプロパティ
- `PIC X(n)` = 文字列。**VALUE が n を超えるとエラー**（S3 バケット名は `PIC X(63)` で自然に上限、という小ネタ）
- `PIC 9(n)` = 数値、`88` レベル = 真偽値・列挙
- `OCCURS n TIMES` = 配列（IAM Statement、タグ）
- 参照: `"REF:LOGS-BUCKET"` / `"GETATT:FN-ROLE.ARN"` → `Ref` / `Fn::GetAtt`（規約文字列）
- データ名は COBOL 予約語との衝突を避けるため接頭辞付き（`FN-TIMEOUT-SEC` 等）。✅ 2026-10-30 `cobc --list-reserved`（GnuCOBOL 3.2.0、1006 語）で確認: `STATUS`/`TIMEOUT`/`ACTION`/`AUTHOR` は**予約語**。§5 の全サンプルのデータ名（`FN-TIMEOUT-SEC`, `WS-FS`, `STMT-ACTION`, `STMT-EFFECT` 等、接頭辞で回避済み）は全て非予約語を確認。

### 4.5 データベース：ファイル定義 → マネージド DB
COBOL の索引ファイル（ISAM/VSAM 的な `ORGANIZATION IS INDEXED`）を、そのままマネージド DB に読み替える。

| COBOL | 生成物 |
|---|---|
| `ASSIGN TO "DYNAMODB"` | DynamoDB テーブル（単一リージョン） |
| `ASSIGN TO "DYNAMODB-MRSC"` | **DynamoDB Global Tables・マルチリージョン強整合（MRSC）** ✅ 2025/6/30 GA。3 リージョン（3 レプリカ or 2 レプリカ＋witness）。東京・大阪・ソウル等で利用可 |
| `ASSIGN TO "AURORA-DSQL"` | **Aurora DSQL マルチリージョンクラスタ**（PostgreSQL 互換）✅ 2025/5/27 GA。2 ピア＋ログ専用 witness。2026/7 時点で東京・大阪・ソウル含む 16 リージョンでマルチリージョン可（ストレッチ） |
| `RECORD KEY IS X` | パーティションキー（DSQL なら主キー） |
| `ALTERNATE RECORD KEY IS Y [WITH DUPLICATES]` | GSI（DSQL ならインデックス） |
| `FD` のレコード項目 `PIC X` / `PIC 9` | 属性型 `S` / `N`（キー属性のみ定義に出す） |
| `WORKING-STORAGE` の `<ファイル名>-REGIONS` グループ | レプリカ／witness リージョン |
| `ASSIGN TO "DBLINK"` | **意図的にエラー**：「DB リンクの相互接続で冗長化する時代は終わりました。DYNAMODB-MRSC を使え」（8i の思い出イースターエッグ） |

#### リージョン決定ルール（`OBJECT-COMPUTER` と `-REGIONS` の優先順位）✅ 決定
`OBJECT-COMPUTER`（主リージョン）と `<ファイル名>-REGIONS` グループ（レプリカ／witness）は**役割が異なり、二重定義ではない**。両者の関係を次のとおり一本化する:

1. **主リージョン（デプロイ先）は常に `OBJECT-COMPUTER` が唯一の起点**（§4.3）。CFN デプロイを実行するリージョンを決める。
2. **`-REGIONS` グループは MRSC の構成情報のみ**を与える。`REPLICA-1` は主リージョンと一致させる（＝ `OBJECT-COMPUTER` と同一リージョン）。`REPLICA-2` が追加レプリカ、`WITNESS-REGION` が witness。`-REGIONS` は主リージョンを上書きしない。
3. **`OBJECT-COMPUTER` 省略時のデフォルト**: `CONFIGURATION SECTION` が無いファイルでは、`DYNAMODB-MRSC` の場合に限り `REPLICA-1` を主リージョンとみなす（フォールバック）。それ以外（S3/IAM/Lambda 等で `OBJECT-COMPUTER` も `-REGIONS` も無い）はデプロイ時に明示エラー（`compile` では AWS CLI/環境変数の既定リージョンにフォールバックして警告）。
4. **整合性チェック（Semantic 段）**: `OBJECT-COMPUTER` と `REPLICA-1` が食い違う場合は警告し、`OBJECT-COMPUTER` を優先する。

> サンプル整合: `54-db.cbl` は上記 2 を満たすよう `OBJECT-COMPUTER. AWS-AP-NORTHEAST-1.`（＝`REPLICA-1` の東京）を追加済み（§5.4、1 行の最小追記）。これで `51-s3.cbl` と対称になり、「主リージョンがどこから来るか」が一意に決まる。フォールバック規則 3 は `OBJECT-COMPUTER` を省いた MRSC ファイルでも成立する保険として残す。

✅ 2026-10-30 検証（AWS公式ドキュメント）: CloudFormation `AWS::DynamoDB::GlobalTable` で MRSC を単一スタック宣言可能。
- **GlobalTable のトップレベル**プロパティ `MultiRegionConsistency: STRONG` を指定（MREC/MRSC の切替）。※ 当初メモは `ReplicaSpecification` 内と誤記していた。2026-11-11 に公式スキーマと `cfn-lint` で訂正。
- `GlobalTableWitnesses`（配列・最大 1 件、要素は `{ "Region": String }`）で witness リージョンを指定。「3レプリカ or 2レプリカ＋1 witness」。`Replicas` には**スタックのリージョンのレプリカが必須**。
- witness はレプリカと別リージョンかつ**同一 region set 内**必須。**AP region set = 東京（ap-northeast-1）・ソウル（ap-northeast-2）・大阪（ap-northeast-3）**。
  → §5.4 の REPLICA-1=東京／REPLICA-2=大阪／WITNESS=ソウルは AP region set に完全に収まる（妥当）。
- 2026/9 に追加リージョン・クロス大陸構成もサポート済み。

⚠️ 実装前に残る確認: Aurora DSQL のマルチリージョンピアリングを CFN 単一スタックで表現できるか（`AWS::DSQL::Cluster` の有無）。

### 4.6 操作モデル：CALL 文（意図の宣言）＋ CLI サブコマンド（実行制御） ✅ 決定（§15-Q7）

`.cbl` の `CALL` 文と CLI サブコマンドは**役割を分離**し、両立させる。

| 層 | 役割 | 例 |
|---|---|---|
| `.cbl` の `CALL "DEPLOY"` 等 | **意図の宣言**。そのプログラムの既定アクション（PROCEDURE DIVISION の主処理）。本物の COBOL として構文・実行が成立する（§16.3 実証済み） | `CALL "DEPLOY"` / `CALL "DESTROY"` / `CALL "DIFF"` |
| CLI サブコマンド | **実行の制御**。CI・ゴールデンテスト（副作用なし）と実デプロイを分離。CLI 指定が最優先 | 下表 |

> CLI コマンド名は正式名 `cobolform` と短縮別名 `cobf` の 2 つ（npm の複数 bin 登録で両方が有効。§6/§15-Q1）。以下の例では日常使い想定の短縮形 `cobf` を用いるが、すべて `cobolform` と読み替えても同じ。

```
cobf compile <file.cbl> [--format json|yaml]   # CFN 出力のみ。副作用なし（CI/ゴールデンテスト用）
cobf diff    <file.cbl>                         # 既存スタックとの ChangeSet 差分
cobf deploy  <file.cbl>                         # ChangeSet 作成→実行→132桁帳票
cobf destroy <file.cbl>                         # スタック削除（要確認プロンプト）
```

**優先順位ルール:**
1. CLI サブコマンドを明示 → それが実行される（`CALL "DEPLOY"` と書いた `.cbl` に `cobf diff` すれば差分のみ）。
2. CLI でサブコマンド省略時 → `.cbl` の `CALL` 文を既定アクションとして採用（`CALL "DEPLOY"` なら deploy）。
3. `CALL` 文が複数/未記載の扱いは Semantic 段（§6[3]）で検証：主段落の最初の `CALL "<OP>"` を既定とし、`CALL` が無ければ `compile` 既定。

**根拠:**
- CALL 文を残すことで「本物の COBOL として動く」実証（§16.3）＝ §4.1 の弱点対策を維持。
- CLI を持つことで `compile`（副作用なし）と `deploy` を分離でき、ゴールデンテスト（§9.2）・CI（§9.6）が成立。
- `DESTROY`/`DIFF` を `.cbl` 書き換えなしに実行できる。

✅ MVP 範囲（§11 と一致）: `compile` / `deploy` / `destroy` を必達。特に **`compile`（副作用なし CFN 出力）は必達**。ゴールデンテスト（§9.2）と CI（§9.6）が `compile` に依存するため、`deploy`/`destroy` 以前に成立していなければならない基盤コマンドである。`diff`（ChangeSet のプレビュー表示）はストレッチ寄り。`CALL "DIFF"`/`CALL "DESTROY"` の構文受理は MVP で行い、意味実行は上記優先順位に従う。

**非対話フラグ（CI 両立）:** `destroy`（および将来の `deploy`）は破壊的操作のため既定で確認プロンプトを出す（§7 の「ジョブ投入確認」演出を兼ねる）。一方 CI の nightly は非対話で DESTROY する必要がある（§9.6）ため、確認を省略する `--yes`（別名 `--force`）フラグを用意する。CLI 仕様（上表）に以下を追加:

```
cobf destroy <file.cbl> [--yes | --force]  # --yes 指定時は確認プロンプトを省略（CI 用）
cobf deploy  <file.cbl> [--yes | --force]  # 同上。対話環境では既定で最終確認を出す
```

対話プロンプト（§4.6 既定）と CI 非対話 DESTROY（§9.6）は、この 1 フラグで両立する。環境変数 `CI=true` 検出時に `--yes` を既定にするかは実装時に判断（明示フラグを基本とする）。

**デプロイ側エラー処理（UI 層とロジック層を分離）:** CFN API 呼び出し（§6[6]: `CreateChangeSet` → `ExecuteChangeSet` → `DescribeStackEvents`）の各段の失敗を、**失敗ハンドリングのロジック層**で正規化してから、**UI 層（§7 の `ABEND S0C7` 風ダンプ・132 桁帳票）でレンダリング**する。演出（ABEND ダンプ）は分岐判断を持たず、ロジック層が決めた「エラー種別・終了コード・対象リソース」を受け取って印字するだけにする。

| 失敗事象 | ロジック層の扱い | 終了コード / UI |
|---|---|---|
| ChangeSet 作成失敗（テンプレート不正・権限不足） | `CreateChangeSet` 例外を捕捉。`FAILED` 理由（`NO_CHANGES` は正常終了扱い）を分類 | 非 0 / 帳票に `CHANGESET REJECTED` と理由行 |
| ChangeSet 実行失敗（途中でリソース作成エラー） | `ExecuteChangeSet` 後に `DescribeStackEvents` を走査し失敗イベントを抽出 | 非 0 / `ABEND S0C7` 風ダンプ＋失敗リソースの論理 ID |
| 自動ロールバック発生 | `ROLLBACK_COMPLETE`/`UPDATE_ROLLBACK_COMPLETE` を検知し、巻き戻し済みを明示 | 非 0 / 帳票に `ROLLBACK — PRIOR STATE RESTORED` |
| スタック既存（同名スタックがある） | 新規作成ではなく**更新 ChangeSet**（`ChangeSetType=UPDATE`）に切替。`REVIEW_IN_PROGRESS` 等の未完スタックは一旦削除を促す | 既存なら更新、未完なら非 0 ＋案内 |
| 認証失敗（資格情報無効・期限切れ） | SDK の資格情報解決エラーを捕捉。鍵はログに出さない（§8 のセキュリティ方針） | 非 0 / `SECURITY VIOLATION — NO VALID CREDENTIALS`（鍵値は印字しない） |

これにより「演出（ホラー UI）」と「正しい失敗検知・終了コード（CI 判定に必要）」が混ざらない。`deploy` は上記いずれの非 0 終了でも CI を赤にする。

### 4.7 COBOL → CFN 写像表（MVP 4 リソースの意味論）

[3]Semantic / [5]Emitter の実装前提となる中核仕様。各リソースについて「どの COBOL 項目（名前・レベル・`VALUE`）がどの CFN プロパティになるか」と、「CFN 必須だがサンプルに無いプロパティをどう補完/表現するか」を定義する。MVP は**手書きの写像表**を正とする（自動生成はストレッチ＝§5/§6、§11 非ゴール）。

共通規約:
- `01` グループ名 → 論理 ID（PascalCase 化。`LOGS-BUCKET` → `LogsBucket`）
- `05 RESOURCE-TYPE VALUE "<型>"` → CFN リソースの `Type`
- 値参照の規約文字列: `"REF:<01名>"` → `{ "Ref": "<論理ID>" }`、`"GETATT:<01名>.<属性>"` → `{ "Fn::GetAtt": ["<論理ID>", "<属性>"] }`。**解決スコープは同一 `.cbl` ファイル内の `01` 名のみ**（クロスファイル参照は MVP 非対象＝§11 非ゴール。未定義参照は §7/§9.1 の明示エラー）。したがって §5.3 の `53-policy.cbl` は `REF:LOGS-BUCKET` の参照先（§5.1）が別ファイルのため単体では `UNDEFINED-REFERENCE` になる。デプロイ用は同一ファイルに束ねる（`tests/golden/policy-ref/`）。
- **ポリシーの `Resource` 項目（`STMT-RES`）では `REF:` を ARN として解決する**（2026-11-11 実装で確定）。`Ref` はバケットでは名前を返し ARN にならないため。`"REF:LOGS-BUCKET"` → `{ "Fn::GetAtt": ["LogsBucket", "Arn"] }`、`"REF:LOGS-BUCKET/*"` → `{ "Fn::Sub": "${LogsBucket.Arn}/*" }`。それ以外の項目の `REF:` は従来どおり `Ref`（接尾辞は不可）。
- `GETATT:<名>.ARN` の属性名は CFN の `Arn` に正規化する（COBOL 側は大文字で書くため）。

#### (a) S3 Bucket（`AWS::S3::Bucket`、§5.1）

| COBOL 項目（レベル・VALUE） | CFN プロパティ | 変換ルール |
|---|---|---|
| `05 BUCKET-NAME VALUE "..."` | `BucketName` | 文字列をそのまま。`PIC X(63)` で S3 の 63 文字上限を表現 |
| `05 VERSIONING-FLAG VALUE "Y"` ＋ `88 VERSIONING-ON` | `VersioningConfiguration.Status` | `"Y"`→`Enabled`、`"N"`／省略→`Suspended` |
| `05 BLOCK-PUBLIC VALUE "Y"` | `PublicAccessBlockConfiguration`（4 フラグ） | `"Y"`／省略→ 4 フラグ（`BlockPublicAcls`/`IgnorePublicAcls`/`BlockPublicPolicy`/`RestrictPublicBuckets`）全て `true`（Security by default）。`"N"`→ 全て `false` ＋帳票に赤インク警告（§5 補足） |

補完方針: サンプルに現れない必須プロパティは無い（`AWS::S3::Bucket` は全プロパティ省略可）。省略時は上記 Security by default を Emitter が補う。

#### (b) IAM Role（`AWS::IAM::Role`、§5.2）/ ManagedPolicy（`AWS::IAM::ManagedPolicy`、§5.3）

| COBOL 項目 | CFN プロパティ | 変換ルール |
|---|---|---|
| `05 TRUST-SERVICE VALUE "lambda.amazonaws.com"` | `AssumeRolePolicyDocument` | サービスプリンシパルから `sts:AssumeRole` 許可の信頼ポリシー JSON を Emitter が組み立てる（下記テンプレート） |
| `05 MANAGED-POLICY VALUE "AWS-MANAGED:<path>"` | `ManagedPolicyArns`（配列） | `AWS-MANAGED:` 接頭辞を剥がし `arn:aws:iam::aws:policy/<path>` に補完して 1 要素の配列に |
| `05 STMT OCCURS n`（`STMT-EFFECT`/`STMT-ACTION`/`STMT-RES`） | `PolicyDocument.Statement[]` | 添字 1..n の各要素を 1 Statement に。`STMT-RES` の `"REF:..."` は上記参照規約で解決 |

補完方針（サンプルに無い CFN 必須プロパティ）:
- **IAM Role の `AssumeRolePolicyDocument`**: `TRUST-SERVICE` から Emitter が定型生成。
  `{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"<TRUST-SERVICE>"},"Action":"sts:AssumeRole"}]}`
- **ManagedPolicy の `PolicyDocument`**: `OCCURS` の各 `STMT` 要素から組む。全要素共通に `"Version":"2012-10-17"` を付与。`STMT-ACTION` に `"*"` が入ると「呪われたワイルドカード」警告（§5 補足）。

#### (c) Lambda Function（`AWS::Lambda::Function`、§5.2）

| COBOL 項目 | CFN プロパティ | 変換ルール |
|---|---|---|
| `05 FN-RUNTIME VALUE "nodejs22.x"` | `Runtime` | そのまま |
| `05 FN-HANDLER VALUE "index.handler"` | `Handler` | そのまま |
| `05 FN-MEMORY VALUE 512` | `MemorySize` | `PIC 9` 数値をそのまま |
| `05 FN-TIMEOUT-SEC VALUE 30` | `Timeout` | 秒。そのまま |
| `05 FN-ROLE-ARN VALUE "GETATT:FN-ROLE.ARN"` | `Role` | 参照規約で `Fn::GetAtt` に解決（同一ファイルの `FN-ROLE`→`FnRole`） |

補完方針（サンプルに無い CFN 必須プロパティ）:
- **`Role`**: 上記 `FN-ROLE-ARN`（`GETATT:` 規約）で供給済み。
- **`Code`**: 現サンプルに項目が無い（＝デプロイ不能、§5 H3 注記参照）。MVP では新規項目 `05 FN-CODE-S3 PIC X(..) VALUE "s3://<bucket>/<key>"`（`S3://` 規約）を導入し、`Code.S3Bucket`/`Code.S3Key` に分解する。短いインラインは `05 FN-CODE-INLINE`（`PIC X`）→ `Code.ZipFile` に対応（デモ用の最小ハンドラ）。どちらか一方を必須とし、両方欠落はデプロイ対象では明示エラー、`compile` のみなら警告（§5 H3）。

#### (d) DynamoDB（`AWS::DynamoDB::GlobalTable`、§5.4）

| COBOL 項目 | CFN プロパティ | 変換ルール |
|---|---|---|
| `SELECT ... ASSIGN TO "DYNAMODB"` | `AWS::DynamoDB::Table`（単一リージョン） | レプリカ指定なしの単一テーブル |
| `SELECT ... ASSIGN TO "DYNAMODB-MRSC"` | `AWS::DynamoDB::GlobalTable` ＋ トップレベル `MultiRegionConsistency: STRONG` | MRSC。§4.5/§16.4 の検証どおり（`Replicas` 内ではない） |
| `RECORD KEY IS ORDER-ID` | `KeySchema`（HASH）＋ `AttributeDefinitions` | パーティションキー |
| `ALTERNATE RECORD KEY IS ORDER-STATE WITH DUPLICATES` | `GlobalSecondaryIndexes[]` ＋ 当該属性の `AttributeDefinitions` | GSI |
| `FD` レコード項目 `PIC X`/`PIC 9` | `AttributeDefinitions[].AttributeType` `S`/`N` | **キー属性（RECORD KEY・ALTERNATE KEY）のみ出力**。非キー（`ORDER-AMOUNT`）は DynamoDB の動的スキーマにつき `AttributeDefinitions` に出さない（意図を明示） |
| `01 <ファイル名>-REGIONS` の `REPLICA-1/REPLICA-2` | `Replicas[].Region`（2 レプリカ） | §4.3 の `OBJECT-COMPUTER`（主リージョン）＝ `REPLICA-1` と一致させる（§4.5 の優先順位ルール） |
| 同グループ `WITNESS-REGION` | `GlobalTableWitnesses[0].Region` | 第 3 リージョンの witness（配列・最大 1 件） |

`DYNAMODB`（単一）と `DYNAMODB-MRSC` の分岐は Emitter が `ASSIGN TO` の外部名で判定し、前者は `Replicas`/`Witness` を出さない。`DYNAMODB-MRSC` は `MultiRegionConsistency: STRONG` を固定出力する。

#### (e) 宣言的な対応表（`src/mapping/`）と Network / Compute / Databases / コンテナ / メッセージングの拡張 ✅ 実装済み（2026-11-13）

(a)〜(d) は手書きの変換だが、それ以外の型は**データ駆動の対応表**で持つ。1 行が「COBOL の項目名 → CFN のプロパティのパス → 型・必須・列挙・既定値」で、読み取るエンジンは 1 つ（`engine.ts`）。型を足すときはコードではなく表に行を足す。

- **対応型（表で動くもの 40 型）**: Network＝VPC / Subnet / InternetGateway / VPCGatewayAttachment / RouteTable / Route / SubnetRouteTableAssociation / EIP / NatGateway / SecurityGroup（インラインのルール）/ SecurityGroupIngress・Egress。エッジ＝Route 53 HostedZone・RecordSet / ACM Certificate / CloudFront Distribution。Compute＝EC2 Instance / InstanceProfile / LaunchTemplate / AutoScalingGroup / ELBv2 LoadBalancer（`LB-TYPE` で ALB・NLB を切り替え）・TargetGroup・Listener / Classic LoadBalancer。Databases＝RDS DBInstance・DBSubnetGroup / Aurora DBCluster / ElastiCache SubnetGroup・ReplicationGroup・CacheCluster。コンテナ＝ECS Cluster・TaskDefinition（コンテナ 1 つ＋環境変数の OCCURS 表）・Service / EKS Cluster・Nodegroup / CloudWatch Logs LogGroup。メッセージング＝SQS Queue・QueuePolicy / SNS Topic・Subscription。手書きの 6 型と合わせて 46 型。
- **項目の型（`Kind`）**: `string` / `number` / `numstr`（CFN が文字列で受ける数値）/ `bool`（`"Y"`/`"N"`）/ `ref`（`REF:`・`GETATT:`）/ `strings`（カンマ区切り。要素ごとに参照を解決）/ `ssm`（`SSM:`・`SECRET:` を動的参照に）/ `userdata`（`\n` を改行にして `Fn::Base64`）/ `secret`（動的参照のみ許す）/ `targets`（`[{Id}]`）。パスの数字の区切りは配列の添字（`Origins.0.DomainName`）。
- **リスト**: OCCURS の表 → オブジェクトの配列（SG のルール、CLB のリスナー）。要素の項目名は**接尾辞**で、互いに他の接尾辞にならない（テストで検査）。値は §5.3 と同じく `MOVE` で入れる。
- **綴り間違いは黙って捨てない**: 表に無い項目は `UNKNOWN-PROPERTY`（近い名前を「もしかして」で提示）。安全設定の書き損じを見逃さないため。
- **Security by default**: EC2・起動テンプレートは IMDSv2 必須、EBS は暗号化、RDS は暗号化あり・非公開、ユーザー名だけでパスワードが無い DB は `ManageMasterUserPassword`。平文パスワードは `PLAIN-PASSWORD` エラー（`SECRET:` / `SSM:` のみ）。SSH・RDP・DB ポートの `0.0.0.0/0` 開放、DB の公開、IMDSv1、Classic LB は警告。
- **スキーマが中身を持たない object**: `RedrivePolicy`・ログの `Options`・`PolicyDocument` のように公式スキーマが `object` としか書かない所は、`Field.schemaPath` で親のパスを指定し、末端の型検査だけを省く（存在検査は親で行う）。
- **IAM ロールの複数ポリシー**: `MANAGED-POLICY` はカンマ区切りで複数の管理ポリシーを付けられる（EKS のノードロールは 3 つ要る）。
- **リソース属性**: `DEPENDS-ON`（論理 ID の `DependsOn`。IGW への Route には必須）、`DELETION-POLICY`（`Delete`/`Retain`/`Snapshot`）、`NAME-TAG`（`Tags`）は全リソース共通。
- **リージョンの制約**: 証明書つきの CloudFront は `AWS-US-EAST-1` 必須（`CLOUDFRONT-CERT-REGION`）。
- **公式スキーマとの突き合わせ**: `scripts/extract-schemas.py` が cfn-lint 同梱の公式スキーマから `tests/schemas/` に地図を作り、テストが「表のプロパティが実在する」「列挙値・既定値が許す範囲」「`numstr` は文字列・`number` は数値・`bool` は真偽値」「COBOL 名が予約語・既存名と衝突しない」を検査する。表の誤りはデプロイ前にテストで落ちる（実際に Egress の `SourceSecurityGroupId` の誤りをこれで検出した）。必須項目の過不足は、ゴールデン出力を `cfn-lint` にかけて確かめる。
- **落ち**: ロードバランサー・EC2/ASG・RDS が 1 プログラムにそろうと、警告 `CLASSIC-THREE-TIER`（「1998 年が構成を返してほしがっています」）を出す。ブラウザデモでは帳票の末尾に図つきで印字する。
- **検証状況**: ゴールデン（3 層構成・エッジ・いにしえ）が `cfn-lint` を通り、`cobf diff` で CloudFormation が ChangeSet として受け付けることを確認。**実デプロイは未実施**（費用と時間のため）。

### 4.8 パーサ MVP 受理サブセット（受理／明示エラーの線引き）

「パーサが沼る」リスク（§13）への具体的な防波堤として、MVP で**受理する構文**と**明示エラーにする構文**の境界を固定する。GnuCOBOL を「正」としつつ、トランスパイラの意味解釈は下表のサブセットに限定する。

| 構文要素 | MVP の扱い | 備考 |
|---|---|---|
| 継続行（7 桁目 `-`、文字列リテラルの分割） | **受理**。前行への連結として処理 | §5 補足の長い ARN 継続デモが成立する最小対応。数値・非リテラルの継続は MVP 非対象＝明示エラー |
| ピリオド | 文・段落・段落終端のピリオドを**受理**。段落内の宣言は 1 文 1 ピリオドを基本とする | 冗長／欠落ピリオドは警告（GnuCOBOL が通す範囲は受理し、意味解釈上あいまいなら明示エラー） |
| 複数 `MOVE`（同一項目に複数回） | **受理。最後の `MOVE` を採用**（静的評価、上書き順＝記述順） | §5.3 は添字ごとに 1 回なので該当せず。条件分岐下の `MOVE` は MVP 非対象＝明示エラー |
| `OCCURS` 添字範囲 | 定数添字 `1..n` を**受理**。範囲外は**明示エラー**（`SUBSCRIPT OUT OF RANGE`、行・桁つき） | 変数添字は MVP 非対象＝明示エラー |
| `REF:`/`GETATT:` の循環参照 | **明示エラー**（`CIRCULAR REFERENCE`）。検出は Semantic 段で依存グラフを走査 | 自己参照・相互参照とも検出対象 |
| 未定義参照（`REF:` 先の `01` が無い） | **明示エラー**（§7/§9.1 と一致、行・桁つき） | 解決スコープは同一ファイル（§4.7 共通規約） |

上記以外の未対応文法（`PERFORM` ループ、算術文、`IF`/`EVALUATE` による動的プロパティ等）は、構文としては GnuCOBOL を通っても**トランスパイルでは明示エラー**（`UNSUPPORTED IN MVP`）とし、黙って無視しない。線引きは Spec①/②（§10）で EARS として明文化する。

---

## 5. サンプルプログラム（構文例のみ）

> 1〜6桁目に連番、7桁目は空白、8桁目から A 領域、12桁目から B 領域。全行 72 桁以内。
> ✅ 2026-10-30 検証済み: GnuCOBOL 3.2.0 の `cobc -fsyntax-only --fixed` で **4サンプル全て exit 0・エラーなし**で通過。
>   `-std=cobol85`（時代考証モード）でも全通過。`-Wall` での指摘は 5.1 の `AUTHOR is obsolete`（[-Wobsolete]）のみ＝作品テーマ上はむしろ好都合。
>   さらに §5.4 の索引ファイル（`ORGANIZATION IS INDEXED` + `ALTERNATE RECORD KEY` + `FILE STATUS`）も構文チェック通過。
>   `DEPLOY` ダミーサブプログラムとリンクして `cobc -x` でコンパイル→実行まで成功（`CALL "DEPLOY"` が実行時解決される＝「本物の COBOL」が実証可能）。
>   検証ファイル: `verify/samples/*.cbl`。

> **⚠️ 重要な注記（サンプルの位置づけ）: 現サンプルは「有効な COBOL」の実証であって「そのままデプロイ可能な CFN」の実証ではない。**
> §16 で確認済みなのは「GnuCOBOL の固定形式構文を通る／本物の COBOL ランタイムで実行できる」こと（＝§4.1 の弱点対策）までで、`compile` 出力がそのまま `aws cloudformation deploy` で通る保証ではない。CFN 必須だがサンプルに欠けるプロパティがあるため、MVP でデプロイ可能（§12 W2 の実デプロイ目標）にするには各サンプルを最小限拡張する:
> - **`52-lambda.cbl` の Lambda（最重要）**: `AWS::Lambda::Function` は `Code` と `Role` が必須。`Role` は `FN-ROLE-ARN`（`GETATT:` 規約）で供給済みだが、**`Code` に相当する項目が無い**。W2 のデプロイ用に `05 FN-CODE-S3 VALUE "s3://.../fn.zip"`（または最小インライン `05 FN-CODE-INLINE`）を追加する（§4.7(c) の補完方針）。デモ用には S3 に置いた最小 ZIP／数行のインラインハンドラで足りる。
> - **IAM（`AWS::IAM::ManagedPolicy`/`Role`）**: `PolicyDocument`・`AssumeRolePolicyDocument` はサンプルに JSON として書かれていないが、§4.7(b) のとおり `STMT OCCURS`／`TRUST-SERVICE` から Emitter が組み立てるため、**サンプル拡張は不要**。
> - **S3（`AWS::S3::Bucket`）**: 必須プロパティは無く、省略分は Security by default で補完（§4.7(a)）。**拡張不要**。
> - **DynamoDB（`AWS::DynamoDB::GlobalTable`）**: キー・レプリカ・witness・主リージョンが揃っており（§5.4＋`OBJECT-COMPUTER` 追記）、**拡張不要**。
> したがって W2 の「実デプロイ」は、Lambda の `Code` 表現（§4.7(c)）を入れたデプロイ用サンプルで行う。構文実証サンプル（§5 のコードブロック＝`verify/samples/`）とデプロイ用サンプルは目的が異なり、矛盾しない。

### 5.1 S3 バケット
```cobol
000100 IDENTIFICATION DIVISION.
000200 PROGRAM-ID. HAUNTED-LOGS.
000300 AUTHOR. TETSUYA-SHIBAO.
000400 ENVIRONMENT DIVISION.
000500 CONFIGURATION SECTION.
000600 SOURCE-COMPUTER. AWS-ACCOUNT.
000700 OBJECT-COMPUTER. AWS-AP-NORTHEAST-1.
000800 DATA DIVISION.
000900 WORKING-STORAGE SECTION.
001000 01  LOGS-BUCKET.
001100     05  RESOURCE-TYPE    PIC X(20) VALUE "AWS::S3::Bucket".
001200     05  BUCKET-NAME      PIC X(63) VALUE "kiroween-crypt-logs".
001300     05  VERSIONING-FLAG  PIC X     VALUE "Y".
001400         88  VERSIONING-ON          VALUE "Y".
001500     05  BLOCK-PUBLIC     PIC X     VALUE "Y".
001600 PROCEDURE DIVISION.
001700 MAIN-PARA.
001800     CALL "DEPLOY".
001900     STOP RUN.
```

### 5.2 Lambda ＋ IAM ロール
```cobol
000100 IDENTIFICATION DIVISION.
000200 PROGRAM-ID. ZOMBIE-API.
000300 DATA DIVISION.
000400 WORKING-STORAGE SECTION.
000500 01  FN-ROLE.
000600     05  RESOURCE-TYPE    PIC X(20) VALUE "AWS::IAM::Role".
000700     05  TRUST-SERVICE    PIC X(30) VALUE "lambda.amazonaws.com".
000800     05  MANAGED-POLICY   PIC X(60) VALUE
000900         "AWS-MANAGED:service-role/AWSLambdaBasicExecutionRole".
001000 01  FN-ORDERS.
001100     05  RESOURCE-TYPE PIC X(25) VALUE "AWS::Lambda::Function".
001200     05  FN-RUNTIME       PIC X(12) VALUE "nodejs22.x".
001300     05  FN-HANDLER       PIC X(20) VALUE "index.handler".
001400     05  FN-MEMORY        PIC 9(5)  VALUE 512.
001500     05  FN-TIMEOUT-SEC   PIC 9(3)  VALUE 30.
001600     05  FN-ROLE-ARN      PIC X(30) VALUE "GETATT:FN-ROLE.ARN".
001700 PROCEDURE DIVISION.
001800 MAIN-PARA.
001900     CALL "DEPLOY".
002000     STOP RUN.
```

### 5.3 IAM ポリシー（OCCURS ＋ MOVE）
```cobol
000100 IDENTIFICATION DIVISION.
000200 PROGRAM-ID. CURSED-POLICY.
000300 DATA DIVISION.
000400 WORKING-STORAGE SECTION.
000500 01  READ-ONLY-POLICY.
000600     05  RESOURCE-TYPE PIC X(25) VALUE "AWS::IAM::ManagedPolicy".
000700     05  STMT OCCURS 2 TIMES.
000800         10  STMT-EFFECT  PIC X(5).
000900         10  STMT-ACTION  PIC X(30).
001000         10  STMT-RES     PIC X(60).
001100 PROCEDURE DIVISION.
001200 MAIN-PARA.
001300     MOVE "Allow"             TO STMT-EFFECT (1).
001400     MOVE "s3:GetObject"      TO STMT-ACTION (1).
001500     MOVE "REF:LOGS-BUCKET/*" TO STMT-RES (1).
001600     MOVE "Allow"             TO STMT-EFFECT (2).
001700     MOVE "s3:ListBucket"     TO STMT-ACTION (2).
001800     MOVE "REF:LOGS-BUCKET"   TO STMT-RES (2).
001900     CALL "DEPLOY".
002000     STOP RUN.
```

### 5.4 DB（SELECT/FD → DynamoDB MRSC）
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

補足:
- 5.1: `BLOCK-PUBLIC` 省略時も既定で全ブロック（Security by default）。`"N"` にすると帳票に赤インクで警告。
- 5.2: 長い ARN は規約 `AWS-MANAGED:` 接頭辞で短縮。72 桁を超える場合は 7 桁目 `-` の継続行（それ自体が癖デモ）。ランタイム名は実装時に最新一覧を確認 ⚠️
- 5.3: `STMT-ACTION` に `"*"` を入れると「呪われたワイルドカード」警告（Security CB ネタ）。MVP は `MOVE リテラル TO 項目(添字)` のみ静的評価。
- 5.4: `OBJECT-COMPUTER. AWS-AP-NORTHEAST-1.`（＝主リージョン＝`REPLICA-1` の東京）を追加済み（§4.5 リージョン決定ルールに沿い、`51-s3.cbl` と対称化）。`REPLICA-1/2` がレプリカ（東京・大阪）、`WITNESS-REGION` が第 3 リージョンのソウル（witness）。`ORDER-STATE` が GSI になる。

---

## 6. コンパイラ（トランスパイラ）アーキテクチャ

```
 .cbl ─▶ [1] Card Reader ─▶ [2] Lexer/Parser ─▶ AST ─▶ [3] Semantic
         (桁・標識・連番)    (DIVISION 文法)          (PIC/参照/MOVE評価/Lint)
     ─▶ [4] IR（中立リソースモデル）
     ─▶ [5] Emitter: CFN JSON/YAML | (opt) CDK L1 コード
     ─▶ [6] Line Printer Reporter（132桁帳票） / Deployer（CFN API）
```

> **設計方式 ＝ 静的トランスパイル（CDK の jsii とは別系統）**
> 本作は `.cbl` を**実行せず、テキストとして解析**して CloudFormation を emit する。CDK が「ソースを**実行**してコンストラクトツリーを組み、`cdk synth` で CFN を出力する」のとは根本的に異なる。
> - CDK の多言語対応は jsii（TypeScript 本体を各言語バインディング経由で呼ぶ）＝「1 実装を多言語から**実行**」。CloudFormation を生成するのは常に TS 本体。
> - 本作は「COBOL ソース → 独自パーサ → IR → CFN」の**変換器**。COBOL という題材は `01` 項目＝リソース、`VALUE`＝プロパティが静的に読み取れるため、実行モデルより静的トランスパイルが素直で適切。
> - したがって「CDK の新言語」は**比喩**であり、jsii に COBOL を足すものではない（§1 の注記と一致）。

| 段 | 内容 |
|---|---|
| [1] Card Reader | 1行=1カード。1–6/7/8–11/12–72/73–80 に分解。タブ・小文字・80桁超・継続行を処理。エラーは行・桁つき |
| [2] Parser | DIVISION/SECTION/段落、レベル番号の階層化、PIC/VALUE/OCCURS/88、SELECT/FD。候補: **Chevrotain**（TS 製）または手書き再帰下降 |
| [3] Semantic | PIC 長 vs VALUE 長、`REF:`/`GETATT:` 解決、`MOVE` 静的評価、IAM ワイルドカード等のセキュリティ Lint |
| [4] IR | `{logicalId, type, properties}`。Terraform 出力など拡張の足場 |
| [5] Emitter | COBOL 名→PascalCase＋型別マッピング表。**MVP は §4.7 の手書き写像表を正とする**。CFN リソーススキーマから表を自動生成する案 ⚠️ は**MVP 外（ストレッチ、§11 非ゴール）**で、新 CFN リソース型の追加コスト削減が目的 |
| [6] Reporter/Deployer | `CALL "DEPLOY"` で **AWS SDK for JavaScript v3**（`@aws-sdk/client-cloudformation`）の CloudFormation API（ChangeSet: `CreateChangeSet` → `ExecuteChangeSet` → `DescribeStackEvents`）を呼び、スタックイベントを 132 桁帳票に流す。※ SDK は**トランスパイラ内部のデプロイ実装**に使う部品であり、利用者の `.cbl` からは見えない（「SDK for COBOL」ではない） |

### 実装言語：**TypeScript（Node.js）**
- **プロダクト名: `cobolform`（✅ 確定）。短縮別名コマンド `cobf`**。npm は 1 パッケージに複数 bin を登録できるため、`cobolform` と `cobf` の両コマンドを同梱し、どちらでも同じ CLI が動く。`cobolform` は説明的で検索しやすい正式名、`cobf` はタイポしにくい日常使いの短縮形、という役割分担。
- **`cdk` を含む名前は意図的に避けた**。本作は CDK の言語バインディングではなく CloudFormation 直結の独自トランスパイラ（§1/§6 の CDK/jsii 区別）であり、名前に `cdk` が入ると「これは CDK の対応言語か？」という、本メモが否定している誤解を再び招くため。CloudFormation（`...form`）に直結することが伝わる `cobolform` を正式名に採用した。
- 選定理由: TS の型安全なパーサ実装（Chevrotain 等）、`npx` 配布、ブラウザ内コンパイル（Web 緑画面デモ §8）にそのまま流用可、CFN/AWS SDK v3 との親和性
- 別名案だった `cobc-aws` / `jcl` / `cdk-cobol` は不採用（`cobc-aws` は本家 `cobc`（GnuCOBOL）と紛らわしく、`cdk-cobol` は上記のとおり CDK との混同を招く）。`cobolform`（＋別名 `cobf`）に一本化

### CDK L1 との相互運用（ストレッチ・任意）
- **本線は独自トランスパイラ（案B: CFN 直接出力）**。CDK には依存しない。以下はあくまで「CDK と並べて見せる」ための任意オプション。
- 案A: `CfnBucket` 等 L1 を生成する TS コードを出力 → `cdk synth`
- 案B': CDK アプリから `.cbl` 由来の CFN テンプレートを取り込む（`cloudformation-include` の `CfnInclude` ⚠️ 要確認）。「CDK から COBOL を読む」見せ方
- jsii で COBOL をターゲット言語にするのは非現実的（§1/§6 冒頭ノート参照）。上記は「CDK 的な世界観」を補強する演出に留め、プロダクトのコア（独自トランスパイラ）とは切り離す

---

## 7. 「癖」機能（Quirk Features）

| 機能 | 内容 |
|---|---|
| 桁ずれエラー | `01` が B 領域、7桁目に不正文字など。IBM 風パロディコード（実在コードは流用しない）。✅ 実装済み: 接頭辞は独自の `CBF`（例 `CBF-0003-S`、エラーは `SEVERITY 12`、警告は `CBF-…-W`・`SEVERITY 4`）。番号表は `src/errors.ts`、追加は末尾に足す（順序を変えると番号が変わる）。表の網羅はテストで検査 |
| 大文字強制 | 小文字 1 文字で `SEVERITY 12: LOWERCASE IS HERESY`。✅ 実装済み |
| 132桁ラインプリンター帳票 | デプロイ結果をページヘッダ・頁番号・`TOTAL RESOURCES CREATED` つきの連続帳票で出力（ターミナル＋HTML）。✅ ターミナル版は実装済み（50 行ごとに改頁、合計は作成／更新／削除を論理 ID で数える）。HTML 版は未着手 |
| 連番チェック | `--strict-sequence`: 「カードデッキが乱れています。ソーターにかけてください」。✅ 実装済み（1〜6 桁目が数字の行で、直前以下ならエラー。連番が空の行は無視） |
| 73–80 桁の罠 | 書いた値は無視＋警告 |
| DB LINK 禁止令 | `ASSIGN TO "DBLINK"` でエラー（§4.5） |
| `STOP RUN` 忘れ | 「ジョブが終わらない」演出。✅ 警告（`MISSING-STOP-RUN`）として実装済み。`PROCEDURE DIVISION` があり `STOP RUN`/`GOBACK` が無いときだけ |
| ABEND 演出 | CFN ロールバック時に `ABEND S0C7` 風ダンプ |

---

## 8. デモ UI（Costume Contest 兼用）
- **緑画面 CRT エディタ**（Web、Monaco＋CRT シェーダ：走査線・にじみ・焼き付き）。80桁ルーラ、7桁目・12桁目・72桁目に縦線
- **ラインプリンター**: 右ペインで連続帳票が印字。ミシン目、ピンフィード穴、グリーンバー用紙、ドットインパクト音（ミュート可）
- ハロウィン要素: エラーで帳票が血のインクに／桁ずれ行の数字が這い出る／`DBLINK` で 8i の亡霊（3+1 台のサーバー）が出現
- 小ネタ（ストレッチ）: COBOL で定義した Lambda が Struts 1 時代風の `.do` 画面を返す（§2）
- 構成: コンパイルはブラウザ内、デプロイは CLI か認証付きバックエンド（デモ専用アカウント＋Budgets）

**認証経路（ブラウザ内コンパイル → 実デプロイ）✅ 方針決定:** **AWS の鍵（アクセスキー／シークレット）をブラウザに一切渡さない**。コンパイル（`compile`、副作用なし）はブラウザ内で完結させ、実デプロイのみ認証付きバックエンドに委譲する。
- ブラウザ → バックエンドは認証付き（デモ専用のセッション／OIDC ログイン）。ブラウザが送るのは生成済み CFN テンプレート（またはソース `.cbl`）のみで、AWS 資格情報は送らせない。
- CFN API（`CreateChangeSet`/`ExecuteChangeSet`）はバックエンドが実行し、**AWS 資格情報はサーバー側だけに保持**（デモ専用 IAM ロールへの `AssumeRole` による短期クレデンシャル、または環境のインスタンスロール）。長期キーは埋め込まない。
- バックエンドはデモ専用アカウントに限定し、権限は MVP リソース（S3/IAM/Lambda/DynamoDB）＋ Budgets の範囲に絞る。エラー時も鍵値は帳票・ログに出さない（§4.6 デプロイ側エラー処理の認証失敗ハンドリングと一致）。
- これにより「ブラウザから実デプロイ」を、鍵漏洩リスクなしに成立させる（Security CB の作風とも一致）。

### 配布方式（MVP）✅ 方針決定
トランスパイラ本体は TypeScript/Node 実装（§6）なので、**COBOL ランタイムを同梱せずに macOS / Windows / Linux で動く**。この利点をそのまま配布に活かす。
- **MVP の配布は npm / npx**。利用者は `npx cobf compile 51-s3.cbl`（短縮別名。正式名なら `npx cobolform compile 51-s3.cbl`。CLI は §4.6 の `cobf compile <file.cbl>` と同じ）のように、インストールなしで呼び出せる。Node が動く環境ならプラットフォームを問わない。
- **GnuCOBOL は任意（オプション）依存**。任意の構文チェック段（「本物の COBOL か」の検証。CI での位置づけは §9.3、実機検証は §16）でのみ使い、**あれば使う／無ければスキップ**する。Windows では GnuCOBOL の導入に手間がかかるため、トランスパイラ本体の必須依存にはせず任意のままにする。構文チェックを飛ばしても `compile`（CFN 出力）は成立する。

---

## 9. テスト戦略

### 9.1 方針：トランスパイラ中心の TDD
- ランナー: **Vitest**（TS ネイティブ、高速）
- Card Reader / Parser / Semantic / Emitter を単体テスト。失敗するテストを先に書く（Kiro Spec の tasks とテストを対応付け）
- エラー系を厚く：桁ずれ・小文字・PIC 長超過・未定義参照・`DBLINK` 等を「入力 .cbl → 期待エラー（コード・行・桁）」で固定

### 9.2 ゴールデンテスト（.cbl → 期待 CFN）
```
tests/golden/<case>/input.cbl
tests/golden/<case>/expected.template.json
tests/golden/<case>/expected.report.txt   # 132桁帳票（任意）
```
- 全ケースを走査し、`compile(input.cbl)` を正規化（キー順ソート）して deep equal
- 期待値の更新は `UPDATE_GOLDEN=1` 指定時のみ（安易な上書き防止）
- §5 のサンプルは全てゴールデンケースに登録＝ドキュメントとテストを常に一致させる

**期待 CFN の初期作成フロー（誰がどう最初の `expected.template.json` を確定するか）✅ 方針決定:**
1. **初回は人手レビューで確定する（手書きゼロからではなく、生成→レビュー）**。新規ケースはまず `compile(input.cbl)` の出力を `UPDATE_GOLDEN=1` で生成し、その生成物を**人間が §4.7 の写像表と cfn-lint 結果に照らしてレビュー**してから初回コミットする。レビュー通過が「ゴールデン確定」の条件。
2. **小さな決定的ケースは手書き併用**：最小 S3 など写像が自明なものは期待 JSON を手書きし、生成出力との一致で写像表の正しさを二重確認する（W1 の S3 ゴールデン 1 本＝§12 はこの手書きで作る）。
3. 以後の正当な変更のみ `UPDATE_GOLDEN=1` で差分更新し、**差分は必ずレビュー**（無条件の上書きは禁止）。CI では `UPDATE_GOLDEN` を無効化し、ゴールデン不一致を失敗とする。

### 9.3 「本物の COBOL か」検証：GnuCOBOL in CI
- 導入: macOS `brew install gnucobol`、CI（Ubuntu）は `apt-get install gnucobol` ⚠️ パッケージ名・版は CI 構築時に確認
- 構文チェック: `cobc -fsyntax-only --fixed samples/*.cbl`（✅ 2026-10-30 検証: GnuCOBOL 3.2.0 では `--fixed` が固定形式の既定。`-std=cobol85` は A 領域配置まで強制 → 「時代考証モード」として CI 併用。両モードで §5 の 4 本が通過済み）
- ✅ `-fsyntax-only` の挙動確認済み（`cobc --help`）: 「syntax error checking only; don't emit any output」。FIXED/COBOL85/VARIABLE 形式のみ対応（free 形式では不可）
- ✅ `CALL "DEPLOY"` は標準の CALL 文（実行時解決の外部サブプログラム）なので構文チェックを通る。`ASSIGN TO "DYNAMODB-MRSC"` も単なる外部名リテラルとして通過（検証済み）
- ✅ `DEPLOY` という名前のダミーサブプログラム（`verify/samples/deploy.cbl`）を用意し、`cobc -x -o run 51-s3.cbl deploy.cbl` でコンパイル→実行し `DISPLAY` が出力されることを確認済み。**MVP 格上げ推奨**（§11）: この「本物の COBOL ランタイムで動く」実証がフレーミングの弱点（§4.1 の規約依存）を潰す決め手

### 9.4 オプション：cobol-check
- ✅ Open Mainframe Project の COBOL 単体テストフレームワーク。テストスイートを埋め込むプリコンパイラ方式で段落単位にテスト。GnuCOBOL 前提、Java 8+、JUnit/HTML レポート
- ⚠️ 現在 OMP で **Emeritus（休眠）状態** → 必須にせず、`MOVE` 評価結果を本物の COBOL ランタイムでも確かめるデモ的オプション

### 9.5 出力 CFN の検証
- **cfn-lint** を全ゴールデン出力に実行（スキーマ違反・不正プロパティ）
- `aws cloudformation validate-template`（要認証、nightly のみ）
- L1 出力モードでは生成 TS を `cdk synth` し、直接出力との差分ゼロを確認（ストレッチ）
- cfn-guard / checkov でセキュリティポリシーチェック（ストレッチ、Security CB らしさ）

### 9.6 CI パイプライン（GitHub Actions 想定）
```
tsc/eslint → vitest(unit+golden) → cobc -fsyntax-only -fixed
  → compile samples → cfn-lint → (nightly) validate-template / 実デプロイ→DESTROY
```
- nightly の実デプロイ後 DESTROY は**非対話**で回す必要があるため、`cobf destroy <file.cbl> --yes`（§4.6）を使う。対話環境の確認プロンプトと CI の非対話 DESTROY はこの `--yes`/`--force` フラグで両立する。

---

## 10. Kiro 機能の見せ方 ✅（kiro.dev docs, 2026-10 時点）

| 機能 | 使い方 |
|---|---|
| **Specs**（requirements → design → tasks、EARS 記法） | ①固定形式カードリーダ ②DATA DIVISION→CFN ③SELECT/FD→DB を Feature Spec に。桁ルールは EARS で「WHEN 7桁目が `*` THE SYSTEM SHALL 行をコメントとして扱う」。Bugfix Spec で桁ずれバグ修正も記録。Correctness（プロパティベーステスト）も試す |
| **Hooks**（`.kiro/hooks/*.json`、ファイル保存等で shell / agent アクション） | `.cbl` 保存時（matcher `\.cbl$`）: ①桁チェック ②`cobc -fsyntax-only` ③CFN 生成＋cfn-lint ④帳票プレビュー更新。agent アクションで「エラーを COBOL 老技術者口調で解説」 |
| **Steering**（`.kiro/steering/`） | `cobol-conventions.md`（固定形式、大文字、A/B 領域、予約語回避）、`aws-security.md`（最小権限、暗号化既定）、`product.md`（ストーリー・トーン） |
| **MCP**（`.kiro/settings/mcp.json`） | AWS Documentation 系 MCP で CFN プロパティ確認 ⚠️ サーバー名要確認。GnuCOBOL マニュアルは fetch MCP |
| その他 | Custom agents / Agent Skills / Powers で「COBOL 長老エージェント」⚠️ 規約次第 |

README・動画で「Kiro のどの機能で何を作ったか」を明示（審査で問われる可能性大 ⚠️）。

---

## 11. スコープ

### MVP（必達）
- 固定形式カードリーダ＋桁/大文字/タブエラー
- 4 DIVISION の最小文法、SELECT/FD
- リソース: **S3 Bucket、IAM Role/ManagedPolicy、Lambda Function、DynamoDB（単一＋MRSC Global Table）**
- `REF:`/`GETATT:`、`OCCURS`、`MOVE リテラル`
- CLI `compile`（副作用なし CFN JSON/YAML 出力）＝**必達の基盤コマンド**（ゴールデンテスト・CI が依存。§4.6）。あわせて `deploy`/`destroy`、`CALL "DEPLOY"`/`"DESTROY"`
- 132桁帳票（ターミナル＋HTML）
- ゴールデンテスト、GnuCOBOL 構文 CI、cfn-lint
- Kiro Specs/Hooks/Steering の実運用、3分デモ動画

### 非ゴール（散在していた非ゴールの集約）
本作が**やらないこと**を 1 箇所にまとめる（読者・審査員が範囲を一読できるように。各項の詳細は参照先）:
- **jsii に COBOL を足すものではない**（§1/§6）。CDK の多言語対応（jsii バインディング）とは別系統の独自トランスパイラ。「CDK の新言語」は比喩。
- **`Pro*COBOL` / `EXEC SQL` は使わない**（§4.1）。純粋な標準固定形式 COBOL のみ。8i の DB リンクは語りのみでコードは標準ファイル定義（§1）。
- **Skeleton Crew 部門は対象外**（§3）。余力があれば IR から Terraform 版を派生する程度。
- **Emitter 写像表の自動生成は MVP 外**（§5/§6 ⚠️）。MVP は §4.7 の手書き写像表を正とする。
- **Aurora DSQL マルチリージョンはストレッチ**（§4.5/§11）。MVP の DB は DynamoDB（単一＋MRSC）。
- **クロスファイル参照は非対象**（§4.7）。`REF:`/`GETATT:` の解決スコープは同一 `.cbl` 内の `01` 名のみ。
- **MVP サブセット外の文法**（`PERFORM` ループ・算術文・`IF`/`EVALUATE` による動的プロパティ等）は明示エラー（§4.8）。黙って無視しない。
- **CDK L1 / `CfnInclude` 相互運用はストレッチ**（§6/§11）。本線は CFN 直接出力。
- **第2言語パッケージ（pip / uv）は MVP では出さない**。MVP の配布は npm / npx のみ（§8 配布方式）。pip/uv 対応はストレッチ（下記）。

### ストレッチ
- Web 緑画面エディタ＋ラインプリンター UI（Costume 併願なら必須に格上げ）
- Aurora DSQL マルチリージョン
- CDK L1 / CfnInclude 相互運用
- COPY 句（コピーブック＝モジュール）、`REDEFINES` でリージョン別上書き
- Struts 1 風画面を返す Lambda、帳票 PDF、ドットインパクト音
- Terraform Emitter、cobol-check 連携
- **pip / uv 配布**（Python ユーザーにも届ける）。実装方式は高レベルで 2 案: (a) Node CLI を呼び出す薄い Python ラッパー、(b) WASM バンドル。MVP は npm / npx のみで、第2言語パッケージは出さない（§8 配布方式／上記非ゴール）

---

## 12. 5週間スケジュール（JST）

| 週 | 期間 | ゴール |
|---|---|---|
| W0（準備） | 10/16–10/29 | 本メモ、§14 チェックリスト。**コードは書かない** |
| W1 | 10/30(金)–11/5(木) | 規約・審査基準を読んで本メモ改訂。リポジトリ新規作成、Steering/Hooks、Spec①カードリーダ。Vitest＋GnuCOBOL CI。S3 ゴールデン 1 本 green |
| W2 | 11/6–11/12 | Spec② DATA→CFN。S3/IAM/Lambda、参照、OCCURS/MOVE、cfn-lint。実デプロイ |
| W3 | 11/13–11/19 | Spec③ SELECT/FD→DynamoDB（MRSC）。132桁帳票。癖機能。**MVP 完成** |
| W4 | 11/20–11/26 | Web 緑画面 UI＋ラインプリンター。DSQL か CDK 相互運用のどちらか 1 つ |
| W5 | 11/27–12/3 | 12/1 機能凍結。デモ動画、英語 README、Devpost 記入、Kiro 利用説明 |
| 提出 | 12/4(金) | **12/4 23:59 JST までに提出完了**（公式締切 12/5 07:00 JST の約 7 時間前） |

---

## 13. リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| 審査基準・要件が想定と違う | 高 | W1 初日に本メモ改訂 |
| COBOL パーサが沼る（継続行・ピリオド・予約語） | 高 | サブセット文法を Spec で明文化、未対応は明示エラー。GnuCOBOL を「正」とする |
| CFN で MRSC / DSQL マルチリージョンを表現できない | 中→**低（MRSC は解消）** | ✅ MRSC は CFN `AWS::DynamoDB::GlobalTable` の `MultiRegionConsistency: STRONG`（トップレベル）+ `GlobalTableWitnesses` で単一スタック宣言可と確認済み（2026-10-30、§5.4）。残る懸念は DSQL のみ → 不可ならカスタムリソース／SDK 直接、最悪シングルリージョン＋説明 |
| AWS コスト・後片付け漏れ | 中 | デモ専用アカウント、Budgets、CI で必ず DESTROY |
| 海外審査員に COBOL/8i の文脈が伝わらない | 中 | 動画冒頭で DB リンク地獄を図解、英語ピッチを磨く |
| 「新規コードのみ」ルール | 高 | 初コミットは 10/30 以降。本メモは企画書扱い（規約確認） |
| ソロ・本業との並行 | 中 | MVP を W3 で締め、UI はストレッチ |
| ベンダーのエラーコード・商標 | 低 | パロディと明記、実コード流用しない |

---

## 14. 10/30 までの準備チェックリスト
- [ ] Kiro のサインイン（AWS Builder ID 等 ⚠️ 方式確認）と最新版インストール
- [ ] Devpost で Kiroween 2026 に Register
- [ ] **複数部門への同時応募可否を規約で確認**（Resurrection 単独か Costume Contest 併願か＝§3/§15-Q4 の前提）
- [ ] 「新規プロジェクトのみ対象」ルールを再確認（✅ Devpost トップに記載あり: 応募期間中に新規作成したプロジェクトのみ対象。初コミットは 10/30 以降）
- [ ] Kiro Discord 参加、`#kiroween-hackathon` 確認 ⚠️ チャンネル名要確認
- [ ] Kiroween 2025 のギャラリー・受賞作確認（Resurrection の傾向、COBOL ネタ被り）
- [x] ✅ 2026-10-30 完了: `brew install gnucobol` → `cobc 3.2.0` 確認。`cobc --help` で `-fsyntax-only`/`--fixed`/`-std` を確認
- [x] ✅ 2026-10-30 完了: §5 の 4 サンプルを `cobc -fsyntax-only --fixed`（+ `-std=cobol85`）で検証＝全通過。`deploy.cbl` とリンクして `cobc -x` で実行まで確認（`verify/samples/`）
- [x] ✅ 2026-10-30 完了: `cobc --list-reserved`（1006 語）で予約語確認。`STATUS`/`TIMEOUT`/`ACTION`/`AUTHOR` は予約語 → §5 サンプルは接頭辞で全て回避済み（§4.4）
- [x] ✅ 2026-10-30 完了: CFN の `AWS::DynamoDB::GlobalTable` MRSC 指定方法を確認（トップレベル `MultiRegionConsistency: STRONG` + `GlobalTableWitnesses`、AP region set = 東京/ソウル/大阪）。`AWS::DSQL::*` の有無は未確認（DSQL はストレッチ）
- [ ] デモ用 AWS アカウント＋Budgets
- [ ] 8i の DB リンク構成図（3+1 台）を匿名化して描き起こす（動画素材）
- [ ] 英語ピッチ案 3 つ

---

## 15. オープンクエスチョン
1. ✅ **決定: プロダクト名 = `cobolform`、短縮別名コマンド = `cobf`**（CDK には依存しない CloudFormation 直結の独自トランスパイラ。`cdk` を含む名前は CDK/jsii の区別と衝突するため不採用。§6/§8）。サブタイトル／作品名として `COBOL DEPLOY DIVISION` を併用可
2. 既定の DB: DynamoDB MRSC（MVP）か Aurora DSQL（SQL 寄りで COBOL の帳票文化と相性◎）か
3. デモは実デプロイまで見せるか、帳票だけで足りるか（審査員が触れる環境の要否 ⚠️）
4. Resurrection 単独か、Costume Contest 併願か
5. 8i の実話をどこまで具体的に出すか（元職場の情報に触れない範囲）
6. Kiro の新しめの機能（Powers / Agent Skills / Cloud sessions）をどこまで盛り込むか
7. ✅ **決定: `CALL` 文（意図の宣言）＋ CLI サブコマンド（実行制御）の二層**（§4.6）。CLI 優先、省略時は `CALL` を既定アクションに。`compile`/`deploy`/`destroy` が MVP、`diff` はストレッチ
8. ✅ **解決済み（Q1 に統合）: 配布時のプロダクト名の再検討**: `cdk` を含む名前は「CDK の言語バインディングか？」という、本メモが否定している誤解（CDK/jsii の区別＝§1/§6/§11）を招くため、`cobolform`（別名 `cobf`）に確定した。詳細は Q1 と §6 を参照。

## デモ動画の作り方（提出準備）

柴尾さんが過去のAWS系ハッカソン（H0など）で実際に使った手順をそのまま使う。

1. COBOLの`.cbl`を書いてから、変換、デプロイ、ラインプリンター風の出力が出るまでを、画面のスクリーンレコーダーで録画する。
2. 録画した動画をClaude Codeに読み込ませ、何をしているかを解説させて、その説明文を書き起こしてもらう。読み上げる前に、人の目で文章を見直す。
3. 書き起こした文章を、CapCutの読み上げ機能で音声にする（機能の正式名と操作は要確認）。
4. 元の動画と音声を、CapCutで1本の動画に合わせる。
5. YouTubeにアップロードして、Devpostに提出する。YouTubeの公開設定が提出要件を満たすかは、10/30以降に確認する。

スケジュール上は、もくもく会の最終回（11/20）までに録画素材をそろえておく。

---

## 16. 検証ログ（2026-10-30 実機）

レビュー指摘の「10/30 当日に即検証すべき3点」を実機で確認した記録。検証ファイルは `verify/samples/`。

### 16.1 環境
- GnuCOBOL **3.2.0**（`brew install gnucobol` で導入、macOS arm64）
- AWS CLI 2.38.3（CFN 仕様は AWS 公式ドキュメントで確認）

### 16.2 検証1: §5 サンプルの固定形式構文チェック → ✅ 全通過
- `cobc -fsyntax-only --fixed verify/samples/{51-s3,52-lambda,53-policy,54-db}.cbl` → 4本とも exit 0・エラーなし
- `-std=cobol85`（時代考証モード）でも 4本とも通過
- `-Wall` の指摘は `51-s3.cbl:3 AUTHOR is obsolete [-Wobsolete]` のみ（作品テーマ上は好都合）
- **懸念していた §5.4 の索引ファイル**（`ORGANIZATION IS INDEXED` + `ALTERNATE RECORD KEY ... WITH DUPLICATES` + `FILE STATUS`）も問題なく通過

### 16.3 検証2: 「本物の COBOL として実行できるか」 → ✅ 実行成功
- `verify/samples/deploy.cbl` に `PROGRAM-ID. DEPLOY.`（`DISPLAY` して `GOBACK`）を用意
- `cobc -x -o run-s3 51-s3.cbl deploy.cbl` → コンパイル exit 0 → 実行で `DEPLOY: STACK SUBMITTED TO CLOUDFORMATION` 出力
- `cobc -x -o run-db 54-db.cbl deploy.cbl`（索引ファイル定義を含む）も同様に実行成功
- → `CALL "DEPLOY"` は実行時解決の標準 CALL 文として本物の COBOL ランタイムで動く。§4.1 の「規約依存で DSL では？」という弱点を潰す実証になるため、**この実行デモを MVP に格上げ推奨**

### 16.4 検証3: CFN で DynamoDB MRSC を単一スタック宣言できるか → ✅ 可能
- `AWS::DynamoDB::GlobalTable` のトップレベルに `MultiRegionConsistency: STRONG`、`GlobalTableWitnesses`（配列・最大 1 件、`{ "Region": String }`）で witness を指定（当初の「`ReplicaSpecification` 内」は誤記。公式スキーマと `cfn-lint` 1.60.0 で訂正）
- 「3レプリカ or 2レプリカ＋1 witness」。witness はレプリカと別リージョンかつ同一 region set 内
- **AP region set = 東京(ap-northeast-1)・ソウル(ap-northeast-2)・大阪(ap-northeast-3)** → §5.4 の 東京/大阪＋ソウル(witness) は妥当
- 出典: AWS CloudFormation `GlobalTableWitness` ドキュメント、AWS News Blog（MRSC GA）
- 残課題: Aurora DSQL のマルチリージョンを CFN 単一スタックで表現できるか（`AWS::DSQL::*`）は未確認（DSQL はストレッチ扱い）

### 16.5 追加確認: 予約語衝突 → ✅ 回避済み
- `cobc --list-reserved`（1006 語）で確認。`STATUS`/`TIMEOUT`/`ACTION`/`AUTHOR` は予約語
- §5 の全データ名（`FN-TIMEOUT-SEC`, `WS-FS`, `STMT-ACTION`, `STMT-EFFECT` 等）は接頭辞で回避済みと確認

### 16.6 規約面（Web）
- ✅ Devpost: 応募期間中に新規作成したプロジェクトのみ対象（初コミットは 10/30 以降で問題なし）
- ⚠️ 複数部門同時応募の可否は要確認（§14 にチェック項目追加済み）
