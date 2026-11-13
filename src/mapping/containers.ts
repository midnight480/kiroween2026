import { f } from "./network.js";
import type { ResourceSpec } from "./spec.js";

const LOG_RETENTION = [1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653].map(String);

export const CONTAINERS: ResourceSpec[] = [
  {
    type: "AWS::Logs::LogGroup",
    tags: false,
    fields: [
      f("LOG-NAME", "LogGroupName", "string"),
      // 保持期間を決めないとログが永遠に残って課金され続ける。書かなければ 30 日にする
      f("LOG-RETENTION-DAYS", "RetentionInDays", "number", { enum: LOG_RETENTION, default: 30 }),
    ],
  },
  {
    type: "AWS::ECS::Cluster",
    fields: [f("ECS-CLUSTER-NAME", "ClusterName", "string")],
  },
  {
    // 1 つのコンテナを持つ Fargate のタスク定義。環境変数は OCCURS の表（`*-ENV` グループ）で書く
    type: "AWS::ECS::TaskDefinition",
    fields: [
      f("TD-FAMILY", "Family", "string"),
      f("TD-CPU", "Cpu", "numstr", { required: true }),
      f("TD-MEMORY", "Memory", "numstr", { required: true }),
      f("TD-NETWORK-MODE", "NetworkMode", "string", { enum: ["awsvpc", "bridge", "host", "none"], default: "awsvpc" }),
      f("TD-COMPAT", "RequiresCompatibilities", "strings", { default: ["FARGATE"] }),
      f("TD-EXEC-ROLE", "ExecutionRoleArn", "ref"),
      f("TD-TASK-ROLE", "TaskRoleArn", "ref"),
      f("TD-CONTAINER-NAME", "ContainerDefinitions.0.Name", "string", { required: true }),
      f("TD-IMAGE", "ContainerDefinitions.0.Image", "string", { required: true }),
      f("TD-PORT", "ContainerDefinitions.0.PortMappings.0.ContainerPort", "number"),
      f("TD-ESSENTIAL", "ContainerDefinitions.0.Essential", "bool", { default: true }),
      // ログの出力先。ロググループを渡すと awslogs ドライバの設定を補う
      f("TD-LOG-GROUP", "ContainerDefinitions.0.LogConfiguration.Options.awslogs-group", "ref", {
        schemaPath: "ContainerDefinitions.*.LogConfiguration.Options",
      }),
    ],
    lists: [
      {
        group: "-ENV",
        cfn: "ContainerDefinitions.0.Environment",
        fields: [f("-KEY", "Name", "string", { required: true }), f("-VAL", "Value", "string", { required: true })],
      },
    ],
    post: (h) => {
      if (h.has("ContainerDefinitions.0.LogConfiguration.Options.awslogs-group")) {
        h.set("ContainerDefinitions.0.LogConfiguration.LogDriver", "awslogs");
        h.set("ContainerDefinitions.0.LogConfiguration.Options.awslogs-region", h.region ?? "us-east-1");
        h.set("ContainerDefinitions.0.LogConfiguration.Options.awslogs-stream-prefix", "ecs");
      } else {
        h.warn("ECS-NO-LOGS", "コンテナのログの出力先（TD-LOG-GROUP）がありません。障害のとき、原因を追えなくなります");
      }
      if (h.get("NetworkMode") === "awsvpc" && !h.has("ExecutionRoleArn")) {
        h.warn("ECS-NO-EXEC-ROLE", "TD-EXEC-ROLE がありません。ECR からの取得や CloudWatch Logs への出力に失敗することがあります");
      }
    },
  },
  {
    type: "AWS::ECS::Service",
    fields: [
      f("SVC-CLUSTER", "Cluster", "ref", { required: true }),
      f("SVC-NAME", "ServiceName", "string"),
      f("SVC-TASK", "TaskDefinition", "ref", { required: true }),
      f("SVC-COUNT", "DesiredCount", "number"),
      f("SVC-LAUNCH-TYPE", "LaunchType", "string", { enum: ["FARGATE", "EC2"], default: "FARGATE" }),
      f("SVC-SUBNETS", "NetworkConfiguration.AwsvpcConfiguration.Subnets", "strings", { required: true }),
      f("SVC-SG", "NetworkConfiguration.AwsvpcConfiguration.SecurityGroups", "strings"),
      // Security by default: タスクにパブリック IP を付けない
      f("SVC-PUBLIC-IP", "NetworkConfiguration.AwsvpcConfiguration.AssignPublicIp", "string", {
        enum: ["ENABLED", "DISABLED"],
        default: "DISABLED",
      }),
      f("SVC-TARGET-GROUP", "LoadBalancers.0.TargetGroupArn", "ref"),
      f("SVC-LB-CONTAINER", "LoadBalancers.0.ContainerName", "string"),
      f("SVC-LB-PORT", "LoadBalancers.0.ContainerPort", "number"),
      f("SVC-GRACE-SEC", "HealthCheckGracePeriodSeconds", "number"),
    ],
    post: (h) => {
      const parts = ["LoadBalancers.0.TargetGroupArn", "LoadBalancers.0.ContainerName", "LoadBalancers.0.ContainerPort"].map((p) => h.has(p));
      if (parts.some(Boolean) && !parts.every(Boolean)) {
        h.fail("MISSING-PROPERTY", "ロードバランサーにつなぐなら SVC-TARGET-GROUP、SVC-LB-CONTAINER、SVC-LB-PORT の 3 つがそろっている必要があります");
      }
      if (parts.every(Boolean) && !h.wrote("DEPENDS-ON")) {
        h.warn("SVC-NO-DEPENDS", "ロードバランサーにつなぐサービスは、リスナーより先に作ると失敗します。DEPENDS-ON にリスナーを書いてください");
      }
      if (h.get("NetworkConfiguration.AwsvpcConfiguration.AssignPublicIp") === "ENABLED") {
        h.warn("TASK-PUBLIC-IP", "タスクにパブリック IP が付きます（SVC-PUBLIC-IP）");
      }
    },
  },
  {
    type: "AWS::EKS::Cluster",
    tags: false,
    fields: [
      f("EKS-NAME", "Name", "string"),
      f("EKS-VERSION", "Version", "string"),
      f("EKS-ROLE", "RoleArn", "ref", { required: true }),
      f("EKS-SUBNETS", "ResourcesVpcConfig.SubnetIds", "strings", { required: true }),
      f("EKS-SG", "ResourcesVpcConfig.SecurityGroupIds", "strings"),
      f("EKS-PUBLIC-ENDPOINT", "ResourcesVpcConfig.EndpointPublicAccess", "bool"),
      f("EKS-PRIVATE-ENDPOINT", "ResourcesVpcConfig.EndpointPrivateAccess", "bool"),
      // Security by default: aws-auth の ConfigMap ではなく、アクセスエントリ（API）で認可する
      f("EKS-AUTH-MODE", "AccessConfig.AuthenticationMode", "string", { enum: ["API", "API_AND_CONFIG_MAP", "CONFIG_MAP"], default: "API" }),
    ],
    post: (h) => {
      // 書かなければ API サーバーはインターネットに公開される（AWS の既定）
      if (h.get("ResourcesVpcConfig.EndpointPublicAccess") !== false) {
        h.warn("EKS-PUBLIC-API", "Kubernetes API サーバーがインターネットに公開されます。EKS-PUBLIC-ENDPOINT を N にすることを検討してください");
      }
    },
  },
  {
    type: "AWS::EKS::Nodegroup",
    tags: false,
    fields: [
      f("NG-CLUSTER", "ClusterName", "ref", { required: true }),
      f("NG-ROLE", "NodeRole", "ref", { required: true }),
      f("NG-SUBNETS", "Subnets", "strings", { required: true }),
      f("NG-INSTANCE-TYPES", "InstanceTypes", "strings"),
      f("NG-MIN", "ScalingConfig.MinSize", "number"),
      f("NG-MAX", "ScalingConfig.MaxSize", "number"),
      f("NG-DESIRED", "ScalingConfig.DesiredSize", "number"),
      f("NG-AMI-TYPE", "AmiType", "string"),
      f("NG-DISK-GB", "DiskSize", "number"),
      f("NG-CAPACITY", "CapacityType", "string", { enum: ["ON_DEMAND", "SPOT"] }),
    ],
    post: (h) => {
      const min = h.get("ScalingConfig.MinSize");
      const max = h.get("ScalingConfig.MaxSize");
      const desired = h.get("ScalingConfig.DesiredSize");
      if (typeof min === "number" && typeof max === "number" && min > max) h.fail("INVALID-VALUE", "NG-MIN が NG-MAX より大きくなっています");
      if (typeof desired === "number" && ((typeof min === "number" && desired < min) || (typeof max === "number" && desired > max))) {
        h.fail("INVALID-VALUE", "NG-DESIRED は NG-MIN と NG-MAX の間に収めてください");
      }
    },
  },
];
