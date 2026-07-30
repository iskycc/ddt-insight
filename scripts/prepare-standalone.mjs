import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const standaloneRoot = path.join(projectRoot, ".next", "standalone");
const staticSource = path.join(projectRoot, ".next", "static");
const staticDestination = path.join(standaloneRoot, ".next", "static");
const publicSource = path.join(projectRoot, "public");
const publicDestination = path.join(standaloneRoot, "public");

if (!existsSync(path.join(standaloneRoot, "server.js")) || !existsSync(staticSource)) {
  throw new Error("没有找到完整生产构建，请先执行 npm run build");
}

mkdirSync(path.dirname(staticDestination), { recursive: true });
rmSync(staticDestination, { recursive: true, force: true });
cpSync(staticSource, staticDestination, { recursive: true });

rmSync(publicDestination, { recursive: true, force: true });
cpSync(publicSource, publicDestination, { recursive: true });
