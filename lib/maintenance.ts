import Database from "better-sqlite3";
import {
  appendFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  closeSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
} from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import packageJson from "@/package.json";
import {
  dataDirectory,
  databasePath,
  db,
  pendingRestoreMarkerPath,
  pendingRestorePath,
  pendingSecretPath,
} from "@/lib/db";
import { getApplicationSecret } from "@/lib/security";

const BACKUP_MAGIC = Buffer.from("DDTINSIGHTB1", "ascii");
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = BACKUP_MAGIC.length + SALT_LENGTH + IV_LENGTH;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_SECRET_BYTES = 16 * 1024;
const backupDirectory = path.join(
  /* turbopackIgnore: true */ dataDirectory,
  "backups",
);

mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });

type BackupManifest = {
  format: "ddt-insight-backup";
  formatVersion: 1;
  appVersion: string;
  createdAt: string;
  databaseBytes: number;
  databaseSha256: string;
  secretBytes: number;
  secretSha256: string;
};

export type MaintenanceBackupItem = {
  id: string;
  fileName: string;
  createdAt: string;
  createdBy: string;
  sizeBytes: number;
  databaseBytes: number;
  appVersion: string;
};

function backupPath(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("备份编号无效");
  return path.join(
    /* turbopackIgnore: true */ backupDirectory,
    `${id}.ddtbackup`,
  );
}

function backupMetadataPath(id: string) {
  return path.join(
    /* turbopackIgnore: true */ backupDirectory,
    `${id}.json`,
  );
}

function validatePassphrase(passphrase: string) {
  if (passphrase.length < 8) throw new Error("备份口令至少需要 8 个字符");
  if (passphrase.length > 256) throw new Error("备份口令不能超过 256 个字符");
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function deriveBackupKey(passphrase: string, salt: Buffer) {
  return scryptSync(passphrase, salt, 32, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

function encodePayloadPrefix(manifest: BackupManifest, secret: Buffer) {
  const manifestBuffer = Buffer.from(JSON.stringify(manifest), "utf8");
  const prefix = Buffer.allocUnsafe(
    4 + manifestBuffer.length + 4 + secret.length,
  );
  let offset = 0;
  prefix.writeUInt32BE(manifestBuffer.length, offset);
  offset += 4;
  manifestBuffer.copy(prefix, offset);
  offset += manifestBuffer.length;
  prefix.writeUInt32BE(secret.length, offset);
  offset += 4;
  secret.copy(prefix, offset);
  return prefix;
}

async function encryptBackupPackage(input: {
  sourceDatabasePath: string;
  destinationPath: string;
  passphrase: string;
  manifest: BackupManifest;
  secret: Buffer;
}) {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveBackupKey(input.passphrase, salt),
    iv,
  );
  const header = Buffer.concat([BACKUP_MAGIC, salt, iv]);
  writeFileSync(input.destinationPath, header, { mode: 0o600 });

  async function* payload() {
    yield encodePayloadPrefix(input.manifest, input.secret);
    for await (const chunk of createReadStream(input.sourceDatabasePath)) {
      yield chunk as Buffer;
    }
  }

  await pipeline(
    Readable.from(payload()),
    cipher,
    createWriteStream(input.destinationPath, { flags: "a", mode: 0o600 }),
  );
  appendFileSync(input.destinationPath, cipher.getAuthTag());
}

export async function createMaintenanceBackup(
  passphrase: string,
  createdBy: string,
) {
  validatePassphrase(passphrase);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const temporaryDatabase = path.join(
    /* turbopackIgnore: true */ backupDirectory,
    `.${id}.building.sqlite`,
  );
  const temporaryPackage = path.join(
    /* turbopackIgnore: true */ backupDirectory,
    `.${id}.building.ddtbackup`,
  );
  const destination = backupPath(id);

  try {
    await db.backup(temporaryDatabase);
    const databaseStat = statSync(temporaryDatabase);
    const secret = Buffer.from(getApplicationSecret(), "utf8");
    const manifest: BackupManifest = {
      format: "ddt-insight-backup",
      formatVersion: 1,
      appVersion: packageJson.version,
      createdAt,
      databaseBytes: databaseStat.size,
      databaseSha256: await sha256File(temporaryDatabase),
      secretBytes: secret.length,
      secretSha256: createHash("sha256").update(secret).digest("hex"),
    };
    await encryptBackupPackage({
      sourceDatabasePath: temporaryDatabase,
      destinationPath: temporaryPackage,
      passphrase,
      manifest,
      secret,
    });
    renameSync(temporaryPackage, destination);

    const item: MaintenanceBackupItem = {
      id,
      fileName: `ddt-insight-${createdAt.slice(0, 10)}-${id.slice(0, 8)}.ddtbackup`,
      createdAt,
      createdBy: createdBy.slice(0, 128),
      sizeBytes: statSync(destination).size,
      databaseBytes: databaseStat.size,
      appVersion: packageJson.version,
    };
    writeFileSync(backupMetadataPath(id), JSON.stringify(item), {
      mode: 0o600,
    });
    return item;
  } finally {
    if (existsSync(temporaryDatabase)) rmSync(temporaryDatabase);
    if (existsSync(temporaryPackage)) rmSync(temporaryPackage);
  }
}

export function listMaintenanceBackups() {
  const items: MaintenanceBackupItem[] = [];
  if (!existsSync(backupDirectory)) return items;

  for (const entry of readdirSync(backupDirectory)) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.slice(0, -5);
    try {
      const metadata = JSON.parse(
        readFileSync(backupMetadataPath(id), "utf8"),
      ) as MaintenanceBackupItem;
      const archive = backupPath(id);
      if (!existsSync(archive)) continue;
      items.push({ ...metadata, sizeBytes: statSync(archive).size });
    } catch {
      // Ignore incomplete sidecars left by interrupted writes.
    }
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getMaintenanceBackup(id: string) {
  const filePath = backupPath(id);
  const metadataPath = backupMetadataPath(id);
  if (!existsSync(filePath) || !existsSync(metadataPath)) return null;
  const metadata = JSON.parse(
    readFileSync(metadataPath, "utf8"),
  ) as MaintenanceBackupItem;
  return { filePath, metadata };
}

export function deleteMaintenanceBackup(id: string) {
  const backup = getMaintenanceBackup(id);
  if (!backup) return null;
  unlinkSync(backup.filePath);
  unlinkSync(backupMetadataPath(id));
  return backup.metadata;
}

function readBackupHeader(filePath: string) {
  const stats = statSync(filePath);
  if (stats.size <= HEADER_LENGTH + TAG_LENGTH + 8) {
    throw new Error("备份文件不完整");
  }
  const descriptor = openSync(filePath, "r");
  try {
    const header = Buffer.alloc(HEADER_LENGTH);
    const tag = Buffer.alloc(TAG_LENGTH);
    readSync(descriptor, header, 0, header.length, 0);
    readSync(
      descriptor,
      tag,
      0,
      tag.length,
      stats.size - TAG_LENGTH,
    );
    if (!header.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
      throw new Error("不是受支持的 DDT Insight 加密备份");
    }
    return {
      salt: header.subarray(
        BACKUP_MAGIC.length,
        BACKUP_MAGIC.length + SALT_LENGTH,
      ),
      iv: header.subarray(
        BACKUP_MAGIC.length + SALT_LENGTH,
        HEADER_LENGTH,
      ),
      tag,
      cipherEnd: stats.size - TAG_LENGTH - 1,
    };
  } finally {
    closeSync(descriptor);
  }
}

async function decryptBackupPackage(
  sourcePath: string,
  passphrase: string,
  destinationPath: string,
) {
  validatePassphrase(passphrase);
  const { salt, iv, tag, cipherEnd } = readBackupHeader(sourcePath);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveBackupKey(passphrase, salt),
    iv,
  );
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      createReadStream(sourcePath, {
        start: HEADER_LENGTH,
        end: cipherEnd,
      }),
      decipher,
      createWriteStream(destinationPath, { mode: 0o600 }),
    );
  } catch {
    throw new Error("备份口令错误，或备份文件已损坏");
  }
}

function readPayloadMetadata(payloadPath: string) {
  const descriptor = openSync(payloadPath, "r");
  try {
    const integer = Buffer.alloc(4);
    readSync(descriptor, integer, 0, 4, 0);
    const manifestLength = integer.readUInt32BE();
    if (!manifestLength || manifestLength > MAX_MANIFEST_BYTES) {
      throw new Error("备份清单长度无效");
    }
    const manifestBuffer = Buffer.alloc(manifestLength);
    readSync(descriptor, manifestBuffer, 0, manifestLength, 4);
    const secretLengthOffset = 4 + manifestLength;
    readSync(descriptor, integer, 0, 4, secretLengthOffset);
    const secretLength = integer.readUInt32BE();
    if (!secretLength || secretLength > MAX_SECRET_BYTES) {
      throw new Error("备份密钥长度无效");
    }
    const secret = Buffer.alloc(secretLength);
    const secretOffset = secretLengthOffset + 4;
    readSync(descriptor, secret, 0, secretLength, secretOffset);
    const manifest = JSON.parse(manifestBuffer.toString("utf8")) as BackupManifest;
    if (
      manifest.format !== "ddt-insight-backup" ||
      manifest.formatVersion !== 1 ||
      manifest.databaseBytes <= 0
    ) {
      throw new Error("备份格式版本不受支持");
    }
    if (
      createHash("sha256").update(secret).digest("hex") !==
      manifest.secretSha256
    ) {
      throw new Error("备份密钥校验失败");
    }
    const databaseOffset = secretOffset + secretLength;
    const payloadSize = statSync(payloadPath).size;
    if (payloadSize - databaseOffset !== manifest.databaseBytes) {
      throw new Error("备份数据库长度与清单不一致");
    }
    return { manifest, secret, databaseOffset };
  } finally {
    closeSync(descriptor);
  }
}

async function copyFileRange(
  sourcePath: string,
  start: number,
  destinationPath: string,
) {
  await pipeline(
    createReadStream(sourcePath, { start }),
    createWriteStream(destinationPath, { mode: 0o600 }),
  );
}

function validateRestoredDatabase(filePath: string) {
  const restored = new Database(filePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const integrityRows = restored.pragma("quick_check") as Array<{
      quick_check: string;
    }>;
    if (
      !integrityRows.length ||
      integrityRows.some((row) => row.quick_check !== "ok")
    ) {
      throw new Error("备份数据库完整性检查失败");
    }
    const requiredTables = [
      "cases",
      "source_files",
      "users",
      "ldap_config",
      "audit_logs",
      "case_history",
    ];
    const tables = new Set(
      (
        restored
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name),
    );
    const missing = requiredTables.filter((table) => !tables.has(table));
    if (missing.length) {
      throw new Error(`备份缺少必要数据表：${missing.join("、")}`);
    }
    const recoveryAdmin = restored
      .prepare(`
        SELECT 1
        FROM users
        WHERE provider = 'local' AND role = 'admin' AND enabled = 1
          AND password_hash LIKE 'scrypt:%'
        LIMIT 1
      `)
      .get();
    if (!recoveryAdmin) {
      throw new Error("备份中没有可用的本地管理员账户");
    }
    const unsafePassword = restored
      .prepare(`
        SELECT 1 FROM users
        WHERE password_hash IS NOT NULL
          AND password_hash != ''
          AND password_hash NOT LIKE 'scrypt:%'
        LIMIT 1
      `)
      .get();
    if (unsafePassword) {
      throw new Error("备份包含无法识别的密码数据，已拒绝恢复");
    }
    const unsafeLdapSecret = restored
      .prepare(`
        SELECT 1 FROM ldap_config
        WHERE bind_password_encrypted != ''
          AND bind_password_encrypted NOT LIKE 'v1:%'
        LIMIT 1
      `)
      .get();
    if (unsafeLdapSecret) {
      throw new Error("备份包含未加密或无法识别的 LDAP 密码");
    }
  } finally {
    restored.close();
  }
}

export async function stageMaintenanceRestore(input: {
  uploadPath: string;
  passphrase: string;
  actorUsername: string;
}) {
  if (existsSync(pendingRestoreMarkerPath)) {
    throw new Error("已有等待生效的恢复任务，请先重启服务");
  }
  const operationId = randomUUID();
  const payloadPath = path.join(
    /* turbopackIgnore: true */ dataDirectory,
    `.${operationId}.restore-payload`,
  );
  const extractedDatabasePath = path.join(
    /* turbopackIgnore: true */ dataDirectory,
    `.${operationId}.restore.sqlite`,
  );
  const stagedDatabasePath = `${pendingRestorePath}.building`;
  const stagedSecretPath = `${pendingSecretPath}.building`;

  try {
    await decryptBackupPackage(
      input.uploadPath,
      input.passphrase,
      payloadPath,
    );
    const { manifest, secret, databaseOffset } =
      readPayloadMetadata(payloadPath);
    if (
      process.env.SESSION_SECRET &&
      secret.toString("utf8") !== getApplicationSecret()
    ) {
      throw new Error(
        "当前 SESSION_SECRET 与备份不一致，请先使用备份对应的环境密钥再恢复",
      );
    }
    await copyFileRange(
      payloadPath,
      databaseOffset,
      extractedDatabasePath,
    );
    if ((await sha256File(extractedDatabasePath)) !== manifest.databaseSha256) {
      throw new Error("备份数据库哈希校验失败");
    }
    validateRestoredDatabase(extractedDatabasePath);

    // Generate an encrypted rollback point before staging the replacement.
    const safetyBackup = await createMaintenanceBackup(
      input.passphrase,
      `${input.actorUsername}（恢复前自动备份）`,
    );

    await pipeline(
      createReadStream(extractedDatabasePath),
      createWriteStream(stagedDatabasePath, { mode: 0o600 }),
    );
    writeFileSync(stagedSecretPath, secret, { mode: 0o600 });
    renameSync(stagedDatabasePath, pendingRestorePath);
    renameSync(stagedSecretPath, pendingSecretPath);
    const stagedAt = new Date().toISOString();
    writeFileSync(
      pendingRestoreMarkerPath,
      JSON.stringify({
        stagedAt,
        actorUsername: input.actorUsername.slice(0, 128),
        backupCreatedAt: manifest.createdAt,
        backupAppVersion: manifest.appVersion,
        databaseSha256: manifest.databaseSha256,
        secretSha256: manifest.secretSha256,
        safetyBackupId: safetyBackup.id,
      }),
      { mode: 0o600 },
    );

    return {
      stagedAt,
      restartRequired: true,
      backupCreatedAt: manifest.createdAt,
      backupAppVersion: manifest.appVersion,
      safetyBackup,
    };
  } finally {
    const temporaryFiles = [
      payloadPath,
      extractedDatabasePath,
      stagedDatabasePath,
      stagedSecretPath,
    ].flatMap((temporary) => [
      temporary,
      `${temporary}-wal`,
      `${temporary}-shm`,
    ]);
    for (const temporary of temporaryFiles) {
      if (existsSync(temporary)) rmSync(temporary);
    }
  }
}

export function cancelPendingRestore() {
  if (!existsSync(pendingRestoreMarkerPath)) return false;
  for (const pendingPath of [
    pendingRestorePath,
    pendingSecretPath,
    pendingRestoreMarkerPath,
  ]) {
    if (existsSync(pendingPath)) unlinkSync(pendingPath);
  }
  return true;
}

function fileSize(filePath: string) {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function tableSizes() {
  try {
    return db
      .prepare(`
        SELECT
          CASE
            WHEN name LIKE 'idx_%' THEN 'indexes'
            ELSE name
          END AS name,
          SUM(pgsize) AS bytes
        FROM dbstat
        GROUP BY CASE WHEN name LIKE 'idx_%' THEN 'indexes' ELSE name END
        ORDER BY bytes DESC
      `)
      .all() as Array<{ name: string; bytes: number }>;
  } catch {
    return [] as Array<{ name: string; bytes: number }>;
  }
}

export function getMaintenanceDiagnostics() {
  const pageSize = Number(db.pragma("page_size", { simple: true }));
  const pageCount = Number(db.pragma("page_count", { simple: true }));
  const freePages = Number(db.pragma("freelist_count", { simple: true }));
  const walRows = db.pragma("wal_checkpoint(PASSIVE)") as Array<{
    busy: number;
    log: number;
    checkpointed: number;
  }>;
  const quickCheck = db.pragma("quick_check") as Array<{
    quick_check: string;
  }>;
  const foreignKeyIssues = (
    db.pragma("foreign_key_check") as unknown[]
  ).length;
  const disk = statfsSync(dataDirectory);
  const backupBytes = listMaintenanceBackups().reduce(
    (total, item) => total + item.sizeBytes,
    0,
  );
  const counts = db
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM cases) AS cases,
        (SELECT COUNT(*) FROM case_history) AS history,
        (SELECT COUNT(*) FROM deleted_cases) AS recycle,
        (SELECT COUNT(*) FROM source_files) AS imports,
        (SELECT COUNT(*) FROM audit_logs) AS audit
    `)
    .get() as {
    cases: number;
    history: number;
    recycle: number;
    imports: number;
    audit: number;
  };
  const sqliteVersion = (
    db.prepare("SELECT sqlite_version() AS version").get() as {
      version: string;
    }
  ).version;
  const wal = walRows[0] ?? { busy: 0, log: 0, checkpointed: 0 };
  const integrityOk =
    quickCheck.length > 0 &&
    quickCheck.every((row) => row.quick_check === "ok") &&
    foreignKeyIssues === 0;

  let pendingRestore: Record<string, unknown> | null = null;
  if (existsSync(pendingRestoreMarkerPath)) {
    try {
      pendingRestore = JSON.parse(
        readFileSync(pendingRestoreMarkerPath, "utf8"),
      ) as Record<string, unknown>;
    } catch {
      pendingRestore = { invalid: true };
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    status: integrityOk && wal.busy === 0 ? "healthy" : "attention",
    runtime: {
      node: process.version,
      appVersion: packageJson.version,
      sqlite: sqliteVersion,
      uptimeSeconds: Math.floor(process.uptime()),
    },
    storage: {
      databaseBytes: fileSize(databasePath),
      walBytes: fileSize(`${databasePath}-wal`),
      shmBytes: fileSize(`${databasePath}-shm`),
      backupBytes,
      logicalBytes: pageCount * pageSize,
      reclaimableBytes: freePages * pageSize,
      diskTotalBytes: disk.blocks * disk.bsize,
      diskFreeBytes: disk.bavail * disk.bsize,
      pageSize,
      pageCount,
      freePages,
      tables: tableSizes(),
    },
    database: {
      journalMode: String(db.pragma("journal_mode", { simple: true })),
      foreignKeys: Boolean(db.pragma("foreign_keys", { simple: true })),
      quickCheck: quickCheck.map((row) => row.quick_check),
      foreignKeyIssues,
      wal,
    },
    counts,
    pendingRestore,
  };
}

export function checkpointDatabase() {
  const result = db.pragma("wal_checkpoint(TRUNCATE)") as Array<{
    busy: number;
    log: number;
    checkpointed: number;
  }>;
  return {
    ...(result[0] ?? { busy: 0, log: 0, checkpointed: 0 }),
    walBytes: fileSize(`${databasePath}-wal`),
    completedAt: new Date().toISOString(),
  };
}

export { backupDirectory };
