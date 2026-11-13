import type { Field, Kind, ResourceSpec } from "./spec.js";

type Opts = Partial<Pick<Field, "required" | "enum" | "default" | "map" | "schemaPath">>;

/** 対応表の 1 行。 */
export const f = (name: string, cfn: string, kind: Kind, opts: Opts = {}): Field => ({ name, cfn, kind, ...opts });

const PROTOCOLS = ["tcp", "udp", "icmp", "icmpv6", "-1"] as const;

/** SG のルール 1 件（インラインの Ingress / Egress 共通）。名前は接尾辞。互いに他の接尾辞にならないこと。 */
const ruleFields = (peer: { name: string; cfn: string }): Field[] => [
  f("-PROTO", "IpProtocol", "string", { required: true, enum: PROTOCOLS }),
  f("-FROM", "FromPort", "number"),
  f("-TO", "ToPort", "number"),
  f("-CIDR", "CidrIp", "string"),
  f(peer.name, peer.cfn, "ref"),
  f("-DESCR", "Description", "string"),
];

export const NETWORK: ResourceSpec[] = [
  {
    type: "AWS::EC2::VPC",
    tags: true,
    fields: [
      f("VPC-CIDR", "CidrBlock", "string", { required: true }),
      f("VPC-DNS-SUPPORT", "EnableDnsSupport", "bool"),
      f("VPC-DNS-HOSTNAMES", "EnableDnsHostnames", "bool"),
      f("VPC-TENANCY", "InstanceTenancy", "string", { enum: ["default", "dedicated"] }),
    ],
  },
  {
    type: "AWS::EC2::Subnet",
    tags: true,
    fields: [
      f("SUBNET-VPC", "VpcId", "ref", { required: true }),
      f("SUBNET-CIDR", "CidrBlock", "string", { required: true }),
      f("SUBNET-AZ", "AvailabilityZone", "string"),
      f("SUBNET-PUBLIC-IP", "MapPublicIpOnLaunch", "bool"),
    ],
  },
  { type: "AWS::EC2::InternetGateway", tags: true, fields: [] },
  {
    type: "AWS::EC2::VPCGatewayAttachment",
    fields: [f("GW-ATTACH-VPC", "VpcId", "ref", { required: true }), f("GW-ATTACH-IGW", "InternetGatewayId", "ref", { required: true })],
  },
  {
    type: "AWS::EC2::RouteTable",
    tags: true,
    fields: [f("RT-VPC", "VpcId", "ref", { required: true })],
  },
  {
    type: "AWS::EC2::Route",
    fields: [
      f("ROUTE-TABLE", "RouteTableId", "ref", { required: true }),
      f("ROUTE-DEST-CIDR", "DestinationCidrBlock", "string", { required: true }),
      f("ROUTE-IGW", "GatewayId", "ref"),
      f("ROUTE-NAT", "NatGatewayId", "ref"),
    ],
    post: (h) => {
      if (h.has("GatewayId") === h.has("NatGatewayId")) {
        h.fail("MISSING-PROPERTY", "ROUTE-IGW か ROUTE-NAT のどちらか 1 つだけを書いてください");
      }
    },
  },
  {
    type: "AWS::EC2::SubnetRouteTableAssociation",
    fields: [f("ASSOC-SUBNET", "SubnetId", "ref", { required: true }), f("ASSOC-ROUTE-TABLE", "RouteTableId", "ref", { required: true })],
  },
  {
    type: "AWS::EC2::EIP",
    tags: true,
    fields: [f("EIP-DOMAIN", "Domain", "string", { enum: ["vpc"], default: "vpc" })],
  },
  {
    type: "AWS::EC2::NatGateway",
    tags: true,
    fields: [f("NAT-EIP-ALLOC", "AllocationId", "ref", { required: true }), f("NAT-SUBNET", "SubnetId", "ref", { required: true })],
  },
  {
    type: "AWS::EC2::SecurityGroup",
    tags: true,
    fields: [f("SG-DESCRIPTION", "GroupDescription", "string", { required: true }), f("SG-VPC", "VpcId", "ref")],
    lists: [
      { group: "-INGRESS", cfn: "SecurityGroupIngress", fields: ruleFields({ name: "-SRC-SG", cfn: "SourceSecurityGroupId" }) },
      { group: "-EGRESS", cfn: "SecurityGroupEgress", fields: ruleFields({ name: "-DEST-SG", cfn: "DestinationSecurityGroupId" }) },
    ],
    post: (h) => {
      // 世界中に開いた管理ポートは、書いた本人に必ず知らせる
      const ingress = h.get("SecurityGroupIngress");
      if (!Array.isArray(ingress)) return;
      for (const rule of ingress as Array<Record<string, unknown>>) {
        if (rule["CidrIp"] !== "0.0.0.0/0") continue;
        const from = Number(rule["FromPort"]);
        const to = Number(rule["ToPort"]);
        for (const [port, name] of [[22, "SSH"], [3389, "RDP"], [3306, "MySQL"], [5432, "PostgreSQL"]] as const) {
          if (rule["IpProtocol"] === "-1" || (from <= port && port <= to)) {
            h.warn("OPEN-TO-THE-WORLD", `${name}（${port}）が 0.0.0.0/0 に開いています。呪われたワイルドカードです`);
          }
        }
      }
    },
  },
  {
    type: "AWS::EC2::SecurityGroupIngress",
    fields: [
      f("SGI-GROUP", "GroupId", "ref", { required: true }),
      f("SGI-PROTO", "IpProtocol", "string", { required: true, enum: PROTOCOLS }),
      f("SGI-FROM", "FromPort", "number"),
      f("SGI-TO", "ToPort", "number"),
      f("SGI-CIDR", "CidrIp", "string"),
      f("SGI-SRC-SG", "SourceSecurityGroupId", "ref"),
      f("SGI-DESCR", "Description", "string"),
    ],
  },
  {
    type: "AWS::EC2::SecurityGroupEgress",
    fields: [
      f("SGE-GROUP", "GroupId", "ref", { required: true }),
      f("SGE-PROTO", "IpProtocol", "string", { required: true, enum: PROTOCOLS }),
      f("SGE-FROM", "FromPort", "number"),
      f("SGE-TO", "ToPort", "number"),
      f("SGE-CIDR", "CidrIp", "string"),
      f("SGE-DEST-SG", "DestinationSecurityGroupId", "ref"),
      f("SGE-DESCR", "Description", "string"),
    ],
  },
  {
    type: "AWS::Route53::HostedZone",
    fields: [f("ZONE-NAME", "Name", "string", { required: true })],
  },
  {
    type: "AWS::Route53::RecordSet",
    fields: [
      f("RECORD-ZONE-ID", "HostedZoneId", "ref"),
      f("RECORD-ZONE-NAME", "HostedZoneName", "string"),
      f("RECORD-NAME", "Name", "string", { required: true }),
      f("RECORD-TYPE", "Type", "string", { required: true, enum: ["A", "AAAA", "CNAME", "TXT", "MX", "NS", "CAA", "SRV"] }),
      f("RECORD-TTL", "TTL", "numstr"),
      f("RECORD-VALUES", "ResourceRecords", "strings"),
      f("RECORD-ALIAS-ZONE", "AliasTarget.HostedZoneId", "ref"),
      f("RECORD-ALIAS-DNS", "AliasTarget.DNSName", "ref"),
    ],
    post: (h) => {
      if (h.has("HostedZoneId") === h.has("HostedZoneName")) {
        h.fail("MISSING-PROPERTY", "RECORD-ZONE-ID か RECORD-ZONE-NAME のどちらか 1 つだけを書いてください");
      }
      const alias = h.has("AliasTarget.DNSName");
      if (alias === h.has("ResourceRecords")) {
        h.fail("MISSING-PROPERTY", "RECORD-ALIAS-* か RECORD-VALUES のどちらか 1 つだけを書いてください");
      }
      if (alias && !h.has("AliasTarget.HostedZoneId")) h.fail("MISSING-PROPERTY", "RECORD-ALIAS-DNS には RECORD-ALIAS-ZONE も必要です");
      if (!alias && !h.has("TTL")) h.fail("MISSING-PROPERTY", "エイリアスでないレコードには RECORD-TTL が必要です");
    },
  },
  {
    type: "AWS::CertificateManager::Certificate",
    tags: true,
    fields: [
      f("CERT-DOMAIN", "DomainName", "string", { required: true }),
      f("CERT-ALT-NAMES", "SubjectAlternativeNames", "strings"),
      f("CERT-VALIDATION", "ValidationMethod", "string", { enum: ["DNS", "EMAIL"], default: "DNS" }),
      f("CERT-ZONE", "DomainValidationOptions.0.HostedZoneId", "ref"),
    ],
    post: (h) => {
      // ホストゾーンを渡したら、DNS 検証は CloudFormation が自動で行う
      if (h.has("DomainValidationOptions.0.HostedZoneId")) {
        h.set("DomainValidationOptions.0.DomainName", h.get("DomainName") as never);
      }
    },
  },
  {
    type: "AWS::CloudFront::Distribution",
    tags: true,
    fields: [
      f("CDN-ENABLED", "DistributionConfig.Enabled", "bool", { default: true }),
      f("CDN-ALIASES", "DistributionConfig.Aliases", "strings"),
      f("CDN-ROOT-OBJECT", "DistributionConfig.DefaultRootObject", "string"),
      f("CDN-PRICE-CLASS", "DistributionConfig.PriceClass", "string", { enum: ["PriceClass_100", "PriceClass_200", "PriceClass_All"] }),
      f("CDN-HTTP-VERSION", "DistributionConfig.HttpVersion", "string", { enum: ["http1.1", "http2", "http2and3", "http3"] }),
      f("CDN-ORIGIN-DOMAIN", "DistributionConfig.Origins.0.DomainName", "ref", { required: true }),
      f("CDN-ORIGIN-PROTOCOL", "DistributionConfig.Origins.0.CustomOriginConfig.OriginProtocolPolicy", "string", {
        enum: ["http-only", "https-only", "match-viewer"],
        default: "https-only",
      }),
      f("CDN-VIEWER-PROTOCOL", "DistributionConfig.DefaultCacheBehavior.ViewerProtocolPolicy", "string", {
        enum: ["allow-all", "https-only", "redirect-to-https"],
        default: "redirect-to-https",
      }),
      f("CDN-CACHE", "DistributionConfig.DefaultCacheBehavior.CachePolicyId", "string", {
        default: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
        map: {
          "caching-disabled": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
          "caching-optimized": "658327ea-f89d-4fab-a63d-7e88639e58f6",
        },
      }),
      f("CDN-CERT", "DistributionConfig.ViewerCertificate.AcmCertificateArn", "ref"),
    ],
    post: (h) => {
      // オリジンの Id は 1 つなので、ビヘイビアの向き先と必ず同じにする
      h.set("DistributionConfig.Origins.0.Id", "origin-1");
      h.set("DistributionConfig.DefaultCacheBehavior.TargetOriginId", "origin-1");

      if (h.has("DistributionConfig.ViewerCertificate.AcmCertificateArn")) {
        h.set("DistributionConfig.ViewerCertificate.SslSupportMethod", "sni-only");
        h.set("DistributionConfig.ViewerCertificate.MinimumProtocolVersion", "TLSv1.2_2021");
        // CloudFront の証明書は us-east-1 の ACM にしか置けない。違うリージョンのスタックでは作れない
        if (h.region !== undefined && h.region !== "us-east-1") {
          h.fail("CLOUDFRONT-CERT-REGION", `CloudFront の証明書は us-east-1 の ACM のみです。OBJECT-COMPUTER を AWS-US-EAST-1 にしてください（いまは ${h.region}）`);
        }
        if (!h.has("DistributionConfig.Aliases")) h.warn("CDN-NO-ALIAS", "証明書があるのに CDN-ALIASES がありません。独自ドメインで配信されません");
      } else {
        h.set("DistributionConfig.ViewerCertificate.CloudFrontDefaultCertificate", true);
      }
    },
  },
];
