# AGENTS.md

本文件供维护 DDT Insight 的自动化编码代理使用。所有变更必须遵守以下约束。

## 项目定位

DDT Insight 是完全离线运行的 Next.js 全栈用例数据管理平台：

- Next.js App Router 同时提供前端页面和 Route Handler 后端。
- SQLite 是唯一持久化数据库，默认位于 `data/ddt-insight.sqlite`。
- 表格中的 `CaseID` 是全局唯一索引，`srNum` 是用例分组字段。
- 不同表格可以拥有完全不同的动态列。

## 不可破坏的产品约束

1. 运行时不得依赖 CDN、远程字体、远程图片、远程脚本、云 API 或其他互联网资源。
2. 开放用例查询 API 不得增加登录或 Token 鉴权。
3. 管理接口必须继续要求管理员 Session。
4. 导入必须校验 `data` Sheet、`CaseID`、`srNum` 和文件内重复 CaseID。
5. CaseID 修改必须保持唯一性，并同步更新数据库主键和 JSON 内容。
6. 大型用例库不得一次性传输或渲染全部用例；继续使用索引检索和分页加载。
7. 不得将真实数据库、Session Secret、管理员密码或测试用例提交到仓库或镜像。
8. Docker 数据必须持久化到 `/app/data`。
9. `docker-compose.yml` 必须保持 Compose V1 可解析；不要加入只在新版 Compose Spec 中存在的字段。

## 关键目录

- `app/`：页面与 API Route Handlers。
- `components/`：公开大盘、登录和管理工作台组件。
- `lib/db.ts`：SQLite 初始化与性能参数。
- `lib/repository.ts`：索引查询、导入写入、编辑和统计逻辑。
- `lib/spreadsheet.ts`：表格解析与导出。
- `lib/auth.ts`：本地管理员 Session。
- `vendor/`：离线保留的 SheetJS 依赖包。
- `scripts/package-offline.mjs`：独立离线运行目录生成脚本。

## API 权限边界

无需鉴权：

- `GET /api/case?caseId=...`
- `GET /api/cases/[caseId]`
- `GET /api/stats`
- `GET /api/health`

需要管理员 Session：

- `GET /api/cases`
- `PATCH /api/cases/[caseId]`
- `GET /api/groups`
- `POST /api/import`
- `GET /api/export`

## 开发与验收命令

```bash
npm install
npm run typecheck
npm run build
npm audit --omit=dev
```

涉及 Docker 时还需要：

```bash
docker build -t iskycc/ddt-insight:local .
docker run --rm -p 3000:3000 -v "$(pwd)/data:/app/data" iskycc/ddt-insight:local
docker-compose config
docker compose config
```

## 变更验收清单

涉及数据链路的修改至少验证：

1. 批量导入两个不同列结构的文件。
2. CaseID 重复导入执行更新而非新增。
3. 普通字段、srNum、CaseID 均可编辑。
4. CaseID 冲突改名被拒绝。
5. 单用例、srNum 分组和全部导出可被表格工具重新读取。
6. 开放 API 返回直接 JSON Map，且未登录可访问。
7. 管理 API 未登录返回 401。
8. 空数据库时公开大盘和管理工作台正常显示。
9. 页面资源中不存在外部 HTTP 依赖。

## 风格与性能

- 保持现有 Apple-Like 视觉语言和响应式布局。
- 桌面端字段编辑按钮在悬浮字段卡片后显示；移动端必须保持常显。
- CaseID 使用前缀检索以命中 B-tree 索引。
- 避免在开放 API 热路径中执行全表扫描、统计聚合或文件解析。
- 批量数据库写入必须在事务内完成。
- 保持 SQLite WAL、busy timeout 和现有索引策略。
