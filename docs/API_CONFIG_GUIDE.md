# 🛠️ MultiChat API 配置与总结功能指南

欢迎使用 MultiChat！本手册旨在帮助你快速配置 API 供应商，并利用“智能总结”功能高效处理多模型回复。

---

## 1. 核心概念说明

在开始配置前，了解以下三个名词会让你操作更轻松：

*   **API 供应商 (Provider)**：提供 AI 能力的服务商（如 OpenAI 官方、OpenRouter、DeepSeek 等）。
*   **Base URL (服务地址)**：程序的“寻路地址”。不同的供应商有不同的地址。
*   **API Key (通行证)**：你在供应商处申请的秘密令牌，证明你拥有使用权限。

---

## 2. 第一步：添加 API 供应商

点击界面左下角的 **Logo** 打开“设置面板”，找到 **“总结配置”** 区域。

### 常用供应商配置参考：

#### 🌐 国际主流供应商
| 供应商名称 | Base URL (服务地址) | 获取 Key 的地址 | 特点 |
| :--- | :--- | :--- | :--- |
| **OpenRouter** | `https://openrouter.ai/api/v1` | [OpenRouter](https://openrouter.ai/) | **推荐**。聚合全球模型，无需多处充值 |
| **OpenAI** | `https://api.openai.com/v1` | [OpenAI](https://platform.openai.com/) | 官方原厂，最稳健的选择 |
| **Google Gemini** | `https://generativelanguage.googleapis.com/v1beta/openai` | [AI Studio](https://aistudio.google.com/) | 性价比极高，Flash 模型有大量免费额度 |
| **Groq** | `https://api.groq.com/openai/v1` | [Groq Console](https://console.groq.com/) | **速度极快**，目前有免费计划 |
| **Mistral AI** | `https://api.mistral.ai/v1` | [Mistral Console](https://console.mistral.ai/) | 欧洲最强开源模型原厂 |

#### 🇨🇳 国内主流供应商 (均为 OpenAI 兼容模式)
| 供应商名称 | Base URL (服务地址) | 获取 Key 的地址 | 特点 |
| :--- | :--- | :--- | :--- |
| **硅基流动 (SiliconFlow)** | `https://api.siliconflow.cn/v1` | [SiliconFlow](https://siliconflow.cn/) | **强烈推荐**。国内模型聚合，注册即送额度 |
| **DeepSeek (深度求索)** | `https://api.deepseek.com` | [DeepSeek 开放平台](https://platform.deepseek.com/) | 国内之光，价格极低，逻辑极强 |
| **阿里百炼 (通义千问)** | `https://dashscope.aliyuncs.com/compatible-mode/v1` | [阿里云百炼](https://bailian.console.aliyun.com/) | 生态丰富，Qwen 2.5 系列非常优秀 |
| **智谱 AI (GLM)** | `https://open.bigmodel.cn/api/paas/v4` | [智谱 AI 开放平台](https://open.bigmodel.cn/) | 清华系背景，中文理解能力顶尖 |
| **Moonshot (Kimi)** | `https://api.moonshot.cn/v1` | [Moonshot 平台](https://platform.moonshot.cn/) | 超长上下文先驱 |
| **字节跳动 (火山引擎)** | `https://ark.cn-beijing.volces.com/api/v3` | [火山引擎 Ark](https://www.volcengine.com/product/ark) | 豆包大模型，高并发稳定 |

### 操作步骤：
1.  点击 **“新增”** 按钮。
2.  输入供应商 **名称**（如：我的 OpenRouter）。
3.  填入对应的 **Base URL** 和 **API Key**。
4.  点击 **“保存”**。
5.  确保列表左侧的 **勾选框** 已开启。

---

## 3. 第二步：同步或添加模型

有了供应商后，你需要告诉程序你想使用该供应商下的哪个具体模型。

### 方式 A：自动同步（推荐）
1.  在设置面板点击 **“同步/配置”** 按钮。
2.  在弹窗顶部的下拉菜单中选择你刚刚添加的 **供应商**。
3.  点击 **“自动同步”** 按钮。
4.  程序会自动抓取该供应商支持的所有模型 ID（如 `gpt-4o`, `anthropic/claude-3.5-sonnet` 等）。
5.  点击 **“保存配置”**。

### 方式 B：手动添加
1.  如果你知道具体的模型 ID（例如 `gpt-4o-mini`），可以在弹窗底部的“手动添加”区域输入。
2.  **模型 ID**：填入技术标识符。
3.  **显示名称**：填入你容易识别的名字。
4.  点击 **“添加”** 并 **“保存配置”**。

---

## 4. 第三步：管理总结提示词

总结提示词决定了 AI 总结时的“身份”和“逻辑”。

1.  **预设提示词**：我们内置了“综合最佳”、“裁判找茬”等 6 种模式，满足日常需求。
2.  **编辑/新增**：点击提示词右侧的 **编辑 (图标)** 按钮，可以修改提示词的内容。
3.  **自定义**：你可以点击 **“新增”**，编写属于你自己的分析逻辑（例如：专门分析代码 Bug 的角色）。

---

## 5. 第四步：生成总结报告

配置完成后，回到主界面的 **“总结报告”** 标签页：

1.  **勾选回复**：在上方模型区域，勾选你想要加入对比的模型输出卡片。
2.  **选择供应商**：在下拉框中选择一个你已配置好的供应商。
3.  **选择模型**：在“使用模型”下拉框选一个具体的执行模型（推荐用 gpt-4o-mini 或 gemini-flash，速度快且便宜）。
4.  **选择模式**：在底部选择一种总结提示词（如“综合最佳”）。
5.  **额外要求**：如果有特殊需求（如“用中文回复”、“分点叙述”），可以在输入框补充。
6.  **开始总结**：点击按钮，稍等片刻即可看到排版精美的 Markdown 报告。
7.  **导出**：点击右上角的 **下载图标**，可将报告保存为 `.md` 文件。

---

## 💡 小贴士
*   **OpenRouter 优势**：如果你不想在多个平台充值，建议使用 OpenRouter，它支持用一个账户使用几乎全球所有的主流 AI 模型。
*   **免费模型**：在 OpenRouter 中，你可以搜索带有 `:free` 后缀的模型 ID（如 `google/gemini-2.0-flash-exp:free`）实现 0 成本总结。
*   **排查空白**：如果点击总结后页面无反应，请检查你的 API Key 是否有效，以及 Base URL 结尾是否带有多余的空格。

