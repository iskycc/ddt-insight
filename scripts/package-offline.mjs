import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const standaloneSource = path.join(projectRoot, ".next", "standalone");
const releaseRoot = path.join(projectRoot, "release");
const releaseDirectory = path.join(releaseRoot, "ddt-insight-offline");

if (!existsSync(standaloneSource)) {
  throw new Error("没有找到生产构建，请先执行 npm run build");
}

rmSync(releaseDirectory, { recursive: true, force: true });
mkdirSync(releaseDirectory, { recursive: true });
cpSync(standaloneSource, releaseDirectory, { recursive: true });

mkdirSync(path.join(releaseDirectory, ".next"), { recursive: true });
cpSync(
  path.join(projectRoot, ".next", "static"),
  path.join(releaseDirectory, ".next", "static"),
  { recursive: true },
);
cpSync(
  path.join(projectRoot, "public"),
  path.join(releaseDirectory, "public"),
  { recursive: true },
);
rmSync(path.join(releaseDirectory, "data"), {
  recursive: true,
  force: true,
});
mkdirSync(path.join(releaseDirectory, "data"), { recursive: true });

writeFileSync(
  path.join(releaseDirectory, "start.sh"),
  `#!/usr/bin/env sh
set -eu
HOSTNAME="\${HOSTNAME:-0.0.0.0}" PORT="\${PORT:-3000}" node server.js
`,
  { mode: 0o755 },
);

writeFileSync(
  path.join(releaseDirectory, "start.cmd"),
  `@echo off\r
if "%HOSTNAME%"=="" set HOSTNAME=0.0.0.0\r
if "%PORT%"=="" set PORT=3000\r
node server.js\r
`,
);

writeFileSync(
  path.join(releaseDirectory, ".env.example"),
  `ADMIN_USERNAME=admin
ADMIN_PASSWORD=insight-admin
COOKIE_SECURE=false
`,
);

console.log(`离线运行包已生成：${releaseDirectory}`);
