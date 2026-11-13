/**
 * メッセージの翻訳層（日本語 → 英語）。
 *
 * コンパイラのメッセージは日本語で書かれている。デモや海外の読者のために、表示するときだけ
 * 英語に切り替える。呼び出し側のコードは変えず、ここの表で「日本語の文面 → 英語の文面」を引く。
 *
 * 表のキーは、ソースに書いた文字列そのまま（`${...}` を含む）。`${...}` は実行時の値に当たる
 * 部分で、英語側では出てきた順に `$1`, `$2`, ... で参照する。
 * 訳し漏れは tests/i18n.test.ts が検出する（ソースの日本語メッセージが全部この表にあること）。
 */
export type Locale = "ja" | "en";

/** [日本語の文面, 英語の文面] */
const RULES: ReadonlyArray<readonly [string, string]> = [
  ["タブ文字は使えません。パンチカードにタブはありません", "Tabs are not allowed. Punch cards have no tab key"],
  ["80 桁を超えています（${card.length} 桁）", "Line exceeds 80 columns ($1 columns)"],
  ["連番 ${card.slice(0, 6)} は直前の ${String(lastSequence).padStart(6, \"0\")} 以下です。カードデッキが乱れています。ソーターにかけてください", "Sequence number $1 is not above the previous $2. The card deck is out of order. Please run it through the sorter"],
  ["73 桁目以降は読まれません", "Columns 73 and beyond are not read"],
  ["継続行の前に続けるべき行がありません", "A continuation line needs a line before it to continue"],
  ["継続行は文字列リテラルの分割のみ対応しています", "Continuation lines only support splitting a string literal"],
  ["継続行の最初の非空白は引用符 \" でなければなりません", "The first non-blank character of a continuation line must be a quote (\")"],
  ["7 桁目は空白・*・-・D・/ のみ使えます（'${indicator}' があります）。桁がずれていませんか", "Column 7 may only hold a space, *, -, D or /. Found '$1'. Is the code shifted?"],
  ["文字列リテラルが閉じていません", "String literal is not closed"],
  ["予約語・データ名は大文字で書いてください: ${word}", "Reserved words and data names must be upper case: $1"],
  ["解釈できない文字です: '${ch}'", "Unrecognized character: '$1'"],
  ["最後の文の終端ピリオドがありません", "The last sentence has no closing period"],
  ["この PIC 句は MVP では扱えません: ${text}", "This PIC clause is not supported in the MVP: $1"],
  ["${what} にはリテラルが必要です", "$1 needs a literal"],
  ["OCCURS には回数が必要です", "OCCURS needs a count"],
  ["この句は MVP では扱えません: ${t.value}", "This clause is not supported in the MVP: $1"],
  ["88 レベルは親項目と VALUE が必要です", "A level 88 entry needs a parent item and a VALUE"],
  ["レベル ${level} の親項目（01）がありません", "Level $1 has no parent item (01)"],
  ["SELECT の後にファイル名が必要です", "SELECT must be followed by a file name"],
  ["名前が必要です", "A name is required"],
  ["ASSIGN TO には外部名のリテラルが必要です", "ASSIGN TO needs a literal external name"],
  ["SELECT 句は MVP では扱えません: ${t.value}", "This SELECT clause is not supported in the MVP: $1"],
  ["SELECT には ASSIGN TO が必要です", "SELECT needs ASSIGN TO"],
  ["MOVE <リテラル> TO <データ名> の形式で書いてください", "Write it as MOVE <literal> TO <data-name>"],
  ["添字は定数のみ対応しています", "Only constant subscripts are supported"],
  ["MOVE の複数ターゲットは対応していません", "MOVE with several targets is not supported"],
  ["DISPLAY（Outputs 連携）は未実装のため無視します", "DISPLAY (Outputs integration) is not implemented and is ignored"],
  ["未知の DIVISION です: ${t0.value}", "Unknown DIVISION: $1"],
  ["FD の前にレコード定義があります", "A record definition appears before any FD"],
  ["${section || \"(無名)\"} SECTION は MVP では扱えません", "$1 SECTION is not supported in the MVP"],
  ["DATA DIVISION で解釈できない文です: ${t0.value}", "Cannot interpret this sentence in the DATA DIVISION: $1"],
  ["この文は MVP では扱えません: ${t0.value}", "This statement is not supported in the MVP: $1"],
  ["DIVISION の外に文があります", "A statement appears outside any DIVISION"],
  ["PROGRAM-ID がありません", "PROGRAM-ID is missing"],
  ["STOP RUN がありません。このジョブは終了しません（JOB DID NOT TERMINATE — 夜間バッチが朝まで回り続けます）", "STOP RUN is missing. This job will not terminate (JOB DID NOT TERMINATE — the nightly batch will keep running until morning)"],
  ["${item.name} は PIC X(${item.pic.length}) ですが、値が ${value.length} 文字あります", "$1 is PIC X($2) but the value has $3 characters"],
  ["${item.name} は PIC 9(${item.pic.length}) ですが、値 ${value} は桁あふれします", "$1 is PIC 9($2) but the value $3 overflows it"],
  ["MOVE の転送先 ${stmt.target} が定義されていません", "MOVE target $1 is not defined"],
  ["${stmt.target} が複数定義されています", "$1 is defined more than once"],
  ["${stmt.target} は OCCURS 配下なので添字が必要です", "$1 is under OCCURS, so it needs a subscript"],
  ["${stmt.target} (${stmt.subscript}) は範囲外です（1〜${max}）", "$1 ($2) is out of range (1 to $3)"],
  ["${stmt.target} は OCCURS ではないので添字は使えません", "$1 is not under OCCURS, so it cannot have a subscript"],
  ["OBJECT-COMPUTER はリージョン名（例: AWS-AP-NORTHEAST-1）で指定してください: ${name}", "OBJECT-COMPUTER must name a region (for example AWS-AP-NORTHEAST-1): $1"],
  ["MVP で対応していないリソース型です: ${String(type)}", "Resource type not supported in the MVP: $1"],
  ["論理 ID ${r.logicalId} が ${dup.name} と ${r.name} で重複しています", "Logical ID $1 is used by both $2 and $3"],
  ["DB リンクの相互接続で冗長化する時代は終わりました。DYNAMODB-MRSC を使ってください", "The era of redundancy by interconnecting DB links is over. Use DYNAMODB-MRSC"],
  ["AURORA-DSQL はストレッチ対象です（MVP は DYNAMODB / DYNAMODB-MRSC）", "AURORA-DSQL is a stretch goal (the MVP supports DYNAMODB / DYNAMODB-MRSC)"],
  ["未知の DB エンジンです: ${select.assignTo}", "Unknown DB engine: $1"],
  ["循環参照です: ${[...path, id].join(\" → \")}", "Circular reference: $1"],
  ["${resource.name} に ${name} が必要です", "$1 needs $2"],
  ["${r.name}: BLOCK-PUBLIC \"N\" はパブリックアクセスを許可します（赤インク警告）", "$1: BLOCK-PUBLIC \"N\" allows public access (red-ink warning)"],
  ["MANAGED-POLICY は AWS-MANAGED:<パス> か ARN で指定してください: ${v}", "MANAGED-POLICY must be AWS-MANAGED:<path> or an ARN: $1"],
  ["${r.name} に OCCURS の STMT グループが必要です", "$1 needs an OCCURS group for its statements (STMT)"],
  ["${stmt.name} に *${suffix} 項目が必要です", "$1 needs an item ending in *$2"],
  ["${stmt.name} (${i}) の Effect/Action/Resource が揃っていません", "Effect, Action and Resource of $1 ($2) are not all set"],
  ["${r.name}: 呪われたワイルドカード Action \"${String(a)}\"", "$1: cursed wildcard Action \"$2\""],
  ["FN-CODE-S3 は s3://<バケット>/<キー> で指定してください: ${str(s3)}", "FN-CODE-S3 must be s3://<bucket>/<key>: $1"],
  ["${r.name}: Lambda の Code（FN-CODE-S3 / FN-CODE-INLINE）がありません。このままではデプロイできません", "$1: the Lambda has no Code (FN-CODE-S3 / FN-CODE-INLINE). It cannot be deployed as it is"],
  ["${select.name} に対応する FD がありません", "$1 has no matching FD"],
  ["${select.name} に RECORD KEY がありません", "$1 has no RECORD KEY"],
  ["キー ${name} が FD ${fd.name} のレコードにありません", "Key $1 is not in the record of FD $2"],
  ["${select.name}-REGIONS グループ（REPLICA-1 / REPLICA-2 / WITNESS-REGION）が必要です", "Group $1-REGIONS (REPLICA-1 / REPLICA-2 / WITNESS-REGION) is required"],
  ["REPLICA-1 / REPLICA-2 / WITNESS-REGION は互いに別のリージョンにしてください", "REPLICA-1, REPLICA-2 and WITNESS-REGION must be three different regions"],
  ["${reg} は AP region set（東京・ソウル・大阪）の外です。MRSC は同一 region set 内でのみ構成できます", "$1 is outside the AP region set (Tokyo, Seoul, Osaka). MRSC can only be built inside one region set"],
  ["主リージョン ${ctx.region} が REPLICA-1 / REPLICA-2 にありません（スタックのリージョンのレプリカは必須）", "The primary region $1 is not in REPLICA-1 / REPLICA-2 (the stack region must hold a replica)"],
  ["未対応のリソース型です: ${r.type}", "Unsupported resource type: $1"],
  ["参照先 ${name} が同一ファイル内にありません", "Referenced name $1 is not in this file"],
  ["参照の書式が不正です: ${raw}", "Invalid reference format: $1"],
  ["この項目では REF: に接尾辞を付けられません: ${raw}", "This item cannot take a suffix after REF: $1"],
  ["OBJECT-COMPUTER がありません。デプロイ時は AWS の既定リージョンを使います", "There is no OBJECT-COMPUTER. Deployment will use the AWS default region"],
  ["ロードバランサー + EC2 + RDS。古の COBOL で現代の AWS を書いたのに、出来上がったのは王道の 3 層構成でした。1998 年が構成を返してほしがっています", "Load balancer + EC2 + RDS. You wrote modern AWS in ancient COBOL, and out came the classic three-tier architecture. 1998 would like its architecture back"],
  ["${field.name} は ${field.enum.join(\" / \")} のどれかです（${text} が書かれています）", "$1 must be one of $2 (found $3)"],
  ["${field.name} は \"Y\" か \"N\" です（${text} が書かれています）", "$1 must be \"Y\" or \"N\" (found $2)"],
  ["${field.name} は数値です（${text} が書かれています）", "$1 must be a number (found $2)"],
  ["${field.name} は ${Object.keys(field.map).join(\" / \")} のどれかです（${text} が書かれています）", "$1 must be one of $2 (found $3)"],
  ["${field.name} には 1 つ以上の値が必要です", "$1 needs at least one value"],
  ["${field.name} に平文のパスワードは書けません。SECRET:<名前> か SSM:<パス> で参照してください（マスターパスワードは ManageMasterUserPassword に任せるのが最善です）", "$1 cannot hold a plain-text password. Reference it with SECRET:<name> or SSM:<path> (letting RDS manage the master password is best)"],
  ["${occurs.name} (${n}) に *${f.name} が必要です", "$1 ($2) needs *$3"],
  ["${occurs.name} (${n}) が空です。MOVE で値を入れてください", "$1 ($2) is empty. Fill it in with MOVE"],
  ["${r.type} に ${name} という項目はありません${suggest(name, known)}", "$1 has no item named $2$3"],
  ["${occurs.name} に *${list.fields.map((f) => f.name).join(\" / *\")} 以外の項目 ${c.name} があります", "$1 has an item $3 that is not one of: *$2"],
  ["${r.name} に ${f.name} が必要です", "$1 needs $2"],
  ["DELETION-POLICY は Delete / Retain / Snapshot のどれかです（${v} が書かれています）", "DELETION-POLICY must be Delete, Retain or Snapshot (found $1)"],
  ["DEPENDS-ON の ${name} が同一ファイル内にありません", "DEPENDS-ON name $1 is not in this file"],
  ["ROUTE-IGW か ROUTE-NAT のどちらか 1 つだけを書いてください", "Write exactly one of ROUTE-IGW or ROUTE-NAT"],
  ["${name}（${port}）が 0.0.0.0/0 に開いています。呪われたワイルドカードです", "$1 ($2) is open to 0.0.0.0/0. A cursed wildcard"],
  ["RECORD-ZONE-ID か RECORD-ZONE-NAME のどちらか 1 つだけを書いてください", "Write exactly one of RECORD-ZONE-ID or RECORD-ZONE-NAME"],
  ["RECORD-ALIAS-* か RECORD-VALUES のどちらか 1 つだけを書いてください", "Write exactly one of RECORD-ALIAS-* or RECORD-VALUES"],
  ["RECORD-ALIAS-DNS には RECORD-ALIAS-ZONE も必要です", "RECORD-ALIAS-DNS also needs RECORD-ALIAS-ZONE"],
  ["エイリアスでないレコードには RECORD-TTL が必要です", "A record that is not an alias needs RECORD-TTL"],
  ["CloudFront の証明書は us-east-1 の ACM のみです。OBJECT-COMPUTER を AWS-US-EAST-1 にしてください（いまは ${h.region}）", "CloudFront certificates must come from ACM in us-east-1. Set OBJECT-COMPUTER to AWS-US-EAST-1 (it is $1 now)"],
  ["証明書があるのに CDN-ALIASES がありません。独自ドメインで配信されません", "There is a certificate but no CDN-ALIASES. It will not be served on a custom domain"],
  ["IMDSv2 を必須にしていません（HttpTokens=optional）", "IMDSv2 is not required (HttpTokens=optional)"],
  ["EC2-DISK-DEVICE を書くなら EC2-DISK-GB も必要です", "If you write EC2-DISK-DEVICE you also need EC2-DISK-GB"],
  ["ALB にセキュリティグループがありません（既定の SG が付き、意図しない開放になりえます）", "The ALB has no security group (a default one is attached, which may open it unintentionally)"],
  ["LSN-TARGET-GROUP（転送）か LSN-REDIRECT-*（リダイレクト）のどちらか 1 つだけを書いてください", "Write exactly one of LSN-TARGET-GROUP (forward) or LSN-REDIRECT-* (redirect)"],
  ["HTTPS のリスナーには LSN-CERT（ACM 証明書）が必要です", "An HTTPS listener needs LSN-CERT (an ACM certificate)"],
  ["CLB には OCCURS の *-LISTENER グループが必要です", "A CLB needs an OCCURS group ending in -LISTENER"],
  ["Classic Load Balancer は 2022 年に退役しました。ALB か NLB を検討してください", "Classic Load Balancer was retired in 2022. Consider an ALB or NLB"],
  ["パスワードを書いたまま、マスターパスワードの管理（MANAGED-PASSWORD）も有効にはできません", "You cannot write a password and also enable managed master passwords (MANAGED-PASSWORD)"],
  ["データベースがインターネットに公開されています（PubliclyAccessible）", "The database is exposed to the internet (PubliclyAccessible)"],
  ["ストレージが暗号化されていません", "Storage is not encrypted"],
  ["保管時の暗号化が無効です（CACHE-AT-REST）", "Encryption at rest is disabled (CACHE-AT-REST)"],
  ["転送時の暗号化が無効です（CACHE-IN-TRANSIT）", "Encryption in transit is disabled (CACHE-IN-TRANSIT)"],
  ["フェイルオーバーと Multi-AZ には、CACHE-NODES が 2 以上必要です", "Failover and Multi-AZ need CACHE-NODES of 2 or more"],
  ["コンテナのログの出力先（TD-LOG-GROUP）がありません。障害のとき、原因を追えなくなります", "No log destination for the container (TD-LOG-GROUP). You will not be able to trace failures"],
  ["TD-EXEC-ROLE がありません。ECR からの取得や CloudWatch Logs への出力に失敗することがあります", "TD-EXEC-ROLE is missing. Pulling from ECR or writing to CloudWatch Logs may fail"],
  ["ロードバランサーにつなぐなら SVC-TARGET-GROUP、SVC-LB-CONTAINER、SVC-LB-PORT の 3 つがそろっている必要があります", "To attach to a load balancer, SVC-TARGET-GROUP, SVC-LB-CONTAINER and SVC-LB-PORT must all be present"],
  ["ロードバランサーにつなぐサービスは、リスナーより先に作ると失敗します。DEPENDS-ON にリスナーを書いてください", "A service attached to a load balancer fails if it is created before the listener. Put the listener in DEPENDS-ON"],
  ["タスクにパブリック IP が付きます（SVC-PUBLIC-IP）", "Tasks get a public IP (SVC-PUBLIC-IP)"],
  ["Kubernetes API サーバーがインターネットに公開されます。EKS-PUBLIC-ENDPOINT を N にすることを検討してください", "The Kubernetes API server is exposed to the internet. Consider setting EKS-PUBLIC-ENDPOINT to N"],
  ["NG-MIN が NG-MAX より大きくなっています", "NG-MIN is greater than NG-MAX"],
  ["NG-DESIRED は NG-MIN と NG-MAX の間に収めてください", "Keep NG-DESIRED between NG-MIN and NG-MAX"],
  ["${fifoField} が Y のとき、${nameField} は必須で、末尾は .fifo にします", "When $1 is Y, $2 is required and must end in .fifo"],
  ["QUEUE-MAX-RECEIVES を書くなら QUEUE-DLQ も必要です", "If you write QUEUE-MAX-RECEIVES you also need QUEUE-DLQ"],
  ["キューが暗号化されていません（SqsManagedSseEnabled）", "The queue is not encrypted (SqsManagedSseEnabled)"],
  ["http の購読はメッセージが暗号化されずに流れます。https を使ってください", "An http subscription sends messages unencrypted. Use https"],
  ["メールの購読は、受信者が確認メールを承認するまで有効になりません", "An e-mail subscription is not active until the recipient confirms the e-mail"],
  ["スタック ${stackName} は ${existing} です。cobf destroy で削除してからやり直してください", "Stack $1 is $2. Delete it with cobf destroy and try again"],
  ["スタック ${stackName} は ${existing} です。完了してから再実行してください", "Stack $1 is $2. Wait for it to finish, then run again"],
  ["スタック ${stackName} は ${existing} です。比較できません", "Stack $1 is $2. It cannot be compared"],
];

/** 文面の一部だけを置き換える。メッセージの中に埋め込まれる断片用。 */
const FRAGMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/（もしかして (.+?)？）/g, " (did you mean $1?)"],
  [/\(無名\)/g, "(unnamed)"],
];

interface CompiledRule {
  pattern: RegExp;
  english: string;
  weight: number;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `${...}` を (.+?) に置き換えた正規表現にする。 */
function compile([ja, en]: readonly [string, string]): CompiledRule {
  const parts = ja.split(/\$\{[^}]*\}/);
  const pattern = new RegExp(`^${parts.map(escapeRegExp).join("(.+?)")}$`, "s");
  // 固定の文字が多いものを先に試す（広く当たる規則に横取りされないように）
  return { pattern, english: en, weight: parts.join("").length };
}

const COMPILED: CompiledRule[] = RULES.map(compile).sort((a, b) => b.weight - a.weight);

let current: Locale = "ja";

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

function applyFragments(text: string): string {
  return FRAGMENTS.reduce((acc, [re, to]) => acc.replace(re, to), text);
}

function translate(message: string): string | undefined {
  for (const rule of COMPILED) {
    const m = rule.pattern.exec(message);
    if (m) return rule.english.replace(/\$(\d+)/g, (_, n: string) => applyFragments(m[Number(n)] ?? ""));
  }
  return undefined;
}

/**
 * メッセージを、指定の言語（省略時は現在の言語）にして返す。
 * 訳が無い文面は、そのまま返す（黙って消さない）。
 */
export function localize(message: string, locale: Locale = current): string {
  if (locale === "ja") return message;
  const whole = translate(message);
  if (whole !== undefined) return applyFragments(whole);

  // 警告は `リソース名: 文面` の形で付く。名前を外して訳し、付け直す
  const prefixed = /^([A-Z0-9][A-Z0-9-]*): ([\s\S]*)$/.exec(message);
  if (prefixed) {
    const body = translate(prefixed[2] as string);
    if (body !== undefined) return `${prefixed[1]}: ${applyFragments(body)}`;
  }
  return applyFragments(message);
}

/** 訳が表にあるか（テスト用）。 */
export function hasTranslation(message: string): boolean {
  return translate(message) !== undefined || /^([A-Z0-9][A-Z0-9-]*): ([\s\S]*)$/.test(message) && translate(message.replace(/^[A-Z0-9][A-Z0-9-]*: /, "")) !== undefined;
}
