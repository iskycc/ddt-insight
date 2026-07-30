# DDT Insight

DDT Insight 是一个完全离线运行的用例数据管理平台。前端和后端均由 Next.js 提供，数据保存在本机 SQLite 数据库中。

## 已实现能力

- 多文件及 ZIP 压缩包批量导入，支持 XLSX、XLS、XLSB、CSV、ODS
- 从 `data` Sheet 读取动态列结构
- 以 `CaseID` 作为全局唯一索引；重复导入时更新同一用例
- 按 `srNum` 自动聚合用例组
- CaseID 前缀检索、srNum 筛选与分页加载
- 单用例逐字段查看和修改，桌面端悬浮字段显示编辑按钮，不一次性渲染大型表格
- 普通字段、srNum、CaseID 均可修改；CaseID 改名时强制校验唯一性
- 导出当前用例、指定 srNum 分组或全部用例
- 无鉴权开放查询 API，支持 CORS
- 公开统计大盘与管理员工作台
- 响应式适配移动端、普通桌面、2K 与 4K 大尺寸屏幕
- 本机系统字体、本地图标、无 CDN、无远程字体、无远程图片

## 开始运行

```bash
cp .env.example .env
npm install
npm run dev
```

访问 `http://localhost:3000`。

默认管理员账号：

```text
用户名：admin
密码：insight-admin
```

正式使用前请务必在 `.env` 中修改密码。

## 功能验收矩阵

| 原始需求 | 实现位置 | 验收标准 |
| --- | --- | --- |
| Next.js 同时作为前后端 | `app/` 页面与 Route Handlers | 单个 Next.js 服务提供 UI 和 API |
| 完全离线 | 本地 CSS、系统字体、本地图标、SQLite | 运行时代码中无远程资源请求 |
| 任意动态列表格 | `lib/spreadsheet.ts` | 两个不同列结构文件可同时导入 |
| data Sheet | 导入解析器 | 非 CSV 文件缺少 data Sheet 时明确报错 |
| CaseID 唯一索引 | SQLite 主键 | 重复导入执行更新，冲突改名被拒绝 |
| srNum 分组 | 组合索引与分组查询 | 相同 srNum 的跨文件用例归入同组 |
| 批量导入 | `/api/import` | 单次最多导入 30 个表格；支持多文件或 ZIP 根目录/一层子目录 |
| 导出 | `/api/export` | 支持当前用例、srNum 分组和全部用例 |
| 任意字段修改 | 字段卡片与 PATCH API | 普通字段、srNum、CaseID 均可编辑 |
| 大数据按 CaseID 切换 | 分页列表与详情面板 | 前端每页最多读取 60 个索引项，只展示一个详情 |
| 无鉴权开放 API | `/api/case` | 未登录可直接获取 JSON Map |
| 高性能与并发 | WAL、索引、mmap、LRU | API 热路径不执行文件解析或全表扫描 |
| 未登录统计大盘 | `/` | 不登录可以查看平台统计 |
| 登录后用例管理 | `/workspace` | 管理接口无 Session 返回 401 |

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

产物位于 `release/ddt-insight-offline/`。将整个目录复制到相同操作系统和 CPU 架构、已安装 Node.js 20.9 或更高版本的机器，配置 `.env` 后运行：

```bash
./start.sh
```

Windows 可以运行 `start.cmd`。由于 SQLite 驱动包含本机二进制文件，应在目标操作系统上生成对应的离线包。

## Docker 部署

已发布镜像：

```text
iskycc/ddt-insight:latest
iskycc/ddt-insight:1.0.1
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

Docker 镜像包含 Next.js 服务和全部运行依赖，但不包含数据库或测试数据。首次启动时会在挂载的数据目录中自动创建空数据库。容器启动后不需要访问互联网。

## GitHub Actions 镜像发布

`.github/workflows/release-image.yml` 用于生成可离线传输的 Docker 镜像包。工作流只执行以下操作：

1. 使用 GitHub 原生 x86-64 与 ARM64 Runner，并行构建 `linux/amd64` 和 `linux/arm64` Docker 镜像。
2. 分别导出为 `ddt-insight-<版本>-linux-amd64.tar.gz` 和 `ddt-insight-<版本>-linux-arm64.tar.gz`。
3. 为两个镜像包分别生成 `.sha256` 校验文件。
4. 将四个文件上传到对应版本的 GitHub Release。

工作流不会登录 Docker Hub，也不会执行 `docker push`。可以通过推送 `v*` 标签触发：

```bash
git tag v1.0.2
git push origin v1.0.2
```

也可以在 GitHub Actions 页面手动运行，并输入 `1.0.2` 或 `v1.0.2`。下载与目标机器 CPU 架构匹配的镜像包后，可在离线机器执行：

```bash
# x86-64 机器
sha256sum -c ddt-insight-1.0.2-linux-amd64.tar.gz.sha256
gzip -dc ddt-insight-1.0.2-linux-amd64.tar.gz | docker load

# ARM64 / AArch64 机器
sha256sum -c ddt-insight-1.0.2-linux-arm64.tar.gz.sha256
gzip -dc ddt-insight-1.0.2-linux-arm64.tar.gz | docker load
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

备份时保存整个 `data/` 目录即可。数据库主要文件是 `data/ddt-insight.sqlite`。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ADMIN_USERNAME` | `admin` | 管理员用户名 |
| `ADMIN_PASSWORD` | `insight-admin` | 管理员密码 |
| `DDT_DATA_DIR` | `./data` | 数据库存储目录 |
| `COOKIE_SECURE` | `false` | 仅在 HTTPS 部署时设为 `true` |
| `MAX_IMPORT_MB` | `200` | 单个导入文件的大小上限 |
| `MAX_ARCHIVE_UNCOMPRESSED_MB` | `200` | ZIP 解压后全部表格的总大小上限 |
| `PORT` | `3000` | 服务端口 |
| `HOSTNAME` | `0.0.0.0` | 监听地址 |
| `DDT_PORT` | `3000` | Compose 暴露到宿主机的端口 |
