import {
  ArrowDown,
  ArrowRight,
  Braces,
  Check,
  Database,
  FileSpreadsheet,
  Gauge,
  Layers3,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { getSession } from "@/lib/auth";
import { getDashboardStats } from "@/lib/repository";
import { Logo } from "@/components/logo";
import { LoginDialog } from "@/components/login-dialog";

export const dynamic = "force-dynamic";

const countFormatter = new Intl.NumberFormat("zh-CN");

function shortDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function HomePage() {
  const [session, stats] = await Promise.all([
    getSession(),
    Promise.resolve(getDashboardStats()),
  ]);
  const maxTimelineValue = Math.max(...stats.timeline.map((item) => item.count), 1);
  const maxGroupValue = Math.max(...stats.groups.map((item) => item.count), 1);

  return (
    <main className="landing">
      <header className="site-header">
        <div className="site-header-inner">
          <Logo />
          <nav className="site-nav" aria-label="主导航">
            <a href="#overview">平台概览</a>
            <a href="#capabilities">核心能力</a>
            <a href="#api">开放 API</a>
          </nav>
          <LoginDialog authenticated={Boolean(session)} />
        </div>
      </header>

      <section className="hero">
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />
        <div className="hero-inner">
          <div className="hero-copy">
            <div className="hero-badge">
              <span className="status-dot" />
              完全离线 · 数据不出本机
            </div>
            <h1>
              <span className="hero-title-line">让每一个用例，</span>
              <span className="hero-title-accent">清晰可见。</span>
            </h1>
            <p>
              从分散表格到统一数据中枢。极速导入、精准检索、轻松维护，
              让复杂的用例数据回归简单。
            </p>
            <div className="hero-actions">
              {session ? (
                <a className="button button-primary button-large" href="/workspace">
                  打开工作台
                  <ArrowRight size={18} />
                </a>
              ) : (
                <a className="button button-primary button-large" href="#overview">
                  查看平台数据
                  <ArrowDown size={18} />
                </a>
              )}
              <a className="text-link" href="#api">
                浏览 API 接入方式
                <ArrowRight size={16} />
              </a>
            </div>
            <div className="hero-trust">
              <span>
                <Check size={14} /> 无云端依赖
              </span>
              <span>
                <Check size={14} /> 毫秒级查询
              </span>
              <span>
                <Check size={14} /> 动态列兼容
              </span>
            </div>
          </div>

          <div className="hero-visual" aria-label="平台数据概览预览">
            <div className="preview-window">
              <div className="window-topbar">
                <div className="traffic-lights">
                  <i />
                  <i />
                  <i />
                </div>
                <span>数据概览</span>
                <span className="live-pill">
                  <i /> LIVE
                </span>
              </div>
              <div className="preview-content">
                <div className="preview-heading">
                  <div>
                    <small>全部用例</small>
                    <strong>{countFormatter.format(stats.totalCases)}</strong>
                  </div>
                  <span className="trend-badge">
                    <Zap size={12} fill="currentColor" />
                    实时
                  </span>
                </div>
                <div className="hero-chart">
                  {stats.timeline.map((item, index) => (
                    <div className="hero-chart-column" key={item.date}>
                      <span
                        style={{
                          height: `${Math.max(
                            (item.count / maxTimelineValue) * 100,
                            index < 5 && stats.totalCases ? 26 + index * 9 : 7,
                          )}%`,
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="preview-metrics">
                  <div>
                    <span className="metric-icon metric-blue">
                      <Layers3 size={16} />
                    </span>
                    <p>
                      <strong>{countFormatter.format(stats.totalGroups)}</strong>
                      <small>用例分组</small>
                    </p>
                  </div>
                  <div>
                    <span className="metric-icon metric-violet">
                      <FileSpreadsheet size={16} />
                    </span>
                    <p>
                      <strong>{countFormatter.format(stats.totalFiles)}</strong>
                      <small>已导入文件</small>
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="floating-card floating-speed">
              <span>
                <Gauge size={18} />
              </span>
              <p>
                <small>查询响应</small>
                <strong>&lt; 10 ms</strong>
              </p>
            </div>
            <div className="floating-card floating-offline">
              <ShieldCheck size={18} />
              <span>本地安全存储</span>
            </div>
          </div>
        </div>
      </section>

      <section className="overview section" id="overview">
        <div className="section-inner">
          <div className="section-heading split-heading">
            <div>
              <span className="eyebrow">平台概览</span>
              <h2>数据状态，一目了然。</h2>
            </div>
            <p>
              统计数据直接来自本地数据库，反映当前平台的真实运行状态。
            </p>
          </div>

          <div className="stats-grid">
            <article className="stat-card stat-primary">
              <span className="stat-icon">
                <Database size={20} />
              </span>
              <small>用例总数</small>
              <strong>{countFormatter.format(stats.totalCases)}</strong>
              <p>以 CaseID 唯一索引</p>
              <i className="stat-orbit" />
            </article>
            <article className="stat-card">
              <span className="stat-icon stat-icon-indigo">
                <Layers3 size={20} />
              </span>
              <small>用例分组</small>
              <strong>{countFormatter.format(stats.totalGroups)}</strong>
              <p>按 srNum 自动归组</p>
            </article>
            <article className="stat-card">
              <span className="stat-icon stat-icon-green">
                <FileSpreadsheet size={20} />
              </span>
              <small>导入批次</small>
              <strong>{countFormatter.format(stats.totalFiles)}</strong>
              <p>今日新增 {stats.importedToday} 批</p>
            </article>
            <article className="stat-card">
              <span className="stat-icon stat-icon-orange">
                <Sparkles size={20} />
              </span>
              <small>今日活跃用例</small>
              <strong>{countFormatter.format(stats.updatedToday)}</strong>
              <p>导入或修改过的用例</p>
            </article>
          </div>

          <div className="analytics-grid">
            <article className="panel activity-panel">
              <div className="panel-heading">
                <div>
                  <h3>近 7 日导入趋势</h3>
                  <p>每日写入的用例行数</p>
                </div>
                <span className="live-label">
                  <i /> 实时数据
                </span>
              </div>
              <div className="timeline-chart">
                {stats.timeline.map((item) => (
                  <div className="timeline-item" key={item.date}>
                    <div className="bar-track">
                      <span
                        style={{
                          height: `${Math.max(
                            (item.count / maxTimelineValue) * 100,
                            3,
                          )}%`,
                        }}
                      >
                        {item.count > 0 && <em>{item.count}</em>}
                      </span>
                    </div>
                    <small>{item.date.slice(5).replace("-", "/")}</small>
                  </div>
                ))}
              </div>
              {!stats.totalFiles && (
                <div className="empty-chart-note">
                  首次导入后，这里将显示真实趋势
                </div>
              )}
            </article>

            <article className="panel group-panel">
              <div className="panel-heading">
                <div>
                  <h3>主要用例组</h3>
                  <p>按用例数量排序</p>
                </div>
                <Layers3 size={18} />
              </div>
              <div className="group-bars">
                {stats.groups.length ? (
                  stats.groups.slice(0, 5).map((group) => (
                    <div className="group-bar" key={group.srNum}>
                      <div>
                        <strong>{group.srNum}</strong>
                        <span>{countFormatter.format(group.count)}</span>
                      </div>
                      <i>
                        <span
                          style={{
                            width: `${Math.max(
                              (group.count / maxGroupValue) * 100,
                              5,
                            )}%`,
                          }}
                        />
                      </i>
                    </div>
                  ))
                ) : (
                  <div className="panel-empty">
                    <Layers3 size={24} />
                    <p>等待首批用例导入</p>
                  </div>
                )}
              </div>
            </article>
          </div>

          {stats.recentImports.length > 0 && (
            <article className="recent-imports">
              <div>
                <span className="eyebrow">最近导入</span>
                <h3>数据流转记录</h3>
              </div>
              <div className="recent-list">
                {stats.recentImports.map((item) => (
                  <div key={item.id}>
                    <span className="file-tile">
                      <FileSpreadsheet size={17} />
                    </span>
                    <p>
                      <strong>{item.fileName}</strong>
                      <small>{shortDate(item.importedAt)}</small>
                    </p>
                    <em>{countFormatter.format(item.rowCount)} 条</em>
                  </div>
                ))}
              </div>
            </article>
          )}
        </div>
      </section>

      <section className="capabilities section" id="capabilities">
        <div className="section-inner">
          <div className="section-heading center-heading">
            <span className="eyebrow">为效率而生</span>
            <h2>处理数据，不必处理复杂。</h2>
            <p>所有关键能力都围绕快速、可靠和可维护设计。</p>
          </div>
          <div className="feature-grid">
            <article>
              <span className="feature-icon blue-feature">
                <FileSpreadsheet size={24} />
              </span>
              <h3>任意结构，批量导入</h3>
              <p>
                自动识别每份表格的动态列，仅要求 data Sheet、CaseID 与 srNum。
              </p>
            </article>
            <article>
              <span className="feature-icon violet-feature">
                <Zap size={24} />
              </span>
              <h3>索引查询，毫秒返回</h3>
              <p>
                CaseID 主键索引配合内存热缓存，高并发查询依然快速稳定。
              </p>
            </article>
            <article>
              <span className="feature-icon green-feature">
                <ShieldCheck size={24} />
              </span>
              <h3>完全离线，数据自主</h3>
              <p>
                无远程字体、CDN 或云服务依赖，所有数据和功能都留在本机。
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="api-section section" id="api">
        <div className="section-inner api-inner">
          <div className="api-copy">
            <span className="eyebrow eyebrow-dark">开放 API</span>
            <h2>一行请求，获取完整用例。</h2>
            <p>
              无需鉴权。传入 CaseID，即可获得以列名和值组成的 JSON Map，
              方便测试工具或其他内网系统直接调用。
            </p>
            <div className="api-points">
              <span>
                <Check size={14} /> 无需 Token
              </span>
              <span>
                <Check size={14} /> 支持跨域
              </span>
              <span>
                <Check size={14} /> 毫秒响应
              </span>
            </div>
          </div>
          <div className="code-window">
            <div className="code-topbar">
              <div className="traffic-lights">
                <i />
                <i />
                <i />
              </div>
              <span>HTTP Request</span>
              <Braces size={15} />
            </div>
            <div className="code-content">
              <div className="request-line">
                <span>GET</span>
                <code>/api/case?caseId=CASE-001</code>
              </div>
              <pre>
                <code>{`{
  "CaseID": "CASE-001",
  "srNum": "SR-2026-008",
  "Title": "验证用户登录",
  "Priority": "P0",
  "Expected": "登录成功"
}`}</code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="section-inner">
          <Logo />
          <p>本地优先的用例数据管理平台</p>
          <span>DDT Insight · Offline Ready</span>
        </div>
      </footer>
    </main>
  );
}
