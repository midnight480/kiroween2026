import { f } from "./network.js";
import type { Hook, ResourceSpec } from "./spec.js";

/** FIFO のキュー／トピックの名前は `.fifo` で終わる必要がある（CloudFormation が後から失敗させる前に止める）。 */
function fifoNameRule(h: Hook, nameField: string, fifoField: string, namePath: string, fifoPath: string): void {
  if (h.get(fifoPath) !== true) return;
  const name = h.get(namePath);
  if (typeof name !== "string" || !name.endsWith(".fifo")) {
    h.fail("INVALID-VALUE", `${fifoField} が Y のとき、${nameField} は必須で、末尾は .fifo にします`);
  }
}

export const MESSAGING: ResourceSpec[] = [
  {
    type: "AWS::SQS::Queue",
    tags: true,
    notes: ["Error: when `QUEUE-FIFO` is `Y`, `QUEUE-NAME` is required and must end in `.fifo`."],
    fields: [
      f("QUEUE-NAME", "QueueName", "string"),
      f("QUEUE-FIFO", "FifoQueue", "bool"),
      f("QUEUE-DEDUP", "ContentBasedDeduplication", "bool"),
      f("QUEUE-VISIBILITY-SEC", "VisibilityTimeout", "number"),
      f("QUEUE-RETENTION-SEC", "MessageRetentionPeriod", "number"),
      f("QUEUE-DELAY-SEC", "DelaySeconds", "number"),
      f("QUEUE-WAIT-SEC", "ReceiveMessageWaitTimeSeconds", "number"),
      // デッドレターキュー。ARN を渡す（例: GETATT:ORDERS-DLQ.ARN）
      f("QUEUE-DLQ", "RedrivePolicy.deadLetterTargetArn", "ref", { schemaPath: "RedrivePolicy" }),
      f("QUEUE-MAX-RECEIVES", "RedrivePolicy.maxReceiveCount", "number", { schemaPath: "RedrivePolicy" }),
      // Security by default: 保管時の暗号化（SQS 管理キー）
      f("QUEUE-SSE", "SqsManagedSseEnabled", "bool", { default: true }),
    ],
    post: (h) => {
      fifoNameRule(h, "QUEUE-NAME", "QUEUE-FIFO", "QueueName", "FifoQueue");
      if (h.has("RedrivePolicy.deadLetterTargetArn") && !h.has("RedrivePolicy.maxReceiveCount")) {
        h.set("RedrivePolicy.maxReceiveCount", 5);
      }
      if (h.has("RedrivePolicy.maxReceiveCount") && !h.has("RedrivePolicy.deadLetterTargetArn")) {
        h.fail("MISSING-PROPERTY", "QUEUE-MAX-RECEIVES を書くなら QUEUE-DLQ も必要です");
      }
      if (h.get("SqsManagedSseEnabled") === false) h.warn("SQS-UNENCRYPTED", "キューが暗号化されていません（SqsManagedSseEnabled）");
    },
  },
  {
    // SNS のトピックから、このキューにメッセージを送ることを許す（トピック → キューの購読に必要）
    type: "AWS::SQS::QueuePolicy",
    fields: [
      f("QPOL-QUEUES", "Queues", "strings", { required: true }),
      f("QPOL-QUEUE-ARN", "PolicyDocument.Statement.0.Resource", "ref", { required: true, schemaPath: "PolicyDocument" }),
      f("QPOL-SNS-TOPIC", "PolicyDocument.Statement.0.Condition.ArnEquals.aws:SourceArn", "ref", {
        required: true,
        schemaPath: "PolicyDocument",
      }),
    ],
    post: (h) => {
      h.set("PolicyDocument.Version", "2012-10-17");
      h.set("PolicyDocument.Statement.0.Effect", "Allow");
      h.set("PolicyDocument.Statement.0.Principal", { Service: "sns.amazonaws.com" });
      h.set("PolicyDocument.Statement.0.Action", "sqs:SendMessage");
    },
  },
  {
    type: "AWS::SNS::Topic",
    tags: true,
    notes: ["Error: when `TOPIC-FIFO` is `Y`, `TOPIC-NAME` is required and must end in `.fifo`."],
    fields: [
      f("TOPIC-NAME", "TopicName", "string"),
      f("TOPIC-DISPLAY", "DisplayName", "string"),
      f("TOPIC-FIFO", "FifoTopic", "bool"),
      f("TOPIC-DEDUP", "ContentBasedDeduplication", "bool"),
      // 既定では暗号化しない: AWS 管理キーで暗号化したトピックには、CloudWatch アラームなどが発行できなくなる
      f("TOPIC-KMS", "KmsMasterKeyId", "string"),
    ],
    post: (h) => fifoNameRule(h, "TOPIC-NAME", "TOPIC-FIFO", "TopicName", "FifoTopic"),
  },
  {
    type: "AWS::SNS::Subscription",
    fields: [
      f("SUB-TOPIC", "TopicArn", "ref", { required: true }),
      f("SUB-PROTOCOL", "Protocol", "string", {
        required: true,
        enum: ["sqs", "lambda", "email", "email-json", "https", "http", "sms", "application", "firehose"],
      }),
      f("SUB-ENDPOINT", "Endpoint", "ref", { required: true }),
      f("SUB-RAW", "RawMessageDelivery", "bool"),
    ],
    post: (h) => {
      const protocol = h.get("Protocol");
      if (protocol === "http") h.warn("SNS-PLAIN-HTTP", "http の購読はメッセージが暗号化されずに流れます。https を使ってください");
      if (protocol === "email" || protocol === "email-json") h.warn("SNS-NEEDS-CONFIRM", "メールの購読は、受信者が確認メールを承認するまで有効になりません");
    },
  },
];
