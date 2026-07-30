# AGENTS.md

本文件供维护 DDT Insight 的自动化编码代理使用。所有变更必须遵守以下约束。

## 项目定位

DDT Insight 是完全离线运行的 Next.js 全栈用例数据管理平台：

- Next.js App Router 同时提供前端页面和 Route Handler 后端。
- SQLite 是唯一持久化数据库，默认位于 `data/ddt-insight.sqlite`。
- 表格中的 `CaseID` 是全局唯一索引，`srNum` 是用例分组字段；用户旅程由 `step1` 至 `stepN` 各 Sheet 的对应行组成。
- 不同表格可以拥有完全不同的动态列。
- 本地用户、LDAP 配置、用例修改历史和审计日志与用例数据共用 SQLite 持久化。

## 不可破坏的产品约束

1. 运行时不得依赖 CDN、远程字体、远程图片、远程脚本、云 API 或其他互联网资源。
2. 开放用例查询 API 不得增加登录或 Token 鉴权。
3. 管理接口必须继续要求管理员 Session。
4. 导入必须校验普通 `data` Sheet，或大小写不敏感且从 `step1` 连续到 `stepN` 的用户旅程 Sheet；每个 Sheet 均校验 `CaseID`、`srNum`，用户旅程还必须校验各 Step 行数和对应行身份一致；ZIP 只读取根目录和一层子目录中的表格。
5. CaseID 修改必须保持唯一性，并同步更新数据库主键和 JSON 内容。
6. 大型用例库不得一次性传输或渲染全部用例；继续使用索引检索和分页加载。
7. 不得将真实数据库、Session Secret、管理员密码或测试用例提交到仓库或镜像。
8. Docker 数据必须持久化到 `/app/data`。
9. `docker-compose.yml` 必须保持 Compose V1 可解析；不要加入只在新版 Compose Spec 中存在的字段。
10. Release 工作流只允许构建、导出镜像并上传 GitHub Release；不得添加镜像仓库登录或 `docker push`。
11. Release 工作流必须同时保留 `linux/amd64` 和 `linux/arm64` 两种离线 Docker 镜像产物。
12. 本地管理员必须始终可用于 LDAP 故障恢复；不得在 API、日志或 UI 中返回 LDAP Bind 密码。
13. 只有 `admin` 角色可访问用户、LDAP 和审计管理；`editor` 角色只可管理用例。
14. 用例编辑和导入覆盖必须写入独立、永久、追加式的用例历史，不得将字段前后内容写入审计；用例删除必须写入审计。
15. 源码运行、独立离线目录和 Docker 镜像统一使用 Node.js 24.x LTS；不得降级到 Node.js 20。
16. 审计查询必须保持分页，并支持分类、操作、结果筛选以及人员、资源、操作、IP 和详情搜索。
17. LDAP 登录必须按配置同步显示名称、mail 和多值 Group 属性；目录 Group 只作为用户档案，不得自动提升平台角色。
18. 普通和批量删除必须先进入 `deleted_cases` 回收站；彻底删除不得级联删除永久用例历史。
19. 数据库恢复必须先校验加密认证、哈希、SQLite 完整性和本地恢复管理员，并在进程重启、SQLite 打开前生效；不得在线替换已打开的数据库文件。
20. 异步导入任务必须持久化状态、限制上传和解压大小、清理临时文件，并在真正写入前再次执行模板与冲突校验。

## 关键目录

- `app/`：页面与 API Route Handlers。
- `components/`：公开大盘、登录和管理工作台组件。
- `lib/db.ts`：SQLite 初始化与性能参数。
- `lib/repository.ts`：索引查询、导入写入、编辑和统计逻辑。
- `lib/case-history.ts`：用例前后快照、字段差异、操作者和游标分页历史。
- `lib/case-management.ts`：高级检索、批量修改、字段模板和校验。
- `lib/import-jobs.ts`：导入预检、冲突策略、持久化任务和来源追踪。
- `lib/maintenance.ts`：加密备份恢复、容量诊断和 WAL 维护。
- `lib/spreadsheet.ts`：表格解析与导出。
- `lib/auth.ts`：本地与 LDAP 登录、签名 Session。
- `lib/users.ts`：用户初始化、角色、状态与密码管理。
- `lib/ldap.ts`：LDAP 配置、连接测试与认证。
- `lib/audit.ts`：安全审计写入与分页查询。
- `lib/security.ts`：scrypt 密码摘要与 LDAP 密钥加密。
- `vendor/`：离线保留的 SheetJS 依赖包。
- `scripts/package-offline.mjs`：独立离线运行目录生成脚本。
- `.github/workflows/release-image.yml`：Docker 镜像离线包 Release 流水线。

## API 权限边界

无需鉴权：

- `GET /api/case?caseId=...`
- `GET /api/cases/[caseId]`
- `GET /api/stats`
- `GET /api/health`

需要已登录的管理员或编辑员：

- `GET /api/cases`
- `PATCH /api/cases/[caseId]`
- `DELETE /api/cases/[caseId]`
- `GET /api/cases/[caseId]/history`
- `POST /api/cases/[caseId]/history/[historyId]/restore`
- `GET/POST /api/cases/search`
- `POST /api/cases/bulk/update`
- `POST /api/cases/bulk/delete`
- `POST /api/cases/bulk/export`
- `GET/POST/PUT/DELETE /api/templates...`
- `POST /api/import/preview`
- `POST /api/import/jobs`
- `GET /api/import/jobs/[id]`
- `POST /api/import/jobs/[id]/cancel`
- `GET /api/groups`
- `POST /api/import`
- `GET /api/export`

仅 `admin` 角色：

- `GET/POST /api/admin/users`
- `PATCH/DELETE /api/admin/users/[id]`
- `GET/PUT /api/admin/ldap`
- `POST /api/admin/ldap/test`
- `GET /api/admin/audit`
- `GET /api/admin/imports`
- `GET /api/admin/maintenance`
- `GET/POST/DELETE /api/admin/maintenance/backups...`
- `POST/DELETE /api/admin/maintenance/restore`
- `POST /api/admin/maintenance/checkpoint`
- `GET/DELETE /api/admin/recycle...`
- `POST /api/admin/recycle/[id]/restore`

## 开发与验收命令

```bash
nvm use
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
10. 空数据库能初始化本地管理员，旧数据库升级不影响用例数据。
11. 编辑员访问系统管理接口返回 403，禁用用户的现有 Session 立即失效。
12. LDAP Bind 密码加密落库且 API 不回传明文；过滤器缺少占位符时拒绝保存，登录后同步 mail 与 Group。
13. 登录、用户、LDAP、导入、导出和用例删除生成可分页审计；用例编辑和覆盖只生成独立历史。
14. 编辑和重复导入记录修改人及前后差异；CaseID 改名后历史连续，删除后历史行仍保留。
15. 审计可按分类、操作和结果组合筛选，并可搜索人员、资源、操作、IP 与详情。
16. 导入预检正确区分新增、变更和未变化，三种冲突策略均在执行前二次校验。
17. 异步任务完成、取消、失败和进程恢复状态正确，任务临时文件得到清理。
18. 模板规则同时约束导入与批量修改，失败时批量事务不产生部分写入。
19. 普通/批量删除进入回收站，恢复冲突被拒绝，彻底删除后用例历史仍存在。
20. 加密备份可下载并恢复；错误口令和损坏文件被拒绝，恢复只在重启后生效且会先生成安全备份。
21. 运维诊断展示磁盘/数据库/WAL/备份容量、完整性、运行版本和分页回收站。

## 风格与性能

- 保持现有 Apple-Like 视觉语言和响应式布局。
- 2K/4K 断点下字体、工作台侧栏和 CaseID 列表宽度必须同步缩放，避免只放大文字导致换行或溢出。
- 桌面端主导航必须可一键隐藏和恢复；CaseID 列表必须可拖拽缩放，并提供紧凑、默认和适应最长 ID 的快捷操作。
- 页面不得直接渲染原生 `select` 或可见的原生复选框；下拉、复选、滚动条和详情展开箭头必须沿用项目自定义控件视觉。
- 桌面端字段编辑按钮在悬浮字段卡片后显示；移动端必须保持常显。
- CaseID 使用前缀检索以命中 B-tree 索引。
- 避免在开放 API 热路径中执行全表扫描、统计聚合或文件解析。
- 批量数据库写入必须在事务内完成。
- 保持 SQLite WAL、busy timeout 和现有索引策略。
