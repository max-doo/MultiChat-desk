#!/usr/bin/env python3
"""
Scaffolding and component generator for magazine-grade visual HTML reports.
Provides domain-adapted presets with restrained surface hierarchy, CJK-aware
typography pairings, Booktabs three-line tables, and editorial inline SVGs.

Presets:
  1. deep-research       (Academic, Technical, Systems & Industrial Deep Research)
  2. business-finance    (Macroeconomics, Industry Market & Financial Analysis)
  3. consumer-editorial  (Consumer, Lifestyle, Brand & Cultural Trends)
"""

import argparse
import os

import sys

# 中文 Windows 控制台默认 GBK，中文/符号输出会乱码——统一按 UTF-8 输出
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

PRESETS = {
    "deep-research": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;600;700&family=Noto+Serif+SC:wght@600;700;900&display=swap" rel="stylesheet">
<style>
/* Tier 3 Utilitarian · Academic & Technical Deep Research Preset */
:root {{
  --paper: #F6F8FA;
  --band: #EAEFF4;
  --band-deep: #DFEAEE;
  --ink: #0F172A;
  --ink2: #2B3645;
  --mute: #424E5E;
  --hair: #C9D4DF;
  --accent: #0E5A5A;
  --accent-text: #0B4747;
  --accent-2: #B5461B;
  --accent-2-text: #852F0F;
}}

*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
html {{ font-size: 16px; -webkit-font-smoothing: antialiased; background: var(--paper); color: var(--ink); }}
body {{
  font-family: "Noto Sans SC", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 15.5px;
  line-height: 1.74;
  color: var(--ink2);
  background: var(--paper);
  overflow-x: clip;
}}

.page {{
  max-width: 1400px;
  margin: 0 auto;
  padding: 64px clamp(24px, 8.5vw, 108px) 92px;
}}

/* 12-column open canvas grid */
.grid {{ display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 24px; row-gap: 24px; }}
.span-12 {{ grid-column: span 12; }}
.span-9  {{ grid-column: span 9; }}
.span-8  {{ grid-column: span 8; }}
.span-7  {{ grid-column: span 7; }}
.span-6  {{ grid-column: span 6; }}
.span-5  {{ grid-column: span 5; }}
.span-4  {{ grid-column: span 4; }}
.span-3  {{ grid-column: span 3; }}
.measure {{ max-width: 68ch; }}

/* Typography (CJK Serif display + Sans body + Mono data) */
.kicker, .sec-kicker {{
  display: block;
  font-family: "JetBrains Mono", "Noto Sans SC", monospace;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--accent-text);
  margin-bottom: 10px;
}}

h1, h2 {{
  font-family: "Noto Serif SC", "Songti SC", Georgia, serif;
  color: var(--ink);
  text-wrap: balance;
}}
h1 {{ font-size: clamp(30px, 3.8vw, 46px); line-height: 1.2; font-weight: 900; letter-spacing: -0.02em; margin-bottom: 18px; }}
h2 {{ font-size: clamp(22px, 2.3vw, 29px); line-height: 1.32; font-weight: 700; margin-bottom: 16px; }}
h3 {{ font-family: "Noto Sans SC", sans-serif; font-size: 16.5px; line-height: 1.42; font-weight: 700; color: var(--ink); margin-bottom: 8px; }}

p {{ max-width: 68ch; color: var(--ink2); margin-bottom: 14px; }}
p:last-child {{ margin-bottom: 0; }}
strong {{ color: var(--ink); font-weight: 600; }}
a {{ color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }}
a:hover {{ color: var(--ink); }}

.mono, code {{ font-family: "JetBrains Mono", monospace; font-size: 13px; color: var(--accent-text); }}

/* Hero */
.hero {{ padding-bottom: 40px; border-bottom: 2px solid var(--ink); margin-bottom: 8px; }}
.hero-main {{ align-items: end; }}
.deck {{ font-size: 17px; line-height: 1.66; color: var(--ink2); max-width: 64ch; }}
.emphasis-block {{ border-left: 2px solid var(--accent); padding: 4px 0 4px 20px; }}
.emphasis-num {{ font-family: "JetBrains Mono", "Noto Serif SC", monospace; font-size: clamp(42px, 4.8vw, 62px); font-weight: 600; line-height: 1.06; letter-spacing: -0.03em; color: var(--accent-text); white-space: nowrap; margin-bottom: 10px; }}
.emphasis-cap {{ font-size: 13.5px; line-height: 1.56; color: var(--mute); }}

.meta-strip {{
  margin-top: 22px;
  padding-top: 14px;
  border-top: 1px solid var(--hair);
  display: flex;
  flex-wrap: wrap;
  gap: 8px 28px;
  font-size: 12.5px;
  color: var(--mute);
}}
.meta-strip strong {{ color: var(--ink); font-weight: 600; }}

/* Single-rule verdict strip (zero double borders) */
.verdict-strip {{ margin-top: 28px; padding-top: 22px; border-top: 1px solid var(--hair); }}
.verdict-label {{ font-family: "JetBrains Mono", "Noto Sans SC", monospace; font-size: 12.5px; font-weight: 600; color: var(--accent-text); margin-bottom: 6px; }}
.verdict-item p {{ font-size: 14px; line-height: 1.64; }}

/* Sections */
section {{ padding: 46px 0; border-bottom: 1px solid var(--hair); }}
section.no-border {{ border-bottom: none; }}
.sec-split-head {{ grid-column: span 4; }}
.sec-split-head p {{ font-size: 14.5px; line-height: 1.66; color: var(--mute); }}
.sec-split-body {{ grid-column: span 8; }}

/* Open semantic pillars (hairline top only, zero cards) */
.pillar {{ border-top: 1px solid var(--hair); padding-top: 16px; }}
.pillar-accent {{ border-top: 2px solid var(--accent); padding-top: 16px; }}
.pillar-alert {{ border-top: 2px solid var(--accent-2); padding-top: 16px; }}
.pillar-tag {{ display: block; font-family: "JetBrains Mono", "Noto Sans SC", monospace; font-size: 12px; font-weight: 600; color: var(--accent-text); margin-bottom: 6px; }}
.pillar-alert .pillar-tag {{ color: var(--accent-2-text); }}
.pillar p, .pillar-accent p, .pillar-alert p {{ font-size: 14px; line-height: 1.66; }}

/* Open horizontal KPI strip */
.kpi-row {{
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 24px;
  padding: 20px 0;
  border-top: 1px solid var(--hair);
  border-bottom: 1px solid var(--hair);
  margin: 24px 0;
}}
.kpi-val {{ font-family: "JetBrains Mono", monospace; font-size: 26px; font-weight: 600; color: var(--ink); line-height: 1.15; margin-bottom: 6px; }}
.kpi-val.accent {{ color: var(--accent-text); }}
.kpi-val.alert {{ color: var(--accent-2-text); }}
.kpi-desc {{ font-size: 12.5px; line-height: 1.52; color: var(--mute); }}

/* Clean lists */
ul.clean-list, ol.clean-list {{ list-style: none; margin: 10px 0 18px; }}
ul.clean-list li, ol.clean-list li {{ position: relative; padding-left: 20px; margin-bottom: 10px; font-size: 14.5px; line-height: 1.68; color: var(--ink2); max-width: 66ch; }}
ul.clean-list li::before {{ content: ""; position: absolute; left: 0; top: 11px; width: 7px; height: 2px; background: var(--accent); }}
ol.clean-list {{ counter-reset: item; }}
ol.clean-list li {{ counter-increment: item; padding-left: 28px; }}
ol.clean-list li::before {{ content: counter(item) "."; position: absolute; left: 0; font-family: "JetBrains Mono", monospace; font-size: 13px; font-weight: 600; color: var(--accent-text); }}

/* Figures (3-layer anatomy: title + sub -> SVG -> subtle source note) */
figure {{ margin: 28px 0 8px; padding-top: 18px; border-top: 1px solid var(--hair); width: 100%; }}
.fig-head {{ margin-bottom: 16px; }}
.fig-title {{ font-family: "Noto Sans SC", sans-serif; font-size: 16px; font-weight: 700; color: var(--ink); line-height: 1.4; margin-bottom: 4px; }}
.fig-sub {{ font-size: 13px; color: var(--mute); line-height: 1.55; }}
figure svg {{ display: block; width: 100%; height: auto; overflow: visible; }}
figcaption {{ margin-top: 12px; font-size: 12px; line-height: 1.58; color: var(--mute); }}

/* Booktabs three-line open tables */
.table-wrap {{ width: 100%; overflow-x: auto; margin-top: 22px; }}
.table-caption {{ font-size: 15px; font-weight: 700; color: var(--ink); margin-bottom: 10px; }}
table {{ width: 100%; border-collapse: collapse; font-size: 13.5px; line-height: 1.58; border-top: 2px solid var(--ink); border-bottom: 2px solid var(--ink); }}
thead th {{ text-align: left; font-size: 12.5px; font-weight: 700; color: var(--ink); padding: 11px 14px 11px 0; border-bottom: 1px solid var(--ink); vertical-align: bottom; white-space: nowrap; }}
tbody td {{ padding: 11px 14px 11px 0; border-bottom: 1px solid var(--hair); vertical-align: top; color: var(--ink2); }}
tbody tr:last-child td {{ border-bottom: none; }}
td.lead {{ font-weight: 600; color: var(--ink); white-space: nowrap; }}
td.num, th.num {{ font-family: "JetBrains Mono", "Noto Sans SC", monospace; font-size: 13px; color: var(--ink); white-space: nowrap; font-variant-numeric: tabular-nums; }}

/* Technical / Formula Spec Block (only for technical/quantitative topics) */
.schema-spec {{ border-left: 2px solid var(--accent); padding: 6px 0 6px 18px; margin: 14px 0 18px; font-family: "JetBrains Mono", "Noto Sans SC", monospace; font-size: 13px; line-height: 1.65; color: var(--ink); overflow-x: auto; }}

/* Full-bleed Tinted Pull Band (restrained climax, at most 1 per report) */
.pull-band {{
  margin: 0 calc(-1 * clamp(24px, 8.5vw, 108px));
  padding: 44px clamp(24px, 8.5vw, 108px);
  background: var(--band);
  border-top: 1px solid var(--hair);
  border-bottom: 1px solid var(--hair);
}}
.pull-quote {{ font-family: "Noto Serif SC", Georgia, serif; font-size: clamp(20px, 2.2vw, 27px); line-height: 1.42; font-weight: 700; color: var(--ink); text-wrap: balance; margin-bottom: 14px; }}
.pull-note {{ font-family: "JetBrains Mono", "Noto Sans SC", monospace; font-size: 13px; color: var(--accent-2-text); font-weight: 600; padding-left: 14px; border-left: 3px solid var(--accent-2); line-height: 1.62; }}

/* Sources */
footer.refs {{ padding-top: 38px; border-top: 2px solid var(--ink); }}
.sources-list {{ padding-left: 22px; column-count: 2; column-gap: 36px; font-size: 12.5px; line-height: 1.64; color: var(--mute); }}
.sources-list li {{ margin-bottom: 8px; break-inside: avoid; }}

@media (max-width: 960px) {{
  .span-9, .span-8, .span-7, .span-6, .span-5, .span-4, .span-3, .sec-split-head, .sec-split-body {{ grid-column: span 12; }}
  .emphasis-block {{ border-left: none; border-top: 2px solid var(--accent); padding: 14px 0 0; margin-top: 16px; }}
  .kpi-row {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
  .sources-list {{ column-count: 1; }}
}}
@media (max-width: 560px) {{
  .kpi-row {{ grid-template-columns: 1fr; }}
}}
</style>
</head>
<body>
<main class="page">

  <header class="hero">
    <div class="grid hero-main">
      <div class="span-8">
        <span class="kicker">深度研究报告 · 核心架构与实证解构</span>
        <h1>{title}</h1>
        <p class="deck">{deck}</p>
        <div class="meta-strip">
          <span><strong>研究范围：</strong>在此注明样本跨度或覆盖领域</span>
          <span><strong>核心方法：</strong>在此注明实证数据或文献口径</span>
        </div>
      </div>
      <div class="span-4">
        <div class="emphasis-block">
          <div class="emphasis-num">78.4%</div>
          <div class="emphasis-cap">首屏核心量化断言或关键基准指标，简明标明数据来源与统计口径。</div>
        </div>
      </div>
    </div>

    <div class="grid verdict-strip">
      <div class="span-4 verdict-item">
        <div class="verdict-label">核心机制 · 底层驱动</div>
        <p>概括首个维度的关键判断，直接点明因果链条与演进本质。</p>
      </div>
      <div class="span-4 verdict-item">
        <div class="verdict-label">关键权衡 · 适用边界</div>
        <p>对比主流路径的成本与收益边界，明确方案失效的前置条件。</p>
      </div>
      <div class="span-4 verdict-item">
        <div class="verdict-label">前沿趋势 · 落地拐点</div>
        <p>指出未来 3–5 年的决定性技术变量与组织落地门槛。</p>
      </div>
    </div>
  </header>

  <section class="grid">
    <div class="sec-split-head">
      <span class="sec-kicker">理论边界与演进驱动</span>
      <h2>核心瓶颈不在单点效率，而在跨层节拍与接口治理</h2>
      <p>用 1–2 句话精炼本节主旨，为右侧推演建立清晰视角。</p>
    </div>
    <div class="sec-split-body measure">
      <p>深入展开论证段落。基于一手数据、权威文献或系统参数阐明因果机制，避免空泛形容词。</p>
      <ul class="clean-list">
        <li><strong>结构性矛盾一：</strong>说明底层重资产稳定周期与上层高频需求迭代之间的张力。</li>
        <li><strong>结构性矛盾二：</strong>对比理想框架与工程落地现实的断层，揭示隐性维护代价。</li>
      </ul>
    </div>
  </section>

  <section class="no-border">
    <div class="grid">
      <div class="span-12">
        <span class="sec-kicker">系统分层架构与演进节拍解构</span>
        <h2>无描边分层色带与快慢节拍隔离构成现代系统核心底座</h2>
        <p>通过清晰的边界契约将高频迭代层与长周期稳定层解耦，是控制复杂度扩散的根本手段。</p>
      </div>

      <div class="span-12">
        <figure>
          <div class="fig-head">
            <div class="fig-title">图 1：系统五层架构解构与快慢演进节拍隔离示意图</div>
            <div class="fig-sub">左侧以无描边柔和色带与定位条呈现层级职责，右侧以开放式引导线揭示迭代节拍分化</div>
          </div>
          <svg viewBox="0 0 900 330" width="100%" role="img" aria-label="系统分层架构与节拍隔离示意图">
            <!-- Layer 4: Governance -->
            <rect x="20" y="16" width="580" height="62" fill="#EAEFF4" />
            <line x1="20" y1="16" x2="20" y2="78" stroke="#0E5A5A" stroke-width="4" />
            <text x="38" y="42" font-size="14" font-weight="700" fill="#0F172A">L4 · 知识资产、规则引擎与跨职能治理层</text>
            <text x="38" y="63" font-size="12.5" fill="#2B3645">标准规范库 · 配置规则 · 权威真相源与跨团队协作契约</text>

            <!-- Layer 3: Highlighted Fast Layer (tinted + warm accent bar, NO black brick) -->
            <rect x="20" y="90" width="580" height="66" fill="#DFEAEE" />
            <line x1="20" y1="90" x2="20" y2="156" stroke="#B5461B" stroke-width="4" />
            <text x="38" y="116" font-size="14" font-weight="700" fill="#0F172A">L3 · 软件栈、智能调度与应用数据层（核心创新引擎）</text>
            <text x="38" y="138" font-size="12.5" fill="#2B3645">服务化中间件 · 虚拟化隔离 · 标定参数与持续在线演进</text>

            <!-- Layer 2: Interface Firewall -->
            <rect x="20" y="168" width="580" height="60" fill="#EAEFF4" />
            <line x1="20" y1="168" x2="20" y2="228" stroke="#0E5A5A" stroke-width="4" />
            <text x="38" y="194" font-size="14" font-weight="700" fill="#0F172A">L2 · 标准化接口契约与显性设计规则（变更防火墙）</text>
            <text x="38" y="215" font-size="12.5" fill="#2B3645">空间约束 · 能源与通信协议契约 — 冻结边界阻断连锁变更</text>

            <!-- Layer 1: Physical / Base Core -->
            <rect x="20" y="240" width="580" height="64" fill="#EAEFF4" />
            <line x1="20" y1="240" x2="20" y2="304" stroke="#0E5A5A" stroke-width="4" />
            <text x="38" y="266" font-size="14" font-weight="700" fill="#0F172A">L1 · 底层核心底座与规模化交付基础设施</text>
            <text x="38" y="288" font-size="12.5" fill="#2B3645">高复用公共硬件/算力底座 · 柔性产线与标准化供应网络</text>

            <!-- Open Right-side Cadence Panel -->
            <line x1="628" y1="20" x2="628" y2="302" stroke="#C9D4DF" stroke-width="1.5" />

            <line x1="650" y1="90" x2="650" y2="156" stroke="#B5461B" stroke-width="3" />
            <text x="664" y="113" font-size="13.5" font-weight="700" fill="#852F0F">高频敏捷演进节拍</text>
            <text x="664" y="133" font-size="12.5" fill="#2B3645">按周/月持续部署与远程升级</text>
            <text x="664" y="151" font-size="12" fill="#424E5E">功能演进脱离底层长周期束缚</text>

            <line x1="646" y1="198" x2="880" y2="198" stroke="#0E5A5A" stroke-width="1.5" stroke-dasharray="5 3" />
            <text x="664" y="190" font-size="12.5" font-weight="700" fill="#0B4747">接口冻结与解耦界面</text>
            <text x="664" y="216" font-size="12" fill="#424E5E">隔离上下层变更传播（Knock-on）</text>

            <line x1="650" y1="240" x2="650" y2="304" stroke="#0E5A5A" stroke-width="3" />
            <text x="664" y="264" font-size="13.5" font-weight="700" fill="#0B4747">长周期跨代冻结节拍</text>
            <text x="664" y="284" font-size="12.5" fill="#2B3645">维持 5–10 年底层架构稳定</text>
            <text x="664" y="302" font-size="12" fill="#424E5E">摊薄重资产与安全认证投入</text>

            <text x="664" y="42" font-size="13.5" font-weight="700" fill="#0F172A">跨周期治理中枢</text>
            <text x="664" y="62" font-size="12" fill="#424E5E">以数字主线统一管控多域变体追溯</text>
          </svg>
          <figcaption>注：示意图用于展示无卡片分层色带语法；请替换为报告实际架构内容与权威文献来源。</figcaption>
        </figure>
      </div>
    </div>
  </section>

  <!-- Full-bleed Tinted Pull Band (restrained highlight, zero jarring dark slab) -->
  <aside class="pull-band">
    <div class="grid">
      <div class="span-8">
        <span class="kicker" style="color: var(--accent-2-text);">批判性实证洞察 · 关键转折判断</span>
        <div class="pull-quote">在此提炼全篇最具穿透力的反直觉结论或实证警示，直击核心权衡。</div>
        <p style="max-width: 62ch;">补充 1–2 句权威实证数据或关键机制阐释，使高潮洞察建立在严密证据之上。</p>
      </div>
      <div class="span-4" style="align-self: center;">
        <div class="pull-note">
          核心决策判据：<br>
          优先标准化高成本、低用户感知差异的幕后模块；保留前端差异化空间。
        </div>
      </div>
    </div>
  </aside>

  <section class="no-border">
    <div class="grid">
      <div class="span-12">
        <span class="sec-kicker">跨方案横向对照</span>
        <h2>主流方案在架构机制、交付效率与适用边界上显著分化</h2>
      </div>
      <div class="span-12 table-wrap">
        <div class="table-caption">表 1：核心方案范式与工程权衡对照</div>
        <table>
          <thead>
            <tr>
              <th>类别</th>
              <th>方案 / 范式</th>
              <th>核心机制与架构特征</th>
              <th class="num">关键量化口径</th>
              <th>适用优势与现实局限</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="lead">范式一</td>
              <td class="lead">标准化协议总线</td>
              <td>明确冻结跨层接口契约，支持多团队并行扩展。</td>
              <td class="num">-30% 成本</td>
              <td>强于规模复用与长期维护；前期架构投入较高。</td>
            </tr>
            <tr>
              <td class="lead">范式二</td>
              <td class="lead">敏捷混合编排</td>
              <td>在稳定底座上开放参数化配置与软件化增量迭代。</td>
              <td class="num">&gt;50% 提速</td>
              <td>强于快速响应细分需求；须严防变体爆炸与回归失控。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <footer class="refs">
    <span class="kicker">核心参考文献与权威数据来源</span>
    <ol class="sources-list">
      <li>权威期刊论文或行业白皮书出处示例（附 DOI 或原始发布机构链接）。</li>
      <li>公开年报、监管法规或实证数据库来源示例。</li>
    </ol>
  </footer>

</main>
</body>
</html>
""",

    "business-finance": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
/* Tier 3 Utilitarian · Business, Strategy & Financial Analysis Preset */
:root {{
  --paper: #FAFBFC;
  --band: #EDF1F5;
  --ink: #0F172A;
  --ink2: #263241;
  --mute: #435061;
  --hair: #CBD5E1;
  --accent: #1D4E89;
  --accent-soft: #6C93BD;
  --accent-text: #153B69;
  --accent-2: #A63D17;
  --accent-2-text: #7D2C0F;
}}

*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
html {{ font-size: 16px; -webkit-font-smoothing: antialiased; background: var(--paper); color: var(--ink); }}
body {{
  font-family: "Inter", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
  font-size: 15.5px;
  line-height: 1.72;
  color: var(--ink2);
  background: var(--paper);
  overflow-x: clip;
}}

.page {{
  max-width: 1400px;
  margin: 0 auto;
  padding: 60px clamp(24px, 8.5vw, 108px) 92px;
}}

.grid {{ display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 24px; row-gap: 24px; }}
.span-12 {{ grid-column: span 12; }}
.span-8  {{ grid-column: span 8; }}
.span-7  {{ grid-column: span 7; }}
.span-6  {{ grid-column: span 6; }}
.span-5  {{ grid-column: span 5; }}
.span-4  {{ grid-column: span 4; }}
.span-3  {{ grid-column: span 3; }}
.measure {{ max-width: 68ch; }}

.kicker, .sec-kicker {{
  display: block;
  font-family: "IBM Plex Mono", "Noto Sans SC", monospace;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--accent-text);
  margin-bottom: 10px;
}}

h1, h2, h3 {{ font-family: "Inter", "Noto Sans SC", sans-serif; color: var(--ink); text-wrap: balance; }}
h1 {{ font-size: clamp(30px, 3.8vw, 46px); font-weight: 800; line-height: 1.18; letter-spacing: -0.025em; margin-bottom: 18px; }}
h2 {{ font-size: clamp(22px, 2.2vw, 28px); font-weight: 700; line-height: 1.3; letter-spacing: -0.015em; margin-bottom: 16px; }}
h3 {{ font-size: 16px; font-weight: 700; line-height: 1.42; margin-bottom: 8px; }}
p {{ max-width: 68ch; color: var(--ink2); margin-bottom: 14px; }}
p:last-child {{ margin-bottom: 0; }}
strong {{ color: var(--ink); font-weight: 600; }}
a {{ color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; }}

.hero {{ padding-bottom: 40px; border-bottom: 2px solid var(--ink); }}
.hero-main {{ align-items: end; }}
.deck {{ font-size: 17px; line-height: 1.65; color: var(--ink2); max-width: 64ch; }}
.emphasis-block {{ border-left: 2px solid var(--accent); padding: 4px 0 4px 20px; }}
.emphasis-num {{ font-family: "IBM Plex Mono", monospace; font-size: clamp(42px, 4.8vw, 60px); font-weight: 600; line-height: 1.06; letter-spacing: -0.03em; color: var(--accent-text); white-space: nowrap; margin-bottom: 8px; }}
.emphasis-cap {{ font-size: 13.5px; line-height: 1.54; color: var(--mute); }}

.meta-strip {{ margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--hair); display: flex; flex-wrap: wrap; gap: 8px 28px; font-size: 12.5px; color: var(--mute); }}
.meta-strip strong {{ color: var(--ink); }}

section {{ padding: 44px 0; border-bottom: 1px solid var(--hair); }}
section.no-border {{ border-bottom: none; }}
.sec-split-head {{ grid-column: span 4; }}
.sec-split-body {{ grid-column: span 8; }}

.kpi-row {{ display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 24px; padding: 20px 0; border-top: 1px solid var(--hair); border-bottom: 1px solid var(--hair); margin: 24px 0; }}
.kpi-val {{ font-family: "IBM Plex Mono", monospace; font-size: 26px; font-weight: 600; color: var(--ink); line-height: 1.15; margin-bottom: 6px; }}
.kpi-val.accent {{ color: var(--accent-text); }}
.kpi-val.alert {{ color: var(--accent-2-text); }}
.kpi-desc {{ font-size: 12.5px; line-height: 1.5; color: var(--mute); }}

.pillar {{ border-top: 1px solid var(--hair); padding-top: 16px; }}
.pillar-accent {{ border-top: 2px solid var(--accent); padding-top: 16px; }}
.pillar-alert {{ border-top: 2px solid var(--accent-2); padding-top: 16px; }}
.pillar-tag {{ display: block; font-family: "IBM Plex Mono", "Noto Sans SC", monospace; font-size: 12px; font-weight: 600; color: var(--accent-text); margin-bottom: 6px; }}
.pillar-alert .pillar-tag {{ color: var(--accent-2-text); }}

figure {{ margin: 28px 0 8px; padding-top: 18px; border-top: 1px solid var(--hair); width: 100%; }}
.fig-head {{ margin-bottom: 16px; }}
.fig-title {{ font-size: 16px; font-weight: 700; color: var(--ink); line-height: 1.4; margin-bottom: 4px; }}
.fig-sub {{ font-size: 13px; color: var(--mute); line-height: 1.55; }}
figure svg {{ display: block; width: 100%; height: auto; overflow: visible; }}
figcaption {{ margin-top: 12px; font-size: 12px; color: var(--mute); line-height: 1.55; }}

.table-wrap {{ width: 100%; overflow-x: auto; margin-top: 22px; }}
.table-caption {{ font-size: 15px; font-weight: 700; color: var(--ink); margin-bottom: 10px; }}
table {{ width: 100%; border-collapse: collapse; font-size: 13.5px; line-height: 1.58; border-top: 2px solid var(--ink); border-bottom: 2px solid var(--ink); }}
thead th {{ text-align: left; font-family: "IBM Plex Mono", "Noto Sans SC", monospace; font-size: 12.5px; font-weight: 600; color: var(--ink); padding: 11px 14px 11px 0; border-bottom: 1px solid var(--ink); white-space: nowrap; }}
tbody td {{ padding: 11px 14px 11px 0; border-bottom: 1px solid var(--hair); vertical-align: top; color: var(--ink2); }}
tbody tr:last-child td {{ border-bottom: none; }}
td.lead {{ font-weight: 600; color: var(--ink); white-space: nowrap; }}
td.num, th.num {{ font-family: "IBM Plex Mono", monospace; font-size: 13px; color: var(--ink); white-space: nowrap; font-variant-numeric: tabular-nums; }}

.pull-band {{ margin: 0 calc(-1 * clamp(24px, 8.5vw, 108px)) 44px; padding: 44px clamp(24px, 8.5vw, 108px); background: var(--band); border-top: 1px solid var(--hair); border-bottom: 1px solid var(--hair); }}
.pull-quote {{ max-width: 58ch; font-size: clamp(20px, 2.2vw, 27px); font-weight: 700; line-height: 1.42; color: var(--ink); text-wrap: balance; }}

footer.refs {{ padding-top: 38px; border-top: 2px solid var(--ink); }}
.sources-list {{ column-count: 2; column-gap: 36px; padding-left: 22px; font-size: 12.5px; line-height: 1.64; color: var(--mute); }}
.sources-list li {{ margin-bottom: 8px; break-inside: avoid; }}

@media (max-width: 960px) {{
  .span-8, .span-7, .span-6, .span-5, .span-4, .span-3, .sec-split-head, .sec-split-body {{ grid-column: span 12; }}
  .emphasis-block {{ border-left: none; border-top: 2px solid var(--accent); padding: 14px 0 0; margin-top: 16px; }}
  .kpi-row {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
  .sources-list {{ column-count: 1; }}
}}
</style>
</head>
<body>
<main class="page">

  <header class="hero">
    <div class="grid hero-main">
      <div class="span-8">
        <span class="kicker">产业与财务深度简报 · 单位经济模型与竞争格局</span>
        <h1>{title}</h1>
        <p class="deck">{deck}</p>
        <div class="meta-strip">
          <span><strong>财务周期：</strong>FY2024—FY2026E</span>
          <span><strong>数据口径：</strong>审计年报与公开行业披露</span>
        </div>
      </div>
      <div class="span-4">
        <div class="emphasis-block">
          <div class="emphasis-num">32.4%</div>
          <div class="emphasis-cap">核心市场份额、营业利润率或估值溢价指标与权威来源。</div>
        </div>
      </div>
    </div>
  </header>

  <section class="grid">
    <div class="sec-split-head">
      <span class="sec-kicker">结构性驱动与盈利逻辑</span>
      <h2>利润池正从硬件一次性交付向高频订阅与服务化转移</h2>
      <p>剖析政策、成本曲线与商业定价权转移的底层推手。</p>
    </div>
    <div class="sec-split-body measure">
      <p>在此撰写深入推演段落，结合关键财务指标说明单位经济模型（Unit Economics）的真实变化。</p>
    </div>
  </section>

  <section>
    <div class="grid">
      <div class="span-12">
        <span class="sec-kicker">分部贡献与效率对比</span>
        <h2>高毛利增量业务已贡献过半弹性，但核心底座仍决定规模下限</h2>
      </div>
      <div class="span-12">
        <figure>
          <div class="fig-head">
            <div class="fig-title">图 1：核心业务线毛利贡献率与区间弹性对比（%）</div>
            <div class="fig-sub">采用单色系主条表达核实基准，浅色延伸段示意区间上限，暖锈色单独标示结构性拐点业务</div>
          </div>
          <svg viewBox="0 0 900 250" width="100%" role="img" aria-label="业务毛利贡献率单色系横向柱状图">
            <line x1="270" y1="16" x2="270" y2="206" stroke="#0F172A" stroke-width="1.2" />
            <line x1="415" y1="16" x2="415" y2="206" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="3 3" />
            <line x1="560" y1="16" x2="560" y2="206" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="3 3" />
            <line x1="705" y1="16" x2="705" y2="206" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="3 3" />
            <line x1="850" y1="16" x2="850" y2="206" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="3 3" />

            <text x="270" y="228" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="12" fill="#435061">0%</text>
            <text x="415" y="228" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="12" fill="#435061">25%</text>
            <text x="560" y="228" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="12" fill="#435061">50%</text>
            <text x="705" y="228" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="12" fill="#435061">75%</text>
            <text x="850" y="228" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="12" fill="#435061">100%</text>

            <text x="256" y="47" text-anchor="end" font-size="13" font-weight="600" fill="#0F172A">核心平台基础设施毛利率</text>
            <rect x="270" y="30" width="388" height="22" fill="#1D4E89" />
            <rect x="658" y="30" width="82" height="22" fill="#6C93BD" />
            <text x="750" y="46" font-family="IBM Plex Mono, monospace" font-size="13" font-weight="600" fill="#153B69">67%–81%</text>

            <text x="256" y="99" text-anchor="end" font-size="13" font-weight="600" fill="#0F172A">软件订阅与增值服务（拐点）</text>
            <rect x="270" y="82" width="342" height="22" fill="#A63D17" />
            <text x="622" y="98" font-family="IBM Plex Mono, monospace" font-size="13" font-weight="600" fill="#7D2C0F">59.0%</text>

            <text x="256" y="151" text-anchor="end" font-size="13" font-weight="600" fill="#0F172A">存量设备维护与再制造业务</text>
            <rect x="270" y="134" width="267" height="22" fill="#1D4E89" />
            <text x="547" y="150" font-family="IBM Plex Mono, monospace" font-size="13" font-weight="600" fill="#153B69">46.0%</text>
          </svg>
          <figcaption>单位：百分比；数据来源：公司审计年报与公开行业调研整理。</figcaption>
        </figure>
      </div>
    </div>
  </section>

  <section class="no-border">
    <div class="grid">
      <div class="span-12">
        <span class="sec-kicker">核心财务矩阵</span>
        <h2>盈利质量持续抬升，经营现金流增速快于账面利润</h2>
      </div>
      <div class="span-12 table-wrap">
        <div class="table-caption">表 1：核心财务指标与行业中位数对照（百万元）</div>
        <table>
          <thead>
            <tr>
              <th>核心指标</th>
              <th class="num">FY2024</th>
              <th class="num">FY2025E</th>
              <th class="num">YoY 变动</th>
              <th class="num">行业中位数</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="lead">营业收入</td>
              <td class="num">12,450</td>
              <td class="num">16,800</td>
              <td class="num">+34.9%</td>
              <td class="num">+18.2%</td>
            </tr>
            <tr>
              <td class="lead">综合毛利率</td>
              <td class="num">58.4%</td>
              <td class="num">62.1%</td>
              <td class="num">+370 bps</td>
              <td class="num">48.5%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <aside class="pull-band">
    <span class="kicker" style="color: var(--accent-2-text);">核心投资判断</span>
    <div class="pull-quote">最具穿透力的一条行业趋势或商业竞争本质洞见，直陈长期定价权归属。</div>
  </aside>

  <footer class="refs">
    <span class="kicker">参考来源与权威数据出处</span>
    <ol class="sources-list">
      <li>官方财报披露（10-K / 10-Q / 年度报告）。</li>
      <li>权威行业协会统计与证券研究所公开研报。</li>
    </ol>
  </footer>

</main>
</body>
</html>
""",

    "consumer-editorial": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&family=Noto+Sans+SC:wght@400;500;600&family=Noto+Serif+SC:wght@600;700&display=swap" rel="stylesheet">
<style>
/* Tier 2 Balanced · Consumer, Lifestyle & Brand Editorial Preset */
:root {{
  --paper: #FAF7F2;
  --band: #EFEAE0;
  --ink: #1C211E;
  --ink2: #2E3631;
  --mute: #47504B;
  --hair: #D6CFC1;
  --accent: #235D7F;
  --accent-text: #184663;
  --accent-2: #9C4221;
  --accent-2-text: #7C3217;
}}

*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
html {{ font-size: 16px; -webkit-font-smoothing: antialiased; background: var(--paper); color: var(--ink); }}
body {{
  font-family: "Noto Sans SC", -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
  font-size: 15.5px;
  line-height: 1.78;
  color: var(--ink2);
  background: var(--paper);
  overflow-x: clip;
}}

.page {{
  max-width: 1360px;
  margin: 0 auto;
  padding: 68px clamp(24px, 9.5vw, 112px) 96px;
}}

.grid {{ display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 24px; row-gap: 24px; }}
.span-12 {{ grid-column: span 12; }}
.span-8  {{ grid-column: span 8; }}
.span-6  {{ grid-column: span 6; }}
.span-4  {{ grid-column: span 4; }}
.measure {{ max-width: 68ch; }}

.kicker, .sec-kicker {{
  display: block;
  font-family: "IBM Plex Mono", "Noto Sans SC", monospace;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--accent-text);
  margin-bottom: 12px;
}}

h1, h2 {{ font-family: "Instrument Serif", "Noto Serif SC", Georgia, serif; color: var(--ink); text-wrap: balance; }}
h1 {{ font-size: clamp(34px, 4.6vw, 52px); font-weight: 700; line-height: 1.18; letter-spacing: -0.015em; margin-bottom: 18px; }}
h2 {{ font-size: clamp(23px, 2.5vw, 31px); font-weight: 700; line-height: 1.3; margin-bottom: 16px; }}
h3 {{ font-family: "Noto Sans SC", sans-serif; font-size: 16.5px; font-weight: 600; color: var(--ink); margin-bottom: 8px; }}
p {{ max-width: 68ch; color: var(--ink2); margin-bottom: 16px; }}
p:last-child {{ margin-bottom: 0; }}
a {{ color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; }}

.hero {{ padding-bottom: 46px; border-bottom: 2px solid var(--ink); }}
.hero-main {{ align-items: end; }}
.deck {{ font-size: 17.5px; line-height: 1.68; color: var(--ink2); max-width: 62ch; }}
.emphasis-block {{ border-left: 2px solid var(--accent); padding: 4px 0 4px 22px; }}
.emphasis-num {{ font-family: "Instrument Serif", "Noto Serif SC", serif; font-size: clamp(48px, 5.4vw, 68px); font-weight: 600; line-height: 1.05; color: var(--accent-text); white-space: nowrap; margin-bottom: 8px; }}
.emphasis-cap {{ font-size: 13.5px; color: var(--mute); line-height: 1.54; }}

section {{ padding: 52px 0; border-bottom: 1px solid var(--hair); }}
section.no-border {{ border-bottom: none; }}

figure {{ margin: 30px 0 8px; padding-top: 18px; border-top: 1px solid var(--hair); width: 100%; }}
.fig-head {{ margin-bottom: 16px; }}
.fig-title {{ font-size: 16.5px; font-weight: 600; color: var(--ink); margin-bottom: 4px; }}
.fig-sub {{ font-size: 13px; color: var(--mute); }}
figure svg {{ display: block; width: 100%; height: auto; overflow: visible; }}
figcaption {{ margin-top: 12px; font-size: 12.5px; color: var(--mute); }}

.pull-band {{ margin: 0 calc(-1 * clamp(24px, 9.5vw, 112px)) 48px; padding: 48px clamp(24px, 9.5vw, 112px); background: var(--band); border-top: 1px solid var(--hair); border-bottom: 1px solid var(--hair); }}
.pull-quote {{ font-family: "Instrument Serif", "Noto Serif SC", serif; font-size: clamp(22px, 2.6vw, 31px); line-height: 1.4; color: var(--ink); max-width: 56ch; text-wrap: balance; }}

footer.refs {{ padding-top: 38px; border-top: 2px solid var(--ink); }}
.sources-list {{ column-count: 2; column-gap: 36px; padding-left: 22px; font-size: 12.5px; line-height: 1.66; color: var(--mute); }}
.sources-list li {{ margin-bottom: 8px; break-inside: avoid; }}

@media (max-width: 960px) {{
  .span-8, .span-6, .span-4 {{ grid-column: span 12; }}
  .emphasis-block {{ border-left: none; border-top: 2px solid var(--accent); padding: 14px 0 0; margin-top: 18px; }}
  .sources-list {{ column-count: 1; }}
}}
</style>
</head>
<body>
<main class="page">

  <header class="hero">
    <div class="grid hero-main">
      <div class="span-8">
        <span class="kicker">消费趋势与品牌策略特辑</span>
        <h1>{title}</h1>
        <p class="deck">{deck}</p>
      </div>
      <div class="span-4">
        <div class="emphasis-block">
          <div class="emphasis-num">68.2%</div>
          <div class="emphasis-cap">核心消费偏好、品类渗透率或品牌心智指标与调研样本说明。</div>
        </div>
      </div>
    </div>
  </header>

  <section>
    <span class="sec-kicker">审美迁移与消费心理</span>
    <h2>情绪秩序与材质诚实度正在替代符号堆砌成为溢价来源</h2>
    <p class="measure">深入推演生活方式与审美变迁，探讨情绪价值、使用频次与消费决策链路的结构性重塑。</p>
  </section>

  <section class="no-border">
    <span class="sec-kicker">品牌生态位解构</span>
    <h2>真正稳固的品牌溢价集中在高情绪认同与克制普及的交叉象限</h2>
    <figure>
      <div class="fig-head">
        <div class="fig-title">图 1：品牌心智认知与客单价溢价 2×2 象限图</div>
        <div class="fig-sub">横轴代表渠道普及度，纵轴代表情感与文化溢价，圆面积示意复购黏性</div>
      </div>
      <svg viewBox="0 0 900 320" width="100%" role="img" aria-label="品牌心智认知与客单价溢价象限矩阵">
        <line x1="80" y1="165" x2="820" y2="165" stroke="#D6CFC1" stroke-width="1.5" />
        <line x1="450" y1="30" x2="450" y2="295" stroke="#D6CFC1" stroke-width="1.5" />
        <text x="820" y="154" text-anchor="end" font-size="12.5" font-weight="600" fill="#47504B">大众渠道普及度 →</text>
        <text x="450" y="20" text-anchor="middle" font-size="12.5" font-weight="600" fill="#47504B">↑ 情感与审美溢价</text>

        <circle cx="620" cy="92" r="42" fill="#235D7F" fill-opacity="0.12" stroke="#235D7F" stroke-width="1.8" />
        <circle cx="620" cy="92" r="4.5" fill="#235D7F" />
        <text x="674" y="88" font-size="13.5" font-weight="600" fill="#184663">先锋标杆象限</text>
        <text x="674" y="106" font-size="12" fill="#47504B">高复购 · 强心智溢价</text>

        <circle cx="290" cy="112" r="26" fill="#9C4221" fill-opacity="0.12" stroke="#9C4221" stroke-width="1.8" />
        <circle cx="290" cy="112" r="4" fill="#9C4221" />
        <text x="252" y="108" text-anchor="end" font-size="13" font-weight="600" fill="#7C3217">小众设计师</text>
        <text x="252" y="126" text-anchor="end" font-size="12" fill="#47504B">高审美 · 低渠道覆盖</text>
      </svg>
      <figcaption>数据来源：消费者定量调研样本库与品牌公开年报整理。</figcaption>
    </figure>
  </section>

  <aside class="pull-band">
    <span class="kicker" style="color: var(--accent-2-text);">编辑部观点</span>
    <div class="pull-quote">“消费演进的本质不是购买更昂贵的符号，而是在日常器物中建立可持久信赖的生活秩序。”</div>
  </aside>

  <footer class="refs">
    <span class="kicker">调研样本与参考文献</span>
    <ol class="sources-list">
      <li>消费者定性访谈与定量调研报告。</li>
      <li>品牌公开财报与行业消费白皮书。</li>
    </ol>
  </footer>

</main>
</body>
</html>
"""
}


def scaffold(preset: str, title: str, deck: str, output_path: str):
    preset = preset.lower().strip()
    if preset not in PRESETS:
        preset = "deep-research"

    template = PRESETS[preset]
    rendered = template.format(
        title=title or "报告核心主标题：在此输入完整结论判断",
        deck=deck or "在此输入 1-2 句话导语，明确阐述调研范围、核心发现与推演依据。"
    )

    out_dir = os.path.dirname(output_path)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(rendered)

    print(f"Scaffold generated successfully: {output_path} (Preset: {preset})")
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Scaffold an editorial visual HTML report")
    parser.add_argument("--preset", "-p", default="deep-research",
                        choices=["deep-research", "business-finance", "consumer-editorial"],
                        help="Report architectural preset: deep-research, business-finance, consumer-editorial")
    parser.add_argument("--title", default="报告核心主标题", help="Report main title")
    parser.add_argument("--deck", default="报告调研导语与核心发现", help="Report deck/summary")
    parser.add_argument("--output", "-o", required=True, help="Output HTML file path")
    args = parser.parse_args()

    scaffold(args.preset, args.title, args.deck, args.output)


if __name__ == "__main__":
    main()
