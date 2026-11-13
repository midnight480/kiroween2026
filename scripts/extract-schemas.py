"""cfn-lint 同梱の公式 CloudFormation スキーマから、対象リソース型の「プロパティの地図」を抜き出す。

対応表（src/mapping）のプロパティ名・必須項目・列挙値を、AWS を動かさずにテストで突き合わせるための
スナップショットを tests/schemas/ に書く。スキーマの更新時だけ、次のコマンドで作り直す:

    uv run --with cfn-lint==1.60.0 python scripts/extract-schemas.py

出力形式（1 型 1 ファイル）:
    {
      "type": "AWS::EC2::Instance",
      "source": "cfn-lint 1.60.0 / ap-northeast-1",
      "required": {"": ["..."], "Path.To.Object": ["..."]},   # オブジェクトごとの必須プロパティ
      "paths": {"MetadataOptions.HttpTokens": {"type": "string", "enum": ["optional", "required"]}}
    }
配列の要素は `*` で表す（例: `SecurityGroupIngress.*.IpProtocol`）。
"""

import json
import os
import sys
from importlib.metadata import version

import cfnlint

REGION = "ap-northeast-1"
MAX_DEPTH = 7

TYPES = [
    # 既存の MVP
    "AWS::S3::Bucket",
    "AWS::IAM::Role",
    "AWS::IAM::ManagedPolicy",
    "AWS::Lambda::Function",
    "AWS::DynamoDB::Table",
    "AWS::DynamoDB::GlobalTable",
    # Network
    "AWS::EC2::VPC",
    "AWS::EC2::Subnet",
    "AWS::EC2::InternetGateway",
    "AWS::EC2::VPCGatewayAttachment",
    "AWS::EC2::RouteTable",
    "AWS::EC2::Route",
    "AWS::EC2::SubnetRouteTableAssociation",
    "AWS::EC2::EIP",
    "AWS::EC2::NatGateway",
    "AWS::EC2::SecurityGroup",
    "AWS::EC2::SecurityGroupIngress",
    "AWS::EC2::SecurityGroupEgress",
    "AWS::Route53::HostedZone",
    "AWS::Route53::RecordSet",
    "AWS::CertificateManager::Certificate",
    "AWS::CloudFront::Distribution",
    # Compute
    "AWS::EC2::Instance",
    "AWS::IAM::InstanceProfile",
    "AWS::EC2::LaunchTemplate",
    "AWS::AutoScaling::AutoScalingGroup",
    "AWS::ElasticLoadBalancingV2::LoadBalancer",
    "AWS::ElasticLoadBalancingV2::TargetGroup",
    "AWS::ElasticLoadBalancingV2::Listener",
    "AWS::ElasticLoadBalancing::LoadBalancer",
    # Databases
    "AWS::RDS::DBSubnetGroup",
    "AWS::RDS::DBInstance",
    "AWS::RDS::DBCluster",
    "AWS::ElastiCache::SubnetGroup",
    "AWS::ElastiCache::ReplicationGroup",
    "AWS::ElastiCache::CacheCluster",
    # Containers
    "AWS::Logs::LogGroup",
    "AWS::ECS::Cluster",
    "AWS::ECS::TaskDefinition",
    "AWS::ECS::Service",
    "AWS::EKS::Cluster",
    "AWS::EKS::Nodegroup",
    # Messaging
    "AWS::SQS::Queue",
    "AWS::SQS::QueuePolicy",
    "AWS::SNS::Topic",
    "AWS::SNS::Subscription",
]


def resolve(schema, node):
    """$ref を辿って、実体のノードを返す。"""
    seen = 0
    while isinstance(node, dict) and "$ref" in node and seen < 20:
        ref = node["$ref"]
        if not ref.startswith("#/"):
            return {}
        cur = schema
        for part in ref[2:].split("/"):
            cur = cur[part]
        node = {**cur, **{k: v for k, v in node.items() if k != "$ref"}}
        seen += 1
    return node


def scalar_type(node):
    t = node.get("type")
    if isinstance(t, list):
        t = t[0] if t else None
    return t


def walk(schema, node, path, depth, paths, required):
    node = resolve(schema, node)
    if not isinstance(node, dict) or depth > MAX_DEPTH:
        return
    t = scalar_type(node)
    entry = {"type": t or "object"}
    if "enum" in node:
        entry["enum"] = node["enum"]
    if path:
        paths[path] = entry
    props = node.get("properties")
    if props:
        required[path] = sorted(node.get("required", []))
        for name, child in props.items():
            walk(schema, child, f"{path}.{name}" if path else name, depth + 1, paths, required)
    items = node.get("items")
    if t == "array" and items:
        walk(schema, items, f"{path}.*", depth + 1, paths, required)


def main():
    base = os.path.join(os.path.dirname(cfnlint.__file__), "data", "schemas")
    with open(os.path.join(base, "providers", f"{REGION}.json")) as f:
        providers = json.load(f)

    out_dir = os.path.join(os.path.dirname(__file__), "..", "tests", "schemas")
    os.makedirs(out_dir, exist_ok=True)

    missing = []
    for t in TYPES:
        key = providers.get(t)
        if key is None:
            missing.append(t)
            continue
        with open(os.path.join(base, "resources", f"{key}.json")) as f:
            schema = json.load(f)
        paths, required = {}, {}
        root = {"type": "object", "properties": schema["properties"], "required": schema.get("required", [])}
        walk(schema, root, "", 0, paths, required)
        doc = {
            "type": t,
            "source": f"cfn-lint {version('cfn-lint')} / {REGION}",
            "required": required,
            "paths": dict(sorted(paths.items())),
        }
        name = t.replace("::", "_") + ".json"
        with open(os.path.join(out_dir, name), "w") as f:
            json.dump(doc, f, indent=1, ensure_ascii=False, sort_keys=False)
            f.write("\n")

    if missing:
        print("スキーマが見つからない型:", ", ".join(missing), file=sys.stderr)
        sys.exit(1)
    print(f"{len(TYPES)} 型を tests/schemas/ に書き出しました")


main()
