/**
 * AI 平台选择器配置
 * 用于定位各平台的输入框、发送按钮等 DOM 元素
 */

export interface AutomationStep {
  selector: string | string[]
  text?: string | string[]      // 旧：部分匹配文本，向后兼容
  regex?: string                // 新：正则模式，设定后优先于 text
  exclude?: string[]            // 新：正则数组，命中任一则排除该元素（用于区分 Search/Research）
  wordBoundary?: boolean        // 新：regex 为真时默认 true，自动加 \b 边界
  caseSensitive?: boolean       // 新：默认 false（匹配不区分大小写）
  delay?: number
  exact?: boolean
  optional?: boolean
  countsAsSuccess?: boolean
  menuOpenerFallback?: boolean  // 新：本步元素找不到时，按语义找"开菜单"按钮
  hover?: boolean               // 新：本步不 click 而是 dispatch mouseenter/mouseover/mousemove 触发 hover 浮层
}

export interface ModelSelector {
  // 输入框选择器（按优先级排列）
  textarea: string[]
  // 发送按钮选择器（按优先级排列）
  sendButton: string[]
  // 消息容器选择器（用于抓取回复）
  messageContainer: string[]
  // 研究报告/结果容器选择器（用于抓取“生成总结/报告”的内容）
  reportContainer?: string[]
  // Custom CSS
  customCSS: string
  /** 普通模式/卡片“新对话”按钮使用的 URL */
  newConversationUrl?: string
  /** Webview 总结模式专用：打开此 URL 进入一个隔离的新对话页 */
  summaryConversationUrl?: string
  // Deep Research mode configuration
  researchMode?: {
    // Steps to enable Deep Research
    steps: AutomationStep[]
    cancelSteps?: AutomationStep[]
    // Backward compatibility (optional, can be removed if all updated)
    button?: string
  }
  // AI Image Generation mode configuration
  imageGeneration?: {
    // Steps to enable image generation
    steps: AutomationStep[]
    cancelSteps?: AutomationStep[]
  }
  // 生图结果"下载"自动化步骤序列
  imageDownload?: {
    steps: AutomationStep[]
    closePreviewSelector?: string
  }
}

export interface SelectorsConfig {
  version: number
  lastUpdated: string
  models: Record<string, ModelSelector>
}

/**
 * 默认选择器配置
 * 如需调整请选择器配置，直接修改本文件后重启应用生效
 */
export const defaultSelectors: SelectorsConfig = {
  version: 17,
  lastUpdated: '2026-07-05',
  models: {
    chatgpt: {
      textarea: [
        '#prompt-textarea.ProseMirror',
        'div.ProseMirror[contenteditable="true"]',
        '#prompt-textarea',
        'textarea[placeholder*="Message"]',
        'textarea[placeholder*="询问任何问题"]',
        'textarea[data-id="root"]',
        '[contenteditable="true"][data-placeholder]'
      ],
      sendButton: [
        '[data-testid="send-button"]',
        'button[aria-label*="Send"]',
        'button[data-testid="send-button"]',
        'form button[type="submit"]'
      ],
      messageContainer: [
        '[data-message-author-role="assistant"]',
        '.markdown.prose',
        '.agent-turn .markdown'
      ],
      reportContainer: [
        'section.popover > section',
        '[class*="popover"] > section',
        '[class*="popover"] [class*="report"]',
        '[role="dialog"] [class*="markdown"]',
        '[role="dialog"] article',
        '[class*="deep-research"] [class*="markdown"]',
        '[class*="research"] article'
      ],
      customCSS: `
        nav[aria-label*="Chat history"] { display: none !important; }
        [class*="sidebar"] { display: none !important; }
        .xl\\:pl-\\[260px\\] { padding-left: 0 !important; }
      `,
      newConversationUrl: 'https://chatgpt.com',
      summaryConversationUrl: 'https://chatgpt.com/?temporary-chat=true',
      researchMode: {
        steps: [
          { selector: '[data-testid="composer-plus-btn"], #composer-plus-btn, button.composer-btn', delay: 1000, menuOpenerFallback: true },
          { selector: 'div[role="menuitemradio"]', regex: 'Deep\\s*Research|深度研究', wordBoundary: false, exclude: ['\\bSearch\\b', '搜索'], delay: 500 }
        ],
        cancelSteps: [
          { selector: '[class*="__composer-pill-remove"]', delay: 200 }
        ]
      },
      imageGeneration: {
        steps: [
          { selector: '[data-testid="composer-plus-btn"], #composer-plus-btn, button.composer-btn', delay: 1000, menuOpenerFallback: true },
          { selector: 'div[role="menuitemradio"], div[role="menuitem"]', text: ['Create image', 'DALL-E', '图像生成', '生图'], delay: 500 }
        ],
        cancelSteps: [
          { selector: '[class*="__composer-pill-remove"], [class*="composer-pill-remove"]', delay: 200 }
        ]
      },
      imageDownload: {
        steps: [
          // 步骤1：点最新生图，打开全屏预览
          { selector: 'div[class*="imagegen-image"] img, div.group\\/imagegen-image img, img[id^="_r_"]', delay: 600 },
          // 步骤2：点预览 header 里的"保存"按钮（aria-label="保存" = 中文环境下载原图）
          { selector: 'header[data-testid="fullscreen-shell-header"] button[aria-label="保存"], button[aria-label="保存"]', delay: 300 }
        ],
        closePreviewSelector: 'header[data-testid="fullscreen-shell-header"] button[aria-label="关闭全屏显示"]'
      }
    },
    perplexity: {
      textarea: [
        '#ask-input',
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="Search"]',
        'textarea',
        '[contenteditable="true"]'
      ],
      sendButton: [
        'button[type="submit"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="Submit"]',
        'form button[type="submit"]'
      ],
      messageContainer: [
        '.prose',
        '[data-testid*="answer"]',
        '[class*="answer"]',
        'div[class*="markdown"]'
      ],
      customCSS: ``,
      newConversationUrl: 'https://www.perplexity.ai/',
      researchMode: {
        steps: [
          // 宽屏：直接点击 radio 按钮切换到研究模式
          { selector: 'button[role="radio"][value="research"]:not([aria-disabled="true"])', delay: 300, optional: true },
          // 窄屏：点击包含"研究"文字的按钮（研究按钮有 border class，来源按钮没有）
          { selector: 'button.border.rounded-lg.h-8:not([aria-haspopup])', regex: '研究', wordBoundary: false, exclude: ['搜索', '\\bSearch\\b'], delay: 300, optional: true },
          // 从下拉菜单选择研究选项（如果有菜单出现）
          { selector: '[role="menuitemradio"][value="research"], [role="menuitemradio"][data-value="research"], [role="menuitem"][data-value="research"], [role="menuitemradio"][aria-label*="研究"], [role="menuitemradio"][aria-label*="Research"], [role="menuitem"][aria-label*="研究"], [role="menuitem"][aria-label*="Research"]', delay: 300, optional: true }
        ],
        cancelSteps: [
          // 宽屏：直接点击 radio 按钮切换回搜索模式
          { selector: 'button[role="radio"][value="search"]:not([aria-disabled="true"])', delay: 300, optional: true },
          // 窄屏：点击包含"搜索"文字的按钮
          { selector: 'button.border.rounded-lg.h-8:not([aria-haspopup])', regex: '搜索|\\bSearch\\b', wordBoundary: false, exclude: ['研究', '\\bResearch\\b'], delay: 300, optional: true },
          // 从下拉菜单选择搜索选项
          { selector: '[role="menuitemradio"][value="search"], [role="menuitemradio"][data-value="search"], [role="menuitem"][data-value="search"], [role="menuitemradio"][aria-label*="搜索"], [role="menuitemradio"][aria-label*="Search"], [role="menuitem"][aria-label*="搜索"], [role="menuitem"][aria-label*="Search"]', delay: 300, optional: true }
        ]
      }
    },
    claude: {
      textarea: [
        '[contenteditable="true"]',
        'div[data-placeholder]',
        '.ProseMirror',
        'div[class*="ProseMirror"]'
      ],
      sendButton: [
        'button[aria-label*="Send"]',
        'button[type="submit"]',
        'fieldset button:last-child'
      ],
      messageContainer: [
        '[data-is-streaming]',
        '.prose',
        '[class*="contents"] .prose'
      ],
      customCSS: `
        nav { display: none !important; }
        [class*="sidebar"] { display: none !important; }
        .lg\\:pl-\\[260px\\] { padding-left: 0 !important; }
      `,
      newConversationUrl: 'https://claude.ai/new'
    },
    chatglm: {
      textarea: [
        'textarea[placeholder*="输入"]',
        'textarea[placeholder*="请输入"]',
        'textarea[placeholder*="提问"]',
        'textarea',
        '[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"][data-placeholder]',
        '[contenteditable="true"]'
      ],
      sendButton: [
        'button[type="submit"]',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        'form button[type="submit"]',
        '[role="button"][aria-label*="发送"]'
      ],
      messageContainer: [
        '[data-message-author-role="assistant"]',
        '[data-role="assistant"]',
        '[data-testid*="assistant"]',
        '.assistant .prose, .assistant .markdown, .assistant-message',
        '.markdown-body',
        '.prose',
        '[class*="markdown"]'
      ],
      reportContainer: [
        '#app > section > div.task-aside-container',
        'div.task-aside-container'
      ],
      customCSS: ``,
      newConversationUrl: 'https://chatglm.cn/main/alltoolsdetail',
      researchMode: {
        steps: [
          { selector: ['button', '[role="button"]', '[role="menuitem"]', '[role="menuitemradio"]', '[role="tab"]'], text: ['深度研究', '联网研究', '研究模式', 'Deep Research', 'Research'], delay: 700 }
        ],
        cancelSteps: [
          { selector: ['button', '[role="button"]', '[role="menuitem"]', '[role="menuitemradio"]', '[role="tab"]'], text: ['深度研究', '联网研究', '研究模式', 'Deep Research', 'Research'], delay: 300 }
        ]
      },
      imageGeneration: {
        steps: [
          { selector: ['button', '[role="button"]', '[role="menuitem"]', '[role="menuitemradio"]'], text: ['生图', '画图', '图像生成', 'Image'], delay: 700 }
        ],
        cancelSteps: [
          { selector: ['button[aria-label*="删除"]', 'button[aria-label*="remove"]'], delay: 200, optional: true }
        ]
      }
    },
    yiyan: {
      textarea: [
        'textarea[placeholder*="输入"]',
        'textarea[placeholder*="问"]',
        'textarea',
        '[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"][data-placeholder]',
        '[contenteditable="true"]'
      ],
      sendButton: [
        'button[type="submit"]',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        'form button[type="submit"]',
        '[role="button"][aria-label*="发送"]'
      ],
      messageContainer: [
        '#answer_text_id .custom-html.md-stream-desktop',
        '#answer_text_id .custom-html',
        '#answer_text_id .md-stream-desktop',
        '#answer_text_id',
        '[data-role="assistant"]',
        '[data-testid*="assistant"]',
        '.assistant .prose, .assistant .markdown, .assistant-message',
        '.markdown-body',
        '.prose',
        '[class*="markdown"]'
      ],
      customCSS: ``,
      newConversationUrl: 'https://chat.baidu.com/',
      imageGeneration: {
        steps: [
          { selector: ['button', '[role="button"]', '[role="menuitem"]', '[role="menuitemradio"]'], text: ['生图', '画图', '图像生成', 'Image'], delay: 500 }
        ],
        cancelSteps: [
          { selector: ['button[aria-label*="删除"]', 'button[aria-label*="remove"]'], delay: 200, optional: true }
        ]
      }
    },
    gemini: {
      textarea: [
        'rich-textarea .ql-editor[contenteditable="true"]',
        'rich-textarea [contenteditable="true"]',
        '.ql-editor.textarea[contenteditable="true"]',
        '[contenteditable="true"][role="textbox"]',
        'rich-textarea',
        '[contenteditable="true"]'
      ],
      sendButton: [
        'button.send-button.submit',
        'button.send-button[aria-label="发送"]',
        '.send-button-container button',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        '.send-button'
      ],
      messageContainer: [
        'message-content',
        '.response-container',
        '.model-response'
      ],
      customCSS: ``,
      newConversationUrl: 'https://gemini.google.com/app',
      researchMode: {
        steps: [
          { selector: 'button.toolbox-drawer-button', delay: 500, menuOpenerFallback: true },
          { selector: ['mat-list-item.mat-mdc-list-item', 'button.toolbox-drawer-item-list-button'], text: 'Deep Research', delay: 500 }
        ],
        cancelSteps: [
          { selector: ['mat-list-item.mat-mdc-list-item', 'button.toolbox-drawer-item-deselect-button'], text: 'Deep Research', delay: 200 }
        ]
      },
      imageGeneration: {
        steps: [
          { selector: 'button.toolbox-drawer-button', delay: 500, menuOpenerFallback: true },
          { selector: ['mat-list-item.mat-mdc-list-item', 'button.toolbox-drawer-item-list-button'], text: ['Imagen', 'Image generation', '图像生成', '生图'], delay: 500 }
        ],
        cancelSteps: [
          { selector: ['mat-list-item.mat-mdc-list-item', 'button.toolbox-drawer-item-deselect-button'], text: ['Imagen', 'Image generation', '图像生成', '生图'], delay: 200 }
        ]
      },
      imageDownload: {
        steps: [
          // 步骤1：hover 最新 generated-image，触发 on-hover-button 显示
          { selector: 'generated-image, single-image.generated-image, div.generated-images generated-image', delay: 300, hover: true },
          // 步骤2：点"下载完整尺寸的图片"按钮（双候选：aria-label + 语义 tag）
          { selector: 'button[aria-label="下载完整尺寸的图片"], download-generated-image-button button', delay: 300 }
        ]
      }
    },
    grok: {
      textarea: [
        'textarea[placeholder*="Ask"]',
        'textarea[data-testid="textbox"]',
        'textarea',
        '[contenteditable="true"]'
      ],
      sendButton: [
        'button[aria-label*="Send"]',
        'button[type="submit"]',
        'button[data-testid="send-button"]',
        'form button:last-child'
      ],
      messageContainer: [
        '.message-content',
        '[data-testid="message"]',
        '.prose'
      ],
      customCSS: ``,
      newConversationUrl: 'https://grok.com/',
      researchMode: {
        steps: [
          { selector: 'button', text: 'DeepSearch', delay: 500 }
        ],
        cancelSteps: [
          { selector: 'button[aria-label*="删除"]', delay: 200 }
        ]
      },
      imageGeneration: {
        steps: [
          { selector: 'button', text: ['Aurora', 'Image Gen', '生图', '画图', '图像生成'], delay: 500, optional: true },
          { selector: 'button[aria-label*="image"], button[aria-label*="图片"], button[aria-label*="生图"]', delay: 500, optional: true }
        ],
        cancelSteps: [
          { selector: 'button[aria-label*="删除"], button[aria-label*="remove"]', delay: 200, optional: true }
        ]
      }
    },
    qwen: {
      textarea: [
        'textarea.ant-input',
        'textarea[placeholder*="向千问提问"]',
        'textarea[placeholder*="输入"]',
        '.chat-input textarea',
        'textarea',
        '[contenteditable="true"]'
      ],
      sendButton: [
        'button[aria-label*="发送"]',
        '.send-btn',
        'button[type="submit"]',
        'button.primary'
      ],
      // 注意：候选只保留"整条回复"容器级，不要放段落级（如 .qk-md-paragraph）。
      // 抓取逻辑取"最后一个可见候选"，段落级会命中视频卡片块(.qk-md-has-multi-modal)
      // 导致只抓到视频标题而丢失正文。
      messageContainer: [
        '[class*="message-select-wrapper-answer"] [data-chat-answers-wrap]',
        '[class*="message-select-wrapper-answer"] .answer-common-card',
        '[data-chat-answers-wrap]',
        '.answer-common-card',
        '#qk-markdown-react',
        '.qk-markdown-react',
        '[class*="qk-markdown"]',
        '.tongyi-markdown',
        '[class*="tongyi-markdown"]',
        '.response-content',
        '.markdown-body',
        '.message-content'
      ],
      reportContainer: [
        '#\\:r4e\\: > div > div.viewResults-D_wP0H > div.tongyi-markdown',
        '#\\:r4e\\: div.viewResults-D_wP0H .tongyi-markdown',
        'div[class*="viewResults"] .tongyi-markdown',
        '.viewResults-D_wP0H .tongyi-markdown'
      ],
      customCSS: ``,
      newConversationUrl: 'https://chat.qwen.ai/',
      researchMode: {
        steps: [
          { selector: ['button[aria-label="研究"]', 'button.relative', 'button[data-log-name="tool_bar"][data-log-params*="deepResearch"]', 'button[data-log-params*="deepResearch"]', 'button.tagBtn-OADWVI'], text: ['深度研究', '研究'], delay: 500 }
        ],
        cancelSteps: [
          { selector: ['button[aria-label="研究"]', 'button.selected-OsA38F[data-log-params*="deepResearch"] div.flex.items-center.justify-center.overflow-hidden'], delay: 200, optional: true }
        ]
      },
      imageGeneration: {
        steps: [
          { selector: ['button[data-log-name="tool_bar"]', 'button.tagBtn-OADWVI', 'button[data-component-type="tool-item"]'], text: ['生图', '画图', '图像生成', 'Image'], delay: 500 }
        ],
        cancelSteps: [
          { selector: ['button.selected-OsA38F div.flex.items-center.justify-center.overflow-hidden', 'button[data-log-name="tool_bar"] div.flex.items-center.justify-center.overflow-hidden'], delay: 200, exact: true, optional: true }
        ]
      }
    },
    kimi: {
      textarea: [
        'textarea[placeholder*="输入"]',
        '.input-area textarea',
        'textarea',
        '[contenteditable="true"]'
      ],
      sendButton: [
        'button[aria-label*="发送"]',
        '.send-button',
        'button[type="submit"]',
        '[data-testid="send"]'
      ],
      messageContainer: [
        '.segment-container .segment-content-box .markdown',
        '.segment-container .markdown-container .markdown',
        '.segment-container .markdown',
        '.markdown-container .markdown',
        '.markdown-body',
        '.chat-message',
        '.message-content'
      ],
      customCSS: ``,
      newConversationUrl: 'https://www.kimi.com/',
      imageGeneration: {
        steps: [
          { selector: ['button', '[role="button"]'], text: ['生图', '画图', '图像生成', 'Image'], delay: 500 }
        ],
        cancelSteps: [
          { selector: ['button[aria-label*="删除"]', 'button[aria-label*="remove"]'], delay: 200, optional: true }
        ]
      }
    },
    doubao: {
      textarea: [
        'div[data-testid="chat_input_input"][contenteditable="true"]',
        '[data-testid="chat_input_input"][contenteditable="true"]',
        'div[role="textbox"][data-testid="chat_input_input"]',
        'textarea[data-testid="chat_input_input"]',
        'textarea.semi-input-textarea',
        'textarea.semi-input-textarea-autosize',
        'textarea[placeholder*="发消息或输入"]',
        'textarea[placeholder*="输入"]',
        '.chat-textarea',
        'textarea',
        '[contenteditable="true"]'
      ],
      sendButton: [
        'button[data-testid="chat_input_send_button"]',
        '#flow-end-msg-send',
        'button[aria-label="发送"]',
        'button[aria-label*="发送"]',
        '.send-btn',
        'button[type="submit"]'
      ],
      messageContainer: [
        '[data-streaming]',
        '[data-streaming] .md-box-root',
        '.md-box-root',
        '[data-testid="message_content"] [data-testid="message_text_content"]',
        '[data-testid="message_text_content"]',
        '.flow-markdown-body',
        '.mdbox-theme-next',
        '.markdown-body',
        '.chat-message',
        '.message-content'
      ],
      reportContainer: [
        '#chat-route-layout > aside div.zone-container.editor-kit-container',
        '#chat-route-layout aside div.zone-container.editor-kit-container',
        'aside div.zone-container.editor-kit-container',
        'div.zone-container.editor-kit-container'
      ],
      customCSS: ``,
      newConversationUrl: 'https://www.doubao.com/chat/',
      researchMode: {
        steps: [
          { selector: ['button.skill-bar-button[data-component-type="skill-item"]', 'button[data-component-type="skill-item"][data-testid^="skill_bar_button_"]'], text: ['深入研究', '深度研究'], delay: 500 }
        ],
        cancelSteps: [
          { selector: ['[data-testid="skill_input_exit_button"]', 'div[data-testid="skill_input_exit_button"]'], text: ['深入研究', '深度研究'], delay: 200 }
        ]
      },
      imageGeneration: {
        steps: [
          { selector: ['button.skill-bar-button[data-component-type="skill-item"]', 'button[data-component-type="skill-item"][data-testid^="skill_bar_button_"]'], text: ['生图', '画图', '图像生成', 'Image'], delay: 500 }
        ],
        cancelSteps: [
          { selector: ['[data-testid="skill_input_exit_button"]', 'div[data-testid="skill_input_exit_button"]'], text: ['生图', '画图', '图像生成', 'Image'], delay: 200, optional: true }
        ]
      },
      imageDownload: {
        steps: [
          // 步骤1：hover 最新 image-box-grid 内的图片，触发 hover-actions-slot 浮层
          { selector: 'div.image-box-grid-EYaIcP img, div[class*="image-box-grid"] img', delay: 300, hover: true },
          // 步骤2：点浮层最后一个 action（下载）—— DOM 证实下载是最后一个 action-nxGadz
          { selector: 'div.hover-actions-slot-_hVW2k div.action-nxGadz:last-of-type, div[class*="hover-actions-slot"] div.action-nxGadz:last-of-type', delay: 300 }
        ]
      }
    },
    yuanbao: {
      textarea: [
        'textarea[placeholder*="输入"]',
        '.input-textarea',
        'textarea',
        '[contenteditable="true"]'
      ],
      sendButton: [
        'button[aria-label*="发送"]',
        '.send-button',
        'button[type="submit"]'
      ],
      messageContainer: [
        '.agent-chat__bubble--ai .hyc-common-markdown-style',
        '.agent-chat__bubble--ai .hyc-common-markdown',
        '.agent-chat__bubble--ai .hyc-content-md',
        '.hyc-common-markdown-style',
        '.response-text',
        '.markdown-body',
        '.message-content'
      ],
      customCSS: ``,
      newConversationUrl: 'https://yuanbao.tencent.com/chat',
      imageGeneration: {
        steps: [
          { selector: ['button', '[role="button"]', '[role="menuitem"]'], text: ['生图', '画图', '图像生成', 'Image'], delay: 500 }
        ],
        cancelSteps: [
          { selector: ['button[aria-label*="删除"]', 'button[aria-label*="remove"]'], delay: 200, optional: true }
        ]
      }
    },
    arena: {
      textarea: [
        'textarea[placeholder*="Message"]',
        'textarea[placeholder*="message"]',
        'textarea',
        '[contenteditable="true"]'
      ],
      sendButton: [
        'button[type="submit"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="send"]',
        'form button:last-child'
      ],
      messageContainer: [
        '.prose',
        '[class*="markdown"]',
        '.message-content',
        '[data-testid*="message"]',
        '.chat-message'
      ],
      customCSS: '',
      newConversationUrl: 'https://arena.ai/'
    },
    deepseek: {
      textarea: [
        '#chat-input',
        'textarea[placeholder*="DeepSeek"]',
        'textarea[placeholder*="发送"]',
        'textarea[placeholder*="Message"]',
        'textarea'
      ],
      sendButton: [
        '.ds-textarea-send-button',
        'div[class*="send-button"]',
        'button[class*="send-button"]',
        '#chat-input + button',
        '#chat-input ~ button'
      ],
      // DeepSeek 单条 AI 回复即一个 div.ds-markdown.ds-assistant-message-main-content
      // （内部直接含全部 p/h2/ul 段落），外层包 div.ds-message。
      // 抓取逻辑取"最后一个可见候选"——若保留宽泛的 [class*="markdown"] 兜底，
      // 正文之后的"思考过程"折叠块 / 推荐问题栏（class 含 markdown）会排在正文之后
      // 被当成末候选抓走，表现为只抓到最后一段。故去掉宽泛兜底，只留正文容器级。
      messageContainer: [
        'div.ds-message',
        '.ds-markdown.ds-assistant-message-main-content',
        'div.ds-markdown',
        '.ds-markdown'
      ],
      customCSS: ``,
      newConversationUrl: 'https://chat.deepseek.com/',
      researchMode: {
        steps: [
          { selector: ['button', '[role="button"]', 'div'], text: ['深度思考', 'Deep Thinking'], delay: 300 }
        ],
        cancelSteps: [
          { selector: ['button', '[role="button"]', 'div'], text: ['深度思考', 'Deep Thinking'], delay: 300 }
        ]
      }
    }
  }
}

/**
 * 获取选择器配置
 * 优先使用本地存储的配置，否则使用默认配置
 */
export async function getSelectors(): Promise<SelectorsConfig> {
  try {
    if (typeof window !== 'undefined' && window?.api) {
      const stored = await window.api.storeGet('selectors') as SelectorsConfig | undefined
      if (stored && stored.version >= defaultSelectors.version) {
        return stored
      }
    }
  } catch (error) {
    console.error('读取选择器配置失败:', error)
  }
  return defaultSelectors
}

/**
 * 保存选择器配置
 */
export async function saveSelectors(config: SelectorsConfig): Promise<void> {
  if (typeof window !== 'undefined' && window?.api) {
    await window.api.storeSet('selectors', config)
  }
}
