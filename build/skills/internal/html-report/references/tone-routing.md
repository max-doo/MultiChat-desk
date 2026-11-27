# 四级主题调性路由表与中文字体/色彩配比规范 (Tone Routing Matrix)

根据报告的主题情感、专业深度与读者使用场景，严格匹配四级调性之一，并同步遵循**中文字体性格映射**与 **85/10/5 色彩克制律**。

---

## 一、 四级主题调性路由矩阵

| 调性层级 | 核心适用题材 | 视觉气质与版式标准 | 标题字体与字号（含中文映射） | 正文与数据字体 | 表面双阶底色与语义配色 | 高潮通栏策略与节距 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1 · Expressive（强表现力）** | 文娱传媒、体育竞技、影视音乐、游戏潮玩、当代文化 | 杂志特写封面、海报级视觉张力、戏剧性留白与强对比 | 展示体 + 高字重中文字体（`Oswald / Syne / Barlow Condensed` + `Noto Serif SC 900` 或 `Noto Sans SC 700`）；`clamp(40px, 5.5vw, 68px)` | `Noto Sans SC` + `IBM Plex Mono` | 深色氛围底（`#0E1013` / 午夜蓝 `#0D1B2A`）或画廊纸白 `#F7F7F5`；强调色金黄/赤橙 | **允许使用 `.band-dark`**；节距 `88–104px`；图片圆角 `0px` |
| **2 · Balanced（平衡杂志型）** | 消费导购、品牌策略、旅行建筑、人文观察、生活方式 | 精装期刊风格（如 *Monocle* / *Kinfolk*）；温润、克制、富有纸质呼吸感 | 优雅衬线体（`Instrument Serif / Fraunces` + `Noto Serif SC 600–700`）；`clamp(34px, 4.6vw, 52px)` | `Inter` + `Noto Sans SC` + `IBM Plex Mono` | 暖纸双阶底（`--paper: #FAF7F2` / `--band: #EFEAE0`）；主色靛青 `#235D7F`，辅色陶红 `#9C4221` | **默认 `.pull-band` 同色系加深带**（禁用突兀纯黑带）；节距 `72–88px`；圆角 `0px` 或 `24px` |
| **3 · Utilitarian（深研/实用型）** | 学术综述、产业深度研究、工程技术架构、金融财务分析 | 顶级智库/专业期刊数据简报（如 *The Economist* / *Nature Reviews*）；高信噪比、冷静克制 | **研究/综述类**：`Noto Serif SC 700–900`（权威雕版感）；<br>**财务/极客简报类**：`Inter / Space Grotesk` + `Noto Sans SC 700`（拉大字重与字距对比）；`clamp(30px, 3.8vw, 48px)` | `Noto Sans SC 400–500`（15–16px）+ `JetBrains Mono / IBM Plex Mono` | **冷纸双阶底**（如 `#F6F8FA` / `#EAEFF4`，避免刺眼 `#FFFFFF` 硬撞黑块）；冷主色（深青/深蓝）+ 暖警示辅色（克制锈橙/砖红） | **默认 `.pull-band` 同色系浅着色带**（除非用户明确要求暗色风，否则不用 `.band-dark`）；节距 `52–68px`；圆角 `0px` |
| **4 · Fun & Playful（趣味活动型）** | 聚会沙龙、节日庆典、校园社群、文创互动、活动复盘 | 温暖亲和、手作海报感、轻松生动 | 圆润展示体（`Fredoka / Baloo 2` + `Noto Sans SC 700`）；`clamp(32px, 4.4vw, 50px)`；禁用冷硬等宽体做大数字 | `Noto Sans SC` | 明快浅暖底（`#FFFDF8` / `#F7F1E3`）；高亲和跳色（暖橙/莓红，文字须加深至 AAA） | 使用暖色浅通栏；节距 `68–84px`；图片圆角 `24px` 或 `999px` |

---

## 二、 通用色彩克制法则 (85 / 10 / 5 原则)

1. **三阶中性体系是精致度的基石**：
   - `--paper`（主画布）：亮色题材优先选择极微着色的纸感底色（如 `#F6F8FA`、`#FAFBFC`、`#FAF7F2`），降低长时间阅读的眩光疲劳。
   - `--band`（次级表面 / 通栏带 / 无描边 SVG 色带）：与 `--paper` 保持同色相，明度仅下沉 **4%–8%**（例如 `#F6F8FA → #EAEFF4`），制造润物无声的层次。
   - `--hair`（发丝分隔线）：明度柔和，承担结构引导而非抢夺视线。
2. **禁止突兀重色块**：
   - 在亮色报告（`--paper` 亮度 > 0.7）中，**严禁在正文通栏或 SVG 图表内部突然插入大面积纯黑/炭黑实心块（如 `#0F172A`）**来“制造对比”。
   - 如需强调关键层级、最终阶段或异常值，优先使用：
     - 浅色着底 + 左侧 `3–4px` 彩色定位线；
     - 同色系加深一阶的边框或虚线外环；
     - 有限面积的语义辅色（`--accent-2`）。
3. **主辅色语义分离与文字专色（Dual-Token Contrast）**：
   - 图形填充色（`--accent`、`--accent-2`）可保持适度明快；但**承载文字时必须使用加深版的 `--accent-text` / `--accent-2-text`**，确保在 `--paper` 上严格满足 `>= 7:1`（WCAG AAA），在 `--band` 上 `>= 6.5:1`。
   - 主色与辅色应具备清晰语义分工（例如主色用于常规结构与正面主序列，辅色仅用于风险、警示、瓶颈或范式跃迁节点），避免两个饱和度相近的冷色互相竞争。

---

## 三、 中文字体性格映射指南 (CJK Typography Pairing)

由于 `Space Grotesk`、`Instrument Serif`、`Inter` 等西文字体不含中文字符，在中文报告中必须显式规划中文字体回退策略：

- **期刊 / 综述 / 人文社科 / 品牌策略（推荐默认）**：`h1, h2` 使用 `"Noto Serif SC", "Songti SC", Georgia, serif`；`body, h3` 使用 `"Noto Sans SC", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`；数据/代码/眉题使用 `"IBM Plex Mono"` 或 `"JetBrains Mono"`。衬线标题与无衬线正文天然形成出版级层级反差。
- **现代商业 / 财务简报 / 极客工程（全无衬线方案）**：若全篇采用无衬线体，必须通过 `h1` 紧凑字距（`-0.025em`）、更大字号阶差、`.kicker` 语义眉题以及充足留白来补偿字形反差，避免标题显得像普通加粗正文。

---

## 四、 参考 CSS 变量组 (AAA 实测通过)

```css
/* Preset 1: deep-research（冷纸双阶 + 深青绿主色 + 锈橙警示辅色） */
:root {
  --paper: #F6F8FA;
  --band: #EAEFF4;
  --ink: #0F172A;
  --ink2: #2B3645;
  --mute: #424E5E;       /* vs --paper: 8.02:1 | vs --band: 7.36:1 */
  --hair: #C9D4DF;
  --accent: #0E5A5A;
  --accent-text: #0B4747; /* vs --paper: 10.1:1 */
  --accent-2: #B5461B;
  --accent-2-text: #852F0F; /* vs --paper: 8.4:1 */
}

/* Preset 2: business-finance（净灰白双阶 + 经典海军蓝 + 琥珀锈辅色） */
:root {
  --paper: #FAFBFC;
  --band: #EDF1F5;
  --ink: #0F172A;
  --ink2: #263241;
  --mute: #435061;       /* vs --paper: 7.98:1 | vs --band: 7.21:1 */
  --hair: #CBD5E1;
  --accent: #1D4E89;
  --accent-text: #153B69; /* vs --paper: 11.1:1 */
  --accent-2: #A63D17;
  --accent-2-text: #7D2C0F; /* vs --paper: 9.2:1 */
}

/* Preset 3: consumer-editorial（暖米白纸底双阶 + 靛蓝 + 陶红） */
:root {
  --paper: #FAF7F2;
  --band: #EFEAE0;
  --ink: #1C211E;
  --ink2: #2E3631;
  --mute: #47504B;       /* vs --paper: 7.77:1 | vs --band: 7.04:1 */
  --hair: #D6CFC1;
  --accent: #235D7F;
  --accent-text: #184663; /* vs --paper: 9.6:1 */
  --accent-2: #9C4221;
  --accent-2-text: #7C3217; /* vs --paper: 8.7:1 */
}
```
