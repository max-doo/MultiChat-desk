/**
 * AI 平台选择器配置
 * 用于定位各平台的输入框、发送按钮等 DOM 元素
 */

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
  // Deep Research mode configuration
  researchMode?: {
    // Steps to enable Deep Research
    steps: Array<{
      selector: string | string[]
      text?: string | string[] // Text to match (partial match, can be array of strings)
      delay?: number // Delay after action in ms (default: 500)
      exact?: boolean
      optional?: boolean
      countsAsSuccess?: boolean
    }>
    cancelSteps?: Array<{
      selector: string | string[]
      text?: string | string[]
      delay?: number
      exact?: boolean
      optional?: boolean
      countsAsSuccess?: boolean
    }>
    // Backward compatibility (optional, can be removed if all updated)
    button?: string
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
  version: 8,
  lastUpdated: new Date().toISOString().split('T')[0],
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
      customCSS: `
        nav[aria-label*="Chat history"] { display: none !important; }
        [class*="sidebar"] { display: none !important; }
        .xl\\:pl-\\[260px\\] { padding-left: 0 !important; }
      `,
      researchMode: {
        steps: [
          { selector: '[data-testid="composer-plus-btn"], #composer-plus-btn, button.composer-btn', delay: 1000 },
          { selector: 'div[role="menuitemradio"]', text: ['Deep Research', '深度研究'], delay: 500 }
        ],
        cancelSteps: [
          { selector: '[class*="__composer-pill-remove"]', delay: 200 }
        ]
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
      researchMode: {
        steps: [
          // 宽屏：直接点击 radio 按钮切换到研究模式
          { selector: 'button[role="radio"][value="research"]:not([aria-disabled="true"])', delay: 300, optional: true },
          // 窄屏：点击包含"研究"文字的按钮（研究按钮有 border class，来源按钮没有）
          { selector: 'button.border.rounded-lg.h-8:not([aria-haspopup])', text: '研究', delay: 300, optional: true },
          // 从下拉菜单选择研究选项（如果有菜单出现）
          { selector: '[role="menuitemradio"][value="research"], [role="menuitemradio"][data-value="research"], [role="menuitem"][data-value="research"], [role="menuitemradio"][aria-label*="研究"], [role="menuitemradio"][aria-label*="Research"], [role="menuitem"][aria-label*="研究"], [role="menuitem"][aria-label*="Research"]', delay: 300, optional: true }
        ],
        cancelSteps: [
          // 宽屏：直接点击 radio 按钮切换回搜索模式
          { selector: 'button[role="radio"][value="search"]:not([aria-disabled="true"])', delay: 300, optional: true },
          // 窄屏：点击包含"搜索"文字的按钮
          { selector: 'button.border.rounded-lg.h-8:not([aria-haspopup])', text: '搜索', delay: 300, optional: true },
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
      `
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
      researchMode: {
        steps: [
          { selector: ['button', '[role="button"]', '[role="menuitem"]', '[role="menuitemradio"]', '[role="tab"]'], text: ['深度研究', '联网研究', '研究模式', 'Deep Research', 'Research'], delay: 700 }
        ],
        cancelSteps: [
          { selector: ['button', '[role="button"]', '[role="menuitem"]', '[role="menuitemradio"]', '[role="tab"]'], text: ['深度研究', '联网研究', '研究模式', 'Deep Research', 'Research'], delay: 300 }
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
      customCSS: ``
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
      researchMode: {
        steps: [
          { selector: 'button.toolbox-drawer-button', delay: 500 },
          { selector: 'button.toolbox-drawer-item-list-button', text: 'Deep Research', delay: 500 }
        ],
        cancelSteps: [
          { selector: 'button.toolbox-drawer-item-deselect-button', text: 'Deep Research', delay: 200 }
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
      researchMode: {
        steps: [
          { selector: 'button', text: 'DeepSearch', delay: 500 }
        ],
        cancelSteps: [
          { selector: 'button[aria-label*="删除"]', delay: 200 }
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
      messageContainer: [
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
      researchMode: {
        steps: [
          { selector: ['button[data-log-name="tool_bar"][data-log-params*="deepResearch"]', 'button[data-log-params*="deepResearch"]', 'button.tagBtn-OADWVI'], text: '深度研究', delay: 500 }
        ],
        cancelSteps: [
          { selector: 'button.selected-OsA38F[data-log-params*="deepResearch"] div.flex.items-center.justify-center.overflow-hidden', delay: 200, exact: true }
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
      customCSS: ``
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
      researchMode: {
        steps: [
          { selector: ['button.skill-bar-button[data-component-type="skill-item"]', 'button[data-component-type="skill-item"][data-testid^="skill_bar_button_"]'], text: ['深入研究', '深度研究'], delay: 500 }
        ],
        cancelSteps: [
          { selector: ['[data-testid="skill_input_exit_button"]', 'div[data-testid="skill_input_exit_button"]'], text: ['深入研究', '深度研究'], delay: 200 }
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
      customCSS: ``
    }
  }
}

/**
 * 获取选择器配置
 * 优先使用本地存储的配置，否则使用默认配置
 */
export async function getSelectors(): Promise<SelectorsConfig> {
  try {
    const stored = await window.api.storeGet('selectors') as SelectorsConfig | undefined
    if (stored && stored.version >= defaultSelectors.version) {
      return stored
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
  await window.api.storeSet('selectors', config)
}
