import { f } from "./network.js";
import type { Hook, ResourceSpec } from "./spec.js";

/**
 * マスターパスワードの扱い（Security by default）。
 * 平文は書かせない。ユーザー名があって、パスワードも管理指定も無いときは、
 * RDS が Secrets Manager で管理する（ManageMasterUserPassword）ようにする。
 */
function passwordPolicy(h: Hook, passwordPath: string, managedPath: string, userPath: string): void {
  if (h.has(passwordPath) && h.get(managedPath) === true) {
    h.fail("INVALID-VALUE", "パスワードを書いたまま、マスターパスワードの管理（MANAGED-PASSWORD）も有効にはできません");
  }
  if (h.has(userPath) && !h.has(passwordPath) && !h.has(managedPath)) h.set(managedPath, true);
}

export const DATABASE: ResourceSpec[] = [
  {
    type: "AWS::RDS::DBSubnetGroup",
    tags: true,
    fields: [
      f("DBSN-DESCRIPTION", "DBSubnetGroupDescription", "string", { required: true }),
      f("DBSN-SUBNETS", "SubnetIds", "strings", { required: true }),
    ],
  },
  {
    type: "AWS::RDS::DBInstance",
    tags: true,
    fields: [
      f("DB-CLASS", "DBInstanceClass", "string", { required: true }),
      f("DB-ENGINE", "Engine", "string"),
      f("DB-ENGINE-VERSION", "EngineVersion", "string"),
      f("DB-STORAGE-GB", "AllocatedStorage", "numstr"),
      f("DB-STORAGE-TYPE", "StorageType", "string", { enum: ["gp2", "gp3", "io1", "io2", "standard"] }),
      f("DB-USER", "MasterUsername", "string"),
      f("DB-PASSWORD", "MasterUserPassword", "secret"),
      f("DB-MANAGED-PASSWORD", "ManageMasterUserPassword", "bool"),
      f("DB-NAME", "DBName", "string"),
      f("DB-SUBNET-GROUP", "DBSubnetGroupName", "ref"),
      f("DB-SG", "VPCSecurityGroups", "strings"),
      f("DB-MULTI-AZ", "MultiAZ", "bool"),
      f("DB-CLUSTER", "DBClusterIdentifier", "ref"),
      f("DB-BACKUP-DAYS", "BackupRetentionPeriod", "number"),
      f("DB-DELETE-PROTECT", "DeletionProtection", "bool"),
      // Security by default: 暗号化あり、インターネットには公開しない
      f("DB-ENCRYPTED", "StorageEncrypted", "bool", { default: true }),
      f("DB-PUBLIC", "PubliclyAccessible", "bool", { default: false }),
    ],
    post: (h) => {
      passwordPolicy(h, "MasterUserPassword", "ManageMasterUserPassword", "MasterUsername");
      if (h.get("PubliclyAccessible") === true) h.warn("DB-PUBLIC", "データベースがインターネットに公開されています（PubliclyAccessible）");
      if (h.get("StorageEncrypted") === false) h.warn("DB-UNENCRYPTED", "ストレージが暗号化されていません");
    },
  },
  {
    // Aurora のクラスター。インスタンスは AWS::RDS::DBInstance に DB-CLUSTER を付けて書く
    type: "AWS::RDS::DBCluster",
    tags: true,
    fields: [
      f("CLUSTER-ENGINE", "Engine", "string", { required: true }),
      f("CLUSTER-ENGINE-VERSION", "EngineVersion", "string"),
      f("CLUSTER-USER", "MasterUsername", "string"),
      f("CLUSTER-PASSWORD", "MasterUserPassword", "secret"),
      f("CLUSTER-MANAGED-PASSWORD", "ManageMasterUserPassword", "bool"),
      f("CLUSTER-DB-NAME", "DatabaseName", "string"),
      f("CLUSTER-SUBNET-GROUP", "DBSubnetGroupName", "ref"),
      f("CLUSTER-SG", "VpcSecurityGroupIds", "strings"),
      f("CLUSTER-BACKUP-DAYS", "BackupRetentionPeriod", "number"),
      f("CLUSTER-DELETE-PROTECT", "DeletionProtection", "bool"),
      f("CLUSTER-ENCRYPTED", "StorageEncrypted", "bool", { default: true }),
    ],
    post: (h) => {
      passwordPolicy(h, "MasterUserPassword", "ManageMasterUserPassword", "MasterUsername");
      if (h.get("StorageEncrypted") === false) h.warn("DB-UNENCRYPTED", "ストレージが暗号化されていません");
    },
  },
  {
    type: "AWS::ElastiCache::SubnetGroup",
    fields: [
      f("CSN-DESCRIPTION", "Description", "string", { required: true }),
      f("CSN-SUBNETS", "SubnetIds", "strings", { required: true }),
    ],
  },
  {
    // Redis / Valkey のレプリケーショングループ（プライマリ + レプリカ）
    type: "AWS::ElastiCache::ReplicationGroup",
    tags: true,
    fields: [
      f("CACHE-DESCRIPTION", "ReplicationGroupDescription", "string", { required: true }),
      f("CACHE-ENGINE", "Engine", "string", { enum: ["redis", "valkey"] }),
      f("CACHE-ENGINE-VERSION", "EngineVersion", "string"),
      f("CACHE-NODE-TYPE", "CacheNodeType", "string", { required: true }),
      f("CACHE-NODES", "NumCacheClusters", "number"),
      f("CACHE-FAILOVER", "AutomaticFailoverEnabled", "bool"),
      f("CACHE-MULTI-AZ", "MultiAZEnabled", "bool"),
      f("CACHE-SUBNET-GROUP", "CacheSubnetGroupName", "ref"),
      f("CACHE-SG", "SecurityGroupIds", "strings"),
      f("CACHE-PORT", "Port", "number"),
      // Security by default: 保管時と転送時の暗号化
      f("CACHE-AT-REST", "AtRestEncryptionEnabled", "bool", { default: true }),
      f("CACHE-IN-TRANSIT", "TransitEncryptionEnabled", "bool", { default: true }),
    ],
    post: (h) => {
      if (h.get("AtRestEncryptionEnabled") === false) h.warn("CACHE-UNENCRYPTED", "保管時の暗号化が無効です（CACHE-AT-REST）");
      if (h.get("TransitEncryptionEnabled") === false) h.warn("CACHE-UNENCRYPTED", "転送時の暗号化が無効です（CACHE-IN-TRANSIT）");
      const nodes = h.get("NumCacheClusters");
      if ((h.get("AutomaticFailoverEnabled") === true || h.get("MultiAZEnabled") === true) && typeof nodes === "number" && nodes < 2) {
        h.fail("INVALID-VALUE", "フェイルオーバーと Multi-AZ には、CACHE-NODES が 2 以上必要です");
      }
    },
  },
  {
    // Memcached、または単一ノードの Redis
    type: "AWS::ElastiCache::CacheCluster",
    tags: true,
    fields: [
      f("CCL-ENGINE", "Engine", "string", { required: true, enum: ["memcached", "redis", "valkey"] }),
      f("CCL-ENGINE-VERSION", "EngineVersion", "string"),
      f("CCL-NODE-TYPE", "CacheNodeType", "string", { required: true }),
      f("CCL-NODES", "NumCacheNodes", "number", { required: true }),
      f("CCL-SUBNET-GROUP", "CacheSubnetGroupName", "ref"),
      f("CCL-SG", "VpcSecurityGroupIds", "strings"),
      f("CCL-PORT", "Port", "number"),
    ],
  },
];
