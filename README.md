# DDT Insight

DDT Insight 是一个完全离线运行的用例数据管理平台。前端和后端均由 Next.js 提供，数据保存在本机 SQLite 数据库中。

## 已实现能力

- 多文件及 ZIP 压缩包批量导入，支持 XLSX、XLS、XLSB、CSV、ODS
- 导入前预检新增、覆盖、未变化和错误数量，可选择覆盖、跳过或遇冲突终止
- 导入以持久化后台任务执行，支持进度查看、取消、异常重启续跑和来源追踪
- 从 `data` Sheet 读取动态列结构
- 以 `CaseID` 作为全局唯一索引；重复导入时更新同一用例
- 按 `srNum` 自动聚合用例组
- CaseID 前缀检索、srNum 筛选与分页加载，以及全文、来源和动态字段组合高级检索
- 用例多选、批量字段修改、选择导出和批量移入回收站
- 按 srNum 配置字段模板，支持必填、类型、枚举、默认值及导入/批改校验
- 单用例逐字段查看和修改，桌面端悬浮字段显示编辑按钮，不一次性渲染大型表格
- 普通字段、srNum、CaseID 均可修改；CaseID 改名时强制校验唯一性
- 手工修改与导入覆盖均永久保存独立版本历史，记录修改人、来源及字段前后差异，并可回滚到任一版本
- 删除先进入可检索回收站，可恢复或由管理员彻底删除；删除事件进入安全审计，既有修改历史不会被级联清除
- 导出当前用例、指定 srNum 分组或全部用例
- 无鉴权开放查询 API，支持 CORS
- 公开统计大盘与管理员工作台
- 本地用户管理，支持管理员/编辑员角色、启停、密码重置和删除
- LDAP/Active Directory 登录、首次登录自动纳管、mail/Group 属性同步与加密保存 Bind 密码
- 安全审计支持事件分类、组合筛选和人员、资源、操作、IP、详情搜索
- 运维中心提供口令加密备份、恢复前安全备份、存储容量监控、SQLite 完整性检查和 WAL 检查点
- 桌面端主导航一键隐藏，CaseID 列表可拖拽缩放、快捷压缩或适应最长 ID
- CaseID 深链接、字段/链接复制和 ↑/↓、J/K 快捷切换
- 工作台下拉选择、复选框、详情箭头和滚动条采用统一的自定义 Apple-Like 控件
- 响应式适配移动端、普通桌面、2K 与 4K 大尺寸屏幕
- 本机系统字体、本地图标、无 CDN、无远程字体、无远程图片

## 开始运行

源码和独立离线目录统一要求 Node.js 24.x LTS。仓库提供 `.nvmrc`，使用 nvm 时可先运行：

```bash
nvm use
cp .env.example .env
npm install
npm run dev
```

访问 `http://localhost:3000`。

空数据库首次启动时会根据以下默认值初始化一个本地管理员：

```text
用户名：admin
密码：insight-admin
```

正式使用前请务必在 `.env` 中修改密码。管理员初始化后，后续密码重置和用户管理均在工作台中完成；修改环境变量不会覆盖数据库中已经存在的账户。

## 功能验收矩阵

| 原始需求 | 实现位置 | 验收标准 |
| --- | --- | --- |
| Next.js 同时作为前后端 | `app/` 页面与 Route Handlers | 单个 Next.js 服务提供 UI 和 API |
| 完全离线 | 本地 CSS、系统字体、本地图标、SQLite | 运行时代码中无远程资源请求 |
| 任意动态列表格 | `lib/spreadsheet.ts` | 两个不同列结构文件可同时导入 |
| data Sheet | 导入解析器 | 非 CSV 文件缺少 data Sheet 时明确报错 |
| CaseID 唯一索引 | SQLite 主键 | 重复导入执行更新，冲突改名被拒绝 |
| srNum 分组 | 组合索引与分组查询 | 相同 srNum 的跨文件用例归入同组 |
| 批量导入 | 导入预检与后台任务 | 单次最多导入 30 个表格；支持多文件或 ZIP 根目录/一层子目录 |
| 冲突策略 | `/api/import/preview`、`/api/import/jobs` | 执行前展示新增/覆盖/未变化，并支持覆盖、跳过和冲突终止 |
| 导入来源 | 工作台“导入来源” | 按状态、策略、人员、任务号和文件名分页追踪 |
| 导出 | `/api/export` | 支持当前用例、srNum 分组和全部用例 |
| 任意字段修改 | 字段卡片与 PATCH API | 普通字段、srNum、CaseID 均可编辑 |
| 永久修改历史 | 用例详情时间线与 `case_history` | 编辑、覆盖、批改和回滚均追加版本，CaseID 改名后历史链不断开 |
| 历史回滚 | 详情时间线 | 回滚完整快照前检查 CaseID 冲突，并先保留当前版本 |
| 用例删除 | 详情工具栏与回收站 | 删除需二次确认并写安全审计，可恢复或彻底删除，修改历史不被删除 |
| 批量管理 | 工作台“批量与检索” | 多选后可事务批改、选择导出或批量移入回收站 |
| 高级检索 | `/api/cases/search` | CaseID 前缀使用索引，支持游标分页和动态字段组合条件 |
| 字段模板 | `/api/templates` | 模板按 srNum 生效，导入和批量修改执行相同校验 |
| 大数据按 CaseID 切换 | 分页列表与详情面板 | 前端每页最多读取 60 个索引项，只展示一个详情 |
| 无鉴权开放 API | `/api/case` | 未登录可直接获取 JSON Map |
| 高性能与并发 | WAL、索引、mmap、LRU | API 热路径不执行文件解析或全表扫描 |
| 未登录统计大盘 | `/` | 不登录可以查看平台统计 |
| 登录后用例管理 | `/workspace` | 编辑员与管理员可维护用例，接口无 Session 返回 401 |
| 用户与角色 | 用户管理页面 | 本地用户可创建、启停、重置密码；管理员系统页对编辑员返回 403 |
| LDAP 登录 | LDAP 页面与 `ldapts` | 服务账户搜索用户 DN，再使用用户密码 Bind；首次登录自动纳管并同步 mail 与多值 Group |
| 审计日志 | 审计日志页面 | 可按分类、操作、结果分页筛选，并搜索人员、资源、IP 和事件详情 |
| 备份与恢复 | 工作台“运维中心” | AES-256-GCM 口令加密备份，恢复经完整性检查并在重启时安全替换 |
| 容量与诊断 | 工作台“运维中心” | 显示数据库/WAL/备份/磁盘容量、表占用、运行版本和完整性状态 |
| 侧栏空间管理 | 工作台双侧栏 | 主导航一键隐藏；CaseID 列表支持拖拽、键盘和三种宽度快捷操作 |
| 易用性 | 用例详情与地址栏 | 支持 CaseID 深链接、复制和键盘切换，下一条跨页自动加载并滚动 |

## 表格规则

每个文件必须满足：

1. 包含一个名为 `data` 的 Sheet（匹配时忽略大小写）；CSV 文件视为 data Sheet。
2. 第一行为列名。
3. 必须包含大小写完全一致的 `CaseID` 和 `srNum` 列。
4. 每一数据行的 `CaseID` 与 `srNum` 都不能为空。
5. 同一文件内不能出现重复 CaseID。

除 `CaseID` 和 `srNum` 外，其余列可以任意增减，不同文件无需保持一致。

批量导入还支持 `.zip` 压缩包。系统只读取压缩包根目录中的表格，以及根目录下一层文件夹中的表格；更深层级的文件会被忽略。如果这两个层级均没有支持的表格，则整个压缩包不会执行导入。单次展开后最多导入 30 个表格，并限制单个表格及解压后表格总大小。

## 开放 API

查询参数形式：

```http
GET /api/case?caseId=CASE-001
```

REST 路径形式：

```http
GET /api/cases/CASE-001
```

成功时直接返回用例 JSON Map：

```json
{
  "CaseID": "CASE-001",
  "srNum": "SR-2026-008",
  "Title": "验证用户登录",
  "Expected": "登录成功"
}
```

接口无需登录，响应包含 `X-Response-Time`，并允许跨域 GET 访问。

工作台的“开放 API”页面提供经过本地编译和联调验证的 JDK 8 与 Groovy
调用工具类。两者均接收实例地址和 CaseID，查询成功时返回字段 `Map`，
CaseID 不存在时返回 `null`；JDK 8 版本不依赖任何第三方 JSON 库。

## 用户、LDAP 与审计

本地账户分为两种角色：

- 管理员：管理用例、用户、LDAP 配置和审计日志。
- 编辑员：导入、检索、修改和导出用例，无权访问系统管理接口。

LDAP 在“工作台 → LDAP”中配置，支持 `ldap://` 与 `ldaps://`、Bind DN、用户 Base DN、自定义用户过滤器、显示名称属性、邮箱属性、多值 Group 属性、连接超时和 TLS 证书校验。过滤器必须包含 `{{username}}`，平台会在查询前按 LDAP 过滤器规则转义用户名。邮箱与 Group 属性默认使用 `mail` 和 `memberOf`，也可按目录 Schema 修改或留空禁用。LDAP 用户每次成功登录都会同步显示名称、邮箱和 Group 列表，并在用户管理页面展示；平台角色仍由管理员独立控制，不会由 LDAP Group 自动提升。

LDAP Bind 密码通过本机 Session 密钥使用 AES-256-GCM 加密后保存，不会由 API 返回，也不会写入审计详情。备份或迁移时必须保存整个 `data/` 目录，其中同时包含 SQLite 数据库和自动生成的 `.session-secret`；如果显式配置了 `SESSION_SECRET`，迁移后必须保持一致。

用例内容历史与安全审计相互独立。手工编辑、批量修改、重复 CaseID 导入覆盖和版本回滚会在每个用例的详情时间线中永久追加记录，包含操作者、来源、时间、完整前后快照和逐字段差异；CaseID 改名仍沿用同一条历史链。回滚不会改写或删除旧历史，而是再追加一条“历史版本回滚”记录。历史接口要求管理员或编辑员登录并使用游标分页，页面不会一次性加载全部版本。

安全审计记录成功/失败登录、退出、用例导入、导出、删除、用户管理、LDAP 配置和连接测试，不保存字段修改前后的内容。日志仅对管理员开放，可按身份认证、用例操作、用户管理、LDAP 配置和系统事件分类筛选，并可搜索人员、资源、操作、IP 与事件详情；查询始终分页，不会一次性加载全部记录。

## 导入任务、模板与冲突

新导入流程分为两个阶段：

1. 预检在本机解析表格，校验 `data` Sheet、CaseID、srNum、重复值和对应 srNum 模板，并统计新增、将覆盖和内容未变化的行。
2. 确认冲突策略后进入后台队列。任务进度与结果保存在 SQLite 中，浏览器关闭不会中断；进程异常退出时，未完成任务会在下次访问任务接口后重新排队。

“覆盖已有用例”会更新冲突记录并保存永久版本历史；“跳过已有用例”只写入新增记录；“遇到冲突终止”会在执行前再次检查，发现冲突时不写入用例。预检文件最多保留 24 小时，完成、取消或失败后会清理位于持久化数据目录中的临时文件。

字段模板按 srNum 关联。没有配置模板的分组继续接受任意动态列；配置后，导入和批量修改都会应用相同的必填、类型、枚举和默认值规则。模板校验失败时不会部分提交一批批量修改。

## 备份、恢复与回收站

运维中心创建的 `.ddtbackup` 文件同时包含 SQLite 一致性快照和用于 Session/LDAP 密文的应用密钥，使用管理员输入的口令经 scrypt 派生密钥并以 AES-256-GCM 加密。口令不会保存到数据库或审计日志。备份文件保存在 `data/backups/`，可下载到离线介质。

恢复会先校验加密认证、文件哈希、SQLite 完整性、必要数据表、本地恢复管理员和敏感字段格式，然后自动创建一份“恢复前安全备份”。通过校验的数据只会被暂存；重启服务后才在 SQLite 打开前原子替换当前数据库和应用密钥。重启前可在运维中心取消等待中的恢复。若部署显式设置了 `SESSION_SECRET`，该环境变量优先于备份内密钥，因此迁移到新环境时仍需保持相同值。

普通删除和批量删除都只把用例完整快照移入 `deleted_cases`。管理员可在回收站分页搜索、恢复或彻底删除；恢复前会检查 CaseID 与内部记录 ID 冲突。彻底删除回收站快照也不会删除既有用例修改历史。

## 生产与离线交付

普通生产运行：

```bash
npm run build
npm run start:standalone
```

生成无需再次安装 npm 依赖的离线目录：

```bash
npm run package:offline
```

产物位于 `release/ddt-insight-offline/`。将整个目录复制到相同操作系统和 CPU 架构、已安装 Node.js 24.x LTS 的机器，配置 `.env` 后运行：

```bash
./start.sh
```

Windows 可以运行 `start.cmd`。启动脚本会先检查 Node.js 主版本，不是 24.x 时会直接给出错误，避免进入不受支持的运行状态。由于 SQLite 驱动包含本机二进制文件，应在目标操作系统上生成对应的离线包。

## Docker 部署

已发布镜像：

```text
iskycc/ddt-insight:latest
iskycc/ddt-insight:1.0.6
```

使用 Docker Compose：

```bash
cp .env.example .env
docker compose pull
docker compose up -d
docker compose ps
```

旧版 `docker-compose` V1 使用等价命令：

```bash
cp .env.example .env
docker-compose pull
docker-compose up -d
docker-compose ps
```

Compose 文件采用兼容旧版的 `version: "3.3"`，已同时通过 `docker-compose` 1.29.2 和 Docker Compose v2 配置解析。Dockerfile 不依赖新版 BuildKit frontend 指令，兼容支持多阶段构建的传统 Docker 构建器。

默认访问地址是 `http://localhost:3000`。配置中的 `./data:/app/data` 因来源以 `./` 开头，明确表示宿主机目录 bind mount，不是 Docker 命名卷。升级、停止或重建容器不会删除用例数据。

从当前源码本地构建：

```bash
docker build -t iskycc/ddt-insight:latest .
docker compose up -d
```

直接运行镜像：

```bash
docker run -d \
  --name ddt-insight \
  --restart unless-stopped \
  -p 3000:3000 \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=请替换为强密码 \
  -v "$(pwd)/data:/app/data" \
  iskycc/ddt-insight:latest
```

Docker 镜像基于 Node.js 24 Alpine，包含 Next.js 服务和全部运行依赖，但不包含数据库或测试数据。首次启动时会在挂载的数据目录中自动创建空数据库。容器启动后不需要访问互联网。

## GitHub Actions 镜像发布

`.github/workflows/release-image.yml` 用于生成可离线传输的 Docker 镜像包。工作流只执行以下操作：

1. 使用 GitHub 原生 x86-64 与 ARM64 Runner，并行构建 `linux/amd64` 和 `linux/arm64` Docker 镜像。
2. 分别导出为 `ddt-insight-<版本>-linux-amd64.tar.gz` 和 `ddt-insight-<版本>-linux-arm64.tar.gz`。
3. 为两个镜像包分别生成 `.sha256` 校验文件。
4. 将四个文件上传到对应版本的 GitHub Release。

工作流不会登录 Docker Hub，也不会执行 `docker push`。可以通过推送 `v*` 标签触发：

```bash
git tag v1.0.6
git push origin v1.0.6
```

也可以在 GitHub Actions 页面手动运行，并输入 `1.0.6` 或 `v1.0.6`。下载与目标机器 CPU 架构匹配的镜像包后，可在离线机器执行：

```bash
# x86-64 机器
sha256sum -c ddt-insight-1.0.6-linux-amd64.tar.gz.sha256
gzip -dc ddt-insight-1.0.6-linux-amd64.tar.gz | docker load

# ARM64 / AArch64 机器
sha256sum -c ddt-insight-1.0.6-linux-arm64.tar.gz.sha256
gzip -dc ddt-insight-1.0.6-linux-arm64.tar.gz | docker load
```

两个离线包加载后都提供 `iskycc/ddt-insight:<版本>` 和 `iskycc/ddt-insight:latest` 标签。ARM 构建目标为当前服务器和开发板常用的 64 位 `arm64`，不包含 32 位 `arm/v7`。

## 数据与性能

默认数据目录是项目根目录下的 `data/`，可通过 `DDT_DATA_DIR` 指定绝对路径。

数据库启用了：

- WAL 模式，导入期间仍可并发读取
- CaseID 主键索引
- `srNum + CaseID` 组合索引
- 256 MB mmap 和 64 MB SQLite 页缓存
- 2,000 条开放 API 热数据 LRU 缓存

日常可直接使用运维中心生成一致性加密备份；停机维护时也可以保存整个 `data/` 目录。数据库主要文件是 `data/ddt-insight.sqlite`。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ADMIN_USERNAME` | `admin` | 管理员用户名 |
| `ADMIN_PASSWORD` | `insight-admin` | 空数据库首次启动时初始化的管理员密码 |
| `SESSION_SECRET` | 自动生成 | Session 签名与 LDAP 密码加密密钥；通常由 `data/.session-secret` 持久化 |
| `DDT_DATA_DIR` | `./data` | 数据库存储目录 |
| `COOKIE_SECURE` | `false` | 仅在 HTTPS 部署时设为 `true` |
| `MAX_IMPORT_MB` | `200` | 单个导入文件的大小上限 |
| `MAX_ARCHIVE_UNCOMPRESSED_MB` | `200` | ZIP 解压后全部表格的总大小上限 |
| `MAX_BACKUP_RESTORE_MB` | `4096` | 运维中心恢复备份的上传大小上限 |
| `PORT` | `3000` | 服务端口 |
| `HOSTNAME` | `0.0.0.0` | 监听地址 |
| `DDT_PORT` | `3000` | Compose 暴露到宿主机的端口 |
