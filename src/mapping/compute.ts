import { f } from "./network.js";
import type { ResourceSpec } from "./spec.js";

const LB_PROTOCOLS = ["HTTP", "HTTPS", "TCP", "TLS", "UDP", "TCP_UDP"] as const;

export const COMPUTE: ResourceSpec[] = [
  {
    type: "AWS::EC2::Instance",
    tags: true,
    fields: [
      f("EC2-AMI", "ImageId", "ssm", { required: true }),
      f("EC2-TYPE", "InstanceType", "string", { required: true }),
      f("EC2-SUBNET", "SubnetId", "ref"),
      f("EC2-SG", "SecurityGroupIds", "strings"),
      f("EC2-KEY", "KeyName", "string"),
      f("EC2-PROFILE", "IamInstanceProfile", "ref"),
      f("EC2-USERDATA", "UserData", "userdata"),
      f("EC2-DISK-GB", "BlockDeviceMappings.0.Ebs.VolumeSize", "number"),
      f("EC2-DISK-DEVICE", "BlockDeviceMappings.0.DeviceName", "string"),
      // Security by default: IMDSv2 を必須にする
      f("EC2-IMDS-TOKENS", "MetadataOptions.HttpTokens", "string", { enum: ["required", "optional"], default: "required" }),
    ],
    post: (h) => {
      if (h.get("MetadataOptions.HttpTokens") === "optional") h.warn("IMDSV1-ENABLED", "IMDSv2 を必須にしていません（HttpTokens=optional）");
      if (h.has("BlockDeviceMappings.0.Ebs.VolumeSize")) {
        // ルートボリュームの大きさだけを変える。暗号化は既定で有効にする
        if (!h.has("BlockDeviceMappings.0.DeviceName")) h.set("BlockDeviceMappings.0.DeviceName", "/dev/xvda");
        h.set("BlockDeviceMappings.0.Ebs.Encrypted", true);
        h.set("BlockDeviceMappings.0.Ebs.VolumeType", "gp3");
      } else if (h.has("BlockDeviceMappings.0.DeviceName")) {
        h.fail("MISSING-PROPERTY", "EC2-DISK-DEVICE を書くなら EC2-DISK-GB も必要です");
      }
    },
  },
  {
    type: "AWS::IAM::InstanceProfile",
    fields: [f("PROFILE-ROLES", "Roles", "strings", { required: true })],
  },
  {
    type: "AWS::EC2::LaunchTemplate",
    fields: [
      f("LT-AMI", "LaunchTemplateData.ImageId", "ssm", { required: true }),
      f("LT-TYPE", "LaunchTemplateData.InstanceType", "string", { required: true }),
      f("LT-SG", "LaunchTemplateData.SecurityGroupIds", "strings"),
      f("LT-KEY", "LaunchTemplateData.KeyName", "string"),
      f("LT-PROFILE", "LaunchTemplateData.IamInstanceProfile.Name", "ref"),
      f("LT-USERDATA", "LaunchTemplateData.UserData", "userdata"),
      f("LT-IMDS-TOKENS", "LaunchTemplateData.MetadataOptions.HttpTokens", "string", { enum: ["required", "optional"], default: "required" }),
    ],
  },
  {
    type: "AWS::AutoScaling::AutoScalingGroup",
    fields: [
      f("ASG-MIN", "MinSize", "numstr", { required: true }),
      f("ASG-MAX", "MaxSize", "numstr", { required: true }),
      f("ASG-DESIRED", "DesiredCapacity", "numstr"),
      f("ASG-SUBNETS", "VPCZoneIdentifier", "strings", { required: true }),
      f("ASG-LT", "LaunchTemplate.LaunchTemplateId", "ref", { required: true }),
      f("ASG-LT-VERSION", "LaunchTemplate.Version", "ref"),
      f("ASG-TARGET-GROUPS", "TargetGroupARNs", "strings"),
      f("ASG-HEALTH-CHECK", "HealthCheckType", "string", { enum: ["EC2", "ELB"] }),
      f("ASG-GRACE-SEC", "HealthCheckGracePeriod", "number"),
    ],
    post: (h) => {
      // 版の指定が無いと古い版を掴む。最新版に固定する
      if (!h.has("LaunchTemplate.Version") && h.has("LaunchTemplate.LaunchTemplateId")) {
        const lt = h.get("LaunchTemplate.LaunchTemplateId") as { Ref?: string } | string;
        if (typeof lt === "object" && lt !== null && "Ref" in lt && lt.Ref) {
          h.set("LaunchTemplate.Version", { "Fn::GetAtt": [lt.Ref, "LatestVersionNumber"] });
        } else {
          h.set("LaunchTemplate.Version", "$Latest");
        }
      }
    },
  },
  {
    // ALB（application）と NLB（network）は同じ型。LB-TYPE で切り替える
    type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
    tags: true,
    fields: [
      f("LB-TYPE", "Type", "string", { enum: ["application", "network", "gateway"], default: "application" }),
      f("LB-SCHEME", "Scheme", "string", { enum: ["internet-facing", "internal"] }),
      f("LB-SUBNETS", "Subnets", "strings", { required: true }),
      f("LB-SG", "SecurityGroups", "strings"),
      f("LB-NAME", "Name", "string"),
    ],
    post: (h) => {
      if (h.get("Type") === "application" && !h.has("SecurityGroups")) {
        h.warn("ALB-NO-SG", "ALB にセキュリティグループがありません（既定の SG が付き、意図しない開放になりえます）");
      }
    },
  },
  {
    type: "AWS::ElasticLoadBalancingV2::TargetGroup",
    tags: true,
    fields: [
      f("TG-PORT", "Port", "number"),
      f("TG-PROTOCOL", "Protocol", "string", { enum: [...LB_PROTOCOLS, "GENEVE"] }),
      f("TG-VPC", "VpcId", "ref"),
      f("TG-TARGET-TYPE", "TargetType", "string", { enum: ["instance", "ip", "lambda", "alb"] }),
      f("TG-HEALTH-PATH", "HealthCheckPath", "string"),
      f("TG-HEALTH-PROTOCOL", "HealthCheckProtocol", "string", { enum: ["HTTP", "HTTPS", "TCP"] }),
      f("TG-TARGETS", "Targets", "targets"),
    ],
  },
  {
    type: "AWS::ElasticLoadBalancingV2::Listener",
    fields: [
      f("LSN-LB", "LoadBalancerArn", "ref", { required: true }),
      f("LSN-PORT", "Port", "number"),
      f("LSN-PROTOCOL", "Protocol", "string", { enum: LB_PROTOCOLS }),
      f("LSN-CERT", "Certificates.0.CertificateArn", "ref"),
      f("LSN-SSL-POLICY", "SslPolicy", "string"),
      f("LSN-TARGET-GROUP", "DefaultActions.0.TargetGroupArn", "ref"),
      f("LSN-REDIRECT-PROTO", "DefaultActions.0.RedirectConfig.Protocol", "string", { enum: ["HTTP", "HTTPS", "#{protocol}"] }),
      f("LSN-REDIRECT-PORT", "DefaultActions.0.RedirectConfig.Port", "numstr"),
      f("LSN-REDIRECT-CODE", "DefaultActions.0.RedirectConfig.StatusCode", "string", { enum: ["HTTP_301", "HTTP_302"] }),
    ],
    post: (h) => {
      const forward = h.has("DefaultActions.0.TargetGroupArn");
      const redirect = h.has("DefaultActions.0.RedirectConfig.StatusCode");
      if (forward === redirect) h.fail("MISSING-PROPERTY", "LSN-TARGET-GROUP（転送）か LSN-REDIRECT-*（リダイレクト）のどちらか 1 つだけを書いてください");
      h.set("DefaultActions.0.Type", forward ? "forward" : "redirect");
      if (h.get("Protocol") === "HTTPS" && !h.has("Certificates.0.CertificateArn")) {
        h.fail("MISSING-PROPERTY", "HTTPS のリスナーには LSN-CERT（ACM 証明書）が必要です");
      }
    },
  },
  {
    // いにしえのロードバランサー（CLB）
    type: "AWS::ElasticLoadBalancing::LoadBalancer",
    tags: true,
    fields: [
      f("CLB-SUBNETS", "Subnets", "strings"),
      f("CLB-SG", "SecurityGroups", "strings"),
      f("CLB-SCHEME", "Scheme", "string", { enum: ["internet-facing", "internal"] }),
      f("CLB-INSTANCES", "Instances", "strings"),
      f("CLB-HEALTH-TARGET", "HealthCheck.Target", "string"),
      f("CLB-HEALTH-INTERVAL", "HealthCheck.Interval", "numstr"),
      f("CLB-HEALTH-TIMEOUT", "HealthCheck.Timeout", "numstr"),
      f("CLB-HEALTHY", "HealthCheck.HealthyThreshold", "numstr"),
      f("CLB-UNHEALTHY", "HealthCheck.UnhealthyThreshold", "numstr"),
    ],
    lists: [
      {
        group: "-LISTENER",
        cfn: "Listeners",
        fields: [
          f("-LPORT", "LoadBalancerPort", "numstr", { required: true }),
          f("-IPORT", "InstancePort", "numstr", { required: true }),
          f("-LPROTO", "Protocol", "string", { required: true, enum: ["HTTP", "HTTPS", "TCP", "SSL"] }),
          f("-LCERT", "SSLCertificateId", "ref"),
        ],
      },
    ],
    post: (h) => {
      if (!h.has("Listeners")) h.fail("MISSING-PROPERTY", "CLB には OCCURS の *-LISTENER グループが必要です");
      h.warn("CLASSIC-LB", "Classic Load Balancer は 2022 年に退役しました。ALB か NLB を検討してください");
    },
  },
];
