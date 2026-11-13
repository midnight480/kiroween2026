"""containers / eks / messaging / cache のサンプルを examples/ に書き出す。

    python3 scripts/gen-examples.py

出力は本物の固定形式 COBOL なので、手で直してもよい。ここは長い文字列リテラルの継続行
（72 桁で折る）を間違えずに書くための道具。three-tier / edge / classic は手で保守している。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from cobgen import Prog  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "examples")


def vpc_block(p, prefix, cidr, subnets, public=True):
    """VPC 一式（IGW、ルート、サブネット）。subnets は (記号, AZ, CIDR)。"""
    p.res(f"{prefix}-VPC", "AWS::EC2::VPC", [("VPC-CIDR", cidr), ("VPC-DNS-SUPPORT", "Y"), ("VPC-DNS-HOSTNAMES", "Y")])
    if public:
        p.res(f"{prefix}-IGW", "AWS::EC2::InternetGateway", [])
        p.res(f"{prefix}-ATTACH", "AWS::EC2::VPCGatewayAttachment", [("GW-ATTACH-VPC", f"REF:{prefix}-VPC"), ("GW-ATTACH-IGW", f"REF:{prefix}-IGW")])
        p.res(f"{prefix}-RT", "AWS::EC2::RouteTable", [("RT-VPC", f"REF:{prefix}-VPC")])
        p.res(
            f"{prefix}-ROUTE",
            "AWS::EC2::Route",
            [("ROUTE-TABLE", f"REF:{prefix}-RT"), ("ROUTE-DEST-CIDR", "0.0.0.0/0"), ("ROUTE-IGW", f"REF:{prefix}-IGW"), ("DEPENDS-ON", f"{prefix}-ATTACH")],
        )
    for z, az, c in subnets:
        rows = [("SUBNET-VPC", f"REF:{prefix}-VPC"), ("SUBNET-CIDR", c), ("SUBNET-AZ", az)]
        if public:
            rows.append(("SUBNET-PUBLIC-IP", "Y"))
        p.res(f"{prefix}-SUBNET-{z}", "AWS::EC2::Subnet", rows)
        if public:
            p.res(f"{prefix}-ASSOC-{z}", "AWS::EC2::SubnetRouteTableAssociation", [("ASSOC-SUBNET", f"REF:{prefix}-SUBNET-{z}"), ("ASSOC-ROUTE-TABLE", f"REF:{prefix}-RT")])


def sg_ingress(p, name, description, vpc, group, prefix, size=1):
    """入口ルールの表を持つセキュリティグループ。値は MOVE で入れる。"""
    p.A(f"01  {name}.")
    p.lit("    05  RESOURCE-TYPE    PIC X(23) VALUE ", "AWS::EC2::SecurityGroup")
    p.lit("    05  " + f"{'SG-DESCRIPTION':<20} PIC X({len(description)}) VALUE ", description)
    p.lit("    05  " + f"{'SG-VPC':<20} PIC X({len(vpc)}) VALUE ", vpc)
    p.table((group, size), [(f"{prefix}-PROTO", "X(4)"), (f"{prefix}-FROM", "9(5)"), (f"{prefix}-TO", "9(5)"), (f"{prefix}-CIDR", "X(18)")])


def messaging():
    p = Prog()
    p.head("ORDER-EVENTS", "AP-NORTHEAST-1")
    p.res("ORDERS-DLQ", "AWS::SQS::Queue", [("QUEUE-NAME", "cobolform-orders-dlq"), ("QUEUE-RETENTION-SEC", 1209600)])
    p.res(
        "ORDERS-QUEUE",
        "AWS::SQS::Queue",
        [("QUEUE-NAME", "cobolform-orders"), ("QUEUE-VISIBILITY-SEC", 60), ("QUEUE-DLQ", "GETATT:ORDERS-DLQ.ARN"), ("QUEUE-MAX-RECEIVES", 3)],
    )
    p.res("ORDERS-TOPIC", "AWS::SNS::Topic", [("TOPIC-NAME", "cobolform-orders-events"), ("TOPIC-DISPLAY", "Order events")])
    p.res(
        "ORDERS-POLICY",
        "AWS::SQS::QueuePolicy",
        [("QPOL-QUEUES", "REF:ORDERS-QUEUE"), ("QPOL-QUEUE-ARN", "GETATT:ORDERS-QUEUE.ARN"), ("QPOL-SNS-TOPIC", "REF:ORDERS-TOPIC")],
    )
    p.res(
        "ORDERS-SUBSCRIPTION",
        "AWS::SNS::Subscription",
        [("SUB-TOPIC", "REF:ORDERS-TOPIC"), ("SUB-PROTOCOL", "sqs"), ("SUB-ENDPOINT", "GETATT:ORDERS-QUEUE.ARN"), ("SUB-RAW", "Y"), ("DEPENDS-ON", "ORDERS-POLICY")],
    )
    p.tail()
    p.save(os.path.join(OUT, "messaging.cbl"))


def containers():
    p = Prog()
    p.head("FARGATE-APP", "AP-NORTHEAST-1")
    vpc_block(p, "APP", "10.1.0.0/16", [("A", "ap-northeast-1a", "10.1.1.0/24")])
    sg_ingress(p, "APP-SECURITY-GROUP", "Web from anywhere", "REF:APP-VPC", "APP-INGRESS", "APP-ING")
    p.res(
        "APP-EXEC-ROLE",
        "AWS::IAM::Role",
        [("TRUST-SERVICE", "ecs-tasks.amazonaws.com"), ("MANAGED-POLICY", "AWS-MANAGED:service-role/AmazonECSTaskExecutionRolePolicy")],
    )
    p.res("APP-LOGS", "AWS::Logs::LogGroup", [("LOG-NAME", "/cobolform/app"), ("LOG-RETENTION-DAYS", 7)])
    p.res("APP-CLUSTER", "AWS::ECS::Cluster", [("ECS-CLUSTER-NAME", "cobolform")])
    p.A("01  APP-TASK.")
    p.lit("    05  RESOURCE-TYPE    PIC X(%d) VALUE " % len("AWS::ECS::TaskDefinition"), "AWS::ECS::TaskDefinition")
    for n, v in [
        ("TD-FAMILY", "cobolform-app"),
        ("TD-EXEC-ROLE", "GETATT:APP-EXEC-ROLE.ARN"),
        ("TD-CONTAINER-NAME", "web"),
        ("TD-IMAGE", "public.ecr.aws/nginx/nginx:stable"),
        ("TD-LOG-GROUP", "REF:APP-LOGS"),
    ]:
        p.lit(f"    05  {n:<20} PIC X({len(v)}) VALUE ", v)
    for n, v in [("TD-CPU", 256), ("TD-MEMORY", 512), ("TD-PORT", 80)]:
        p.B(f"05  {n:<20} PIC 9({len(str(v))}) VALUE {v}.")
    p.table(("APP-ENV", 1), [("APP-ENV-KEY", "X(20)"), ("APP-ENV-VAL", "X(30)")])
    p.res(
        "APP-SERVICE",
        "AWS::ECS::Service",
        [("SVC-CLUSTER", "REF:APP-CLUSTER"), ("SVC-TASK", "REF:APP-TASK"), ("SVC-COUNT", 1), ("SVC-SUBNETS", "REF:APP-SUBNET-A"), ("SVC-SG", "REF:APP-SECURITY-GROUP"), ("SVC-PUBLIC-IP", "ENABLED")],
    )
    p.tail(
        [
            ("tcp", "APP-ING-PROTO (1)"),
            (80, "APP-ING-FROM (1)"),
            (80, "APP-ING-TO (1)"),
            ("0.0.0.0/0", "APP-ING-CIDR (1)"),
            ("GREETING", "APP-ENV-KEY (1)"),
            ("hello from COBOL", "APP-ENV-VAL (1)"),
        ]
    )
    p.save(os.path.join(OUT, "containers.cbl"))


def eks():
    p = Prog()
    p.head("KUBE-COBOL", "AP-NORTHEAST-1")
    vpc_block(p, "KUBE", "10.2.0.0/16", [("A", "ap-northeast-1a", "10.2.1.0/24"), ("C", "ap-northeast-1c", "10.2.2.0/24")])
    p.res("CONTROL-ROLE", "AWS::IAM::Role", [("TRUST-SERVICE", "eks.amazonaws.com"), ("MANAGED-POLICY", "AWS-MANAGED:AmazonEKSClusterPolicy")])
    p.res(
        "WORKER-ROLE",
        "AWS::IAM::Role",
        [
            ("TRUST-SERVICE", "ec2.amazonaws.com"),
            ("MANAGED-POLICY", "AWS-MANAGED:AmazonEKSWorkerNodePolicy,AWS-MANAGED:AmazonEKS_CNI_Policy,AWS-MANAGED:AmazonEC2ContainerRegistryReadOnly"),
        ],
    )
    p.res(
        "MAIN-CLUSTER",
        "AWS::EKS::Cluster",
        [("EKS-NAME", "cobolform"), ("EKS-VERSION", "1.37"), ("EKS-ROLE", "GETATT:CONTROL-ROLE.ARN"), ("EKS-SUBNETS", "REF:KUBE-SUBNET-A,REF:KUBE-SUBNET-C")],
    )
    p.res(
        "WORKER-NODES",
        "AWS::EKS::Nodegroup",
        [
            ("NG-CLUSTER", "REF:MAIN-CLUSTER"),
            ("NG-ROLE", "GETATT:WORKER-ROLE.ARN"),
            ("NG-SUBNETS", "REF:KUBE-SUBNET-A,REF:KUBE-SUBNET-C"),
            ("NG-INSTANCE-TYPES", "t3.small"),
            ("NG-AMI-TYPE", "AL2023_x86_64_STANDARD"),
            ("NG-MIN", 1),
            ("NG-MAX", 2),
            ("NG-DESIRED", 1),
            ("NG-DISK-GB", 20),
        ],
    )
    p.tail()
    p.save(os.path.join(OUT, "eks.cbl"))


def cache():
    p = Prog()
    p.head("HOT-CACHE", "AP-NORTHEAST-1")
    vpc_block(p, "CACHE", "10.3.0.0/16", [("A", "ap-northeast-1a", "10.3.1.0/24"), ("C", "ap-northeast-1c", "10.3.2.0/24")], public=False)
    sg_ingress(p, "CACHE-SECURITY-GROUP", "Redis from inside the VPC", "REF:CACHE-VPC", "CSG-INGRESS", "CSG-ING")
    p.res("CACHE-SUBNETS", "AWS::ElastiCache::SubnetGroup", [("CSN-DESCRIPTION", "Cache tier"), ("CSN-SUBNETS", "REF:CACHE-SUBNET-A,REF:CACHE-SUBNET-C")])
    p.res(
        "SESSION-CACHE",
        "AWS::ElastiCache::ReplicationGroup",
        [
            ("CACHE-DESCRIPTION", "Session store"),
            ("CACHE-ENGINE", "redis"),
            ("CACHE-ENGINE-VERSION", "7.1"),
            ("CACHE-NODE-TYPE", "cache.t4g.micro"),
            ("CACHE-NODES", 2),
            ("CACHE-FAILOVER", "Y"),
            ("CACHE-MULTI-AZ", "Y"),
            ("CACHE-SUBNET-GROUP", "REF:CACHE-SUBNETS"),
            ("CACHE-SG", "REF:CACHE-SECURITY-GROUP"),
        ],
    )
    p.tail(
        [
            ("tcp", "CSG-ING-PROTO (1)"),
            (6379, "CSG-ING-FROM (1)"),
            (6379, "CSG-ING-TO (1)"),
            ("10.3.0.0/16", "CSG-ING-CIDR (1)"),
        ]
    )
    p.save(os.path.join(OUT, "cache.cbl"))


for build in (messaging, containers, eks, cache):
    build()
print("examples/{messaging,containers,eks,cache}.cbl を書きました")
