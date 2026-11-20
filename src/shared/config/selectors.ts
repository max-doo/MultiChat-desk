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
  // 新：幂等守卫。selector 命中的元素 aria-pressed 已为期望值时跳过本步，
  // 用于"点击即取反"的开关按钮（如 qianwen.com 的"研究"），避免重复执行把状态翻回去。
  skipIfPressed?: string
  skipIfReleased?: string
}

/** 笔记快照按消息提取时使用的容器和角色标记。 */
export const noteMessageSelectors: Record<string, { messages: string; role: string; user?: string; assistant?: string }> = {
  'chatgpt.com': {
    messages: '[data-message-author-role="user"],[data-message-author-role="assistant"],[data-turn="user"],[data-turn="assistant"],[class~="group/user-message"],[data-content-search-unit-key$=":assistant"]',
    role: 'data-message-author-role',
    user: '[class~="group/user-message"]',
    assistant: '[data-content-search-unit-key$=":assistant"]'
  },
  'claude.ai': { messages: '[data-testid="user-message"],[data-testid="assistant-message"]', role: 'data-testid' },
  'gemini.google.com': { messages: 'user-query,model-response', role: 'tagName' },
  'www.doubao.com': { messages: '[data-role="user"],[data-role="assistant"]', role: 'data-role' }
}

/** 普通文字生成的停止控件；导图任务用作生成状态信号。 */
export const generationStopSelectors: Record<string, string[]> = {
  chatgpt: ['button[data-testid="stop-button"]', 'button[aria-label="Stop streaming"]', 'button[aria-label="停止流式传输"]'],
  claude: ['button[aria-label="Stop response"]', 'button[aria-label="停止回复"]'],
  gemini: ['button[aria-label="Stop response"]', 'button[aria-label="停止回答"]', 'button[aria-label="停止回复"]'],
  deepseek: ['button[aria-label="Stop"]', 'button[aria-label="停止"]']
}

/**
 * 登录墙/人机验证信号；不依赖用户保存的站点选择器（见 getPlatformSelectors 的整体覆盖语义）。
 * wall：人机验证容器、密码/手机号输入框，可见即视为鉴权墙（已登录页不会常驻）。
 * ctaText：页内登录/注册入口文案，仅在发送失败后用于归因——gemini/doubao 等游客可用平台
 *          同样常驻该入口，提前判墙会误伤（2026-11 隔离环境实测）。
 * signedInText：已登录才出现的登出入口，用于抵消 ctaText 命中。
 */
export const authWallSelectors = {
  wall: [
    'iframe[src*="captcha"]',
    'iframe[src*="challenge"]',
    '#challenge-form',
    '#challenge-running',
    '.cf-challenge',
    'input[type="password"]',
    'input[type="tel"]'
  ],
  /** 未登录页顶栏的登录/注册入口文案（实测 chatgpt/qwen/chatglm/grok 均为中文按钮）。 */
  ctaText: ['登录', '登入', '注册', '免费注册', 'Log in', 'Sign in', 'Sign up', 'Sign up for free'],
  /** 已登录才出现的账号入口，用于抵消 ctaText 命中（避免误伤已登录页的登出入口）。 */
  signedInText: ['退出登录', '登出', 'Log out', 'Sign out']
}

/**
 * 各平台登录态 cookie（只写名称，不写值）。命中任一即判定已登录。
 * 游客态同样会有一批指纹/统计 cookie，因此不能用"有 cookie"判断，必须按名单精确匹配。
 * 名单之外的平台返回"未知"，交由页面侧检测兜底。
 *
 * 名单只能收"游客态不出现"的 cookie。2026-11 隔离实测证伪过两个反例：
 * chatglm 游客态同样写 chatglm_token，yuanbao 游客态同样写 hy_user/hy_token，
 * 只按名字匹配会把游客判成已登录——这类平台改用 platformAuthCookieRules。
 */
export const platformAuthCookies: Record<string, string[]> = {
  chatgpt: ['__Secure-next-auth.session-token'],
  gemini: ['SID', '__Secure-1PSID', 'SAPISID'],
  doubao: ['sessionid', 'sid_tt', 'sid_guard'],
  grok: ['sso', 'sso-rw'],
  // 千问的登录凭证是 qianwen.com 的 SSO 票（自动化目标站也是 qianwen.com）。
  qwen: ['tongyi_sso_ticket'],
  // 文心一言没有自己的登录 cookie，凭证是百度账号体系的 BDUSS（写在 .baidu.com）。
  yiyan: ['BDUSS'],
  // 分片 cookie，实际名字是 arena-auth-prod-v1.0 / .1，按前缀匹配。
  arena: ['arena-auth-prod-v1']
}

/**
 * 游客态也会写同名 cookie 的平台：命中名字后还要看值才能定论。
 * jwtGuestFlag：JWT 载荷里出现该字段且为真即游客（chatglm 的 `is_guest`）；
 * valuePrefix：值以该前缀开头即游客（yuanbao 游客的 hy_user 是 `a_did_...`）。
 */
export const platformAuthCookieRules: Record<
  string,
  { names: string[]; jwtGuestFlag?: string; valuePrefix?: string }
> = {
  chatglm: { names: ['chatglm_token'], jwtGuestFlag: 'is_guest' },
  yuanbao: { names: ['hy_user'], valuePrefix: 'a_did_' }
}

/**
 * 限制 cookie 必须来自该域名后缀（去掉前导点后做后缀匹配）。
 * 实测 BDUSS 同时存在于 .baidu.com/.apollo.auto/.yoojia.com，只认百度域名下的那份。
 */
export const platformAuthCookieDomains: Record<string, string> = {
  yiyan: 'baidu.com'
}

/**
 * 游客态无法发送、必须登录的平台（2026-11 隔离环境逐个实测）。
 * 与 platformAuthCookies 的覆盖范围无关：cookie 判不出时，仍由页面侧检测兜底。
 */
export const loginRequiredPlatforms: string[] = ['deepseek', 'qwen', 'claude', 'grok']

/**
 * 凭证不在 cookie 而存在页面 localStorage 的平台（2026-11 在真实 persist:shared 实测）。
 * signedInKeys：键存在且非空即已登录；配置了它且未命中即游客。
 * signedOutMarkers：键存在即游客（站点显式写入的登出标记），优先级高于 signedInKeys。
 * 优先读已加载该 origin 的 WebContents；没有则临时加载一次（见 AuthStateService）。
 */
export const platformAuthStorage: Record<
  string,
  { origins: string[]; signedInKeys?: string[]; signedOutMarkers?: string[] }
> = {
  deepseek: { origins: ['https://chat.deepseek.com'], signedInKeys: ['userToken'] },
  // Kimi 的 cookie 只有 acw_tc/theme 等设备与偏好项，登录凭证是 localStorage 的 JWT。
  kimi: { origins: ['https://www.kimi.com'], signedInKeys: ['refresh_token'] }
}

/** 站点正文结构更新的补充候选；采集脚本同时使用，兼容本地保存的旧配置。 */
export const responseMessageSelectors: Record<string, string[]> = {
  'chatgpt.com': [
    '[data-testid="generated-image-gallery"]',
    'div[class*="MarkdownRoot-"]',
    '[data-message-author-role="assistant"]',
    '.markdown.prose',
    '.agent-turn .markdown'
  ]
}

/** 代码框的 DOM 可能只包含可见行；虚拟编辑器需读取完整文档模型。 */
export const mindmapCodeSelectors = {
  // 导图专用兜底，不依赖用户保存的旧站点选择器。
  messages: '[data-message-author-role="assistant"],[data-role="assistant"],[data-turn="assistant"],[data-testid="assistant-message"],model-response',
  editors: '.cm-editor',
  content: '.cm-content',
  nativeCode: 'pre code, pre',
  nativeContent: 'code',
  renderedMarkdown: 'ul,ol,h1,h2,h3,h4,h5,h6,blockquote,table,hr',
  replyBodies: { 'chat.deepseek.com': '.ds-markdown.ds-assistant-message-main-content' },
  excluded: 'textarea,input,[contenteditable="true"],[data-message-author-role="user"],[data-role="user"],[data-turn="user"],[data-testid="user-message"],user-query,.user-query',
  noise: 'button,nav,svg,script,style,textarea,input,[aria-hidden="true"],.sr-only'
} as const

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

/** 后台附件发送使用语义状态；无法确认上传完成时不提交请求。 */
export const fileUploadSelectors = {
  metadata: '[aria-label],[title],[data-file-name]',
  progress: 'progress,[role="progressbar"],[aria-busy="true"],[data-state="loading"],[data-uploading="true"]',
  ignored: 'textarea,input,[contenteditable="true"],[data-message-author-role],[data-role="assistant"],[data-role="user"],[data-turn="assistant"],[data-turn="user"],.ds-message',
  uploading: '上传中|正在上传|解析中|正在解析|处理中|正在处理|uploading|processing|parsing',
  failed: '上传失败|解析失败|不支持.*文件|文件.*不支持|文件过大|超过.*大小|upload failed|failed to upload|unsupported.*file|file too large'
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
  version: 20,
  lastUpdated: '2026-11-18',
  models: {
    chatgpt: {
      textarea: [
        'div.ProseMirror[contenteditable="true"]',
        '[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"]'
      ],
      sendButton: [
        'button[aria-label="发送"]',
        'button[aria-label="Send"]',
        'button[aria-label*="Send"]',
        '[data-testid="send-button"]'
      ],
      messageContainer: [
        ...responseMessageSelectors['chatgpt.com']
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
      researchMode: {
        steps: [
          // 2026-11 实测："+" 入口为 data-composer-navigation-target="add-context"（aria-label 本地化），
          // 菜单项是无 role 的 <button>（旧 UI 为 div[role=menuitemradio]），须给多候选
          { selector: [
            'button[data-composer-navigation-target="add-context"]',
            'button[aria-label="添加文件等内容"]',
            'button[aria-label*="Add files"]',
            '[data-testid="composer-plus-btn"]',
            '#composer-plus-btn',
            'button.composer-btn'
          ], delay: 1000, menuOpenerFallback: true },
          { selector: [
            'button',
            'div[role="menuitemradio"]',
            '[role="menuitem"]'
          ], regex: 'Deep\\s*Research|深度研究', wordBoundary: false, exclude: ['\\bSearch\\b', '搜索', '网页搜索'], delay: 500 }
        ],
        cancelSteps: [
          { selector: [
            '[class*="composer-pill-remove"]',
            '[class*="__composer-pill-remove"]',
            'button[aria-label*="删除"]',
            'button[aria-label*="Remove"]'
          ], delay: 200 }
        ]
      },
      imageGeneration: {
        steps: [
          { selector: [
            'button[data-composer-navigation-target="add-context"]',
            'button[aria-label="添加文件等内容"]',
            'button[aria-label*="Add files"]',
            '[data-testid="composer-plus-btn"]',
            '#composer-plus-btn',
            'button.composer-btn'
          ], delay: 1000, menuOpenerFallback: true },
          { selector: ['button', 'div[role="menuitemradio"]', 'div[role="menuitem"]'], text: ['创建图像', 'Create image', 'DALL-E', '图像生成', '生图'], delay: 500 }
        ],
        cancelSteps: [
          { selector: '[class*="__composer-pill-remove"], [class*="composer-pill-remove"]', delay: 200 }
        ]
      },
      imageDownload: {
        steps: [
          // 步骤1：点最新生图卡片，打开全屏预览
          { selector: [
            'button[aria-label^="已生成图像"]',
            'button[aria-label^="Generated image"]',
            'div[class*="imagegen-image"] img',
            'div.group\\/imagegen-image img',
            'img[id^="_r_"]'
          ], delay: 800 },
          // 步骤2：点预览 header 的"下载"按钮（新 UI 是"下载"，旧 UI 是"保存"）
          { selector: [
            'header button[aria-label="下载"]',
            'button[aria-label="下载"]',
            'header button[aria-label="Download"]',
            'button[aria-label="Download"]',
            'header[data-testid="fullscreen-shell-header"] button[aria-label="保存"]',
            'button[aria-label="保存"]',
            'button[aria-label="Save"]'
          ], delay: 300 }
        ],
        closePreviewSelector: 'button[aria-label="关闭查看器"], button[aria-label="Close viewer"], button[aria-label="关闭全屏显示"], button[aria-label="Close"], header[data-testid="fullscreen-shell-header"] button[aria-label="关闭全屏显示"]'
      }
    },
    perplexity: {
      textarea: [
        'div[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"][data-lexical-editor]',
        '#ask-input',
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
          // 2026-11 实测：无 role=radio；入口为 "+" 菜单（role=listbox）→ div[role=option]"深度研究"
          { selector: [
            'button[aria-label="添加文件、插件等"]',
            'button[aria-label*="Add files"]',
            'button[aria-label*="插件"]',
            'button[aria-expanded][type="button"]'
          ], delay: 500, menuOpenerFallback: true },
          { selector: [
            'div[role="option"]',
            '[role="menuitem"]',
            'button'
          ], regex: '深度研究|Deep\\s*Research', wordBoundary: false, exclude: ['\\bSearch\\b', '搜索'], delay: 500 }
        ],
        cancelSteps: [
          // 模式切换组为 aria-pressed pill（搜索/Computer…），点回"搜索"即退出研究态
          { selector: [
            'button[aria-pressed][aria-label="搜索"]',
            'button[aria-pressed][aria-label*="Search"]',
            'button[aria-label="搜索"]'
          ], delay: 300, optional: true }
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
      },
      imageDownload: {
        steps: [
          // 一步：点最新 AI 回复消息底部 action bar 的下载图标（cos-icon-download，无需开预览）
          { selector: [
            'i.cos-icon-download',
            '[class*="cos-icon-download"]',
            'button[class*="cos-icon-download"]'
          ], delay: 300 }
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
          // 2026-11 实测：工具入口改为 aria-label 图标钮，研究项藏在第二层"更多工具"下
          { selector: [
            'button[aria-label="上传和工具"]',
            'button[aria-label="Tools"]',
            'button[aria-label*="工具"]',
            'button.toolbox-drawer-button'
          ], delay: 500, menuOpenerFallback: true },
          // 若 Deep Research 已在第一级可见则跳过"更多工具"展开步
          { selector: ['button.mat-mdc-list-item', 'mat-list-item button', '[role="menuitem"]'], text: ['更多工具', 'More tools', 'Tools'], delay: 400, optional: true },
          { selector: ['toolbox-drawer-item button.mat-mdc-list-item', 'button.mat-mdc-list-item', 'mat-list-item button', '[role="menuitem"]'], text: 'Deep Research', delay: 500 }
        ],
        cancelSteps: [
          { selector: ['toolbox-drawer-item button.mat-mdc-list-item', 'button.mat-mdc-list-item', 'button.toolbox-drawer-item-deselect-button'], text: 'Deep Research', delay: 200 }
        ]
      },
      imageGeneration: {
        steps: [
          { selector: [
            'button[aria-label="上传和工具"]',
            'button[aria-label="Tools"]',
            'button[aria-label*="工具"]',
            'button.toolbox-drawer-button'
          ], delay: 500, menuOpenerFallback: true },
          { selector: [
            'toolbox-drawer-item button.mat-mdc-list-item',
            'button.mat-mdc-list-item',
            'mat-list-item button',
            'mat-option',
            '[role="option"]',
            '[role="menuitem"]',
            'cdk-overlay-pane [class*="item"]',
            '.mat-mdc-menu-panel [class*="item"]'
          ], text: ['制作图片', 'Imagen', 'Image generation', '图像生成', '生图'], delay: 500 }
        ],
        cancelSteps: [
          { selector: ['toolbox-drawer-item button.mat-mdc-list-item', 'button.mat-mdc-list-item', 'button.toolbox-drawer-item-deselect-button'], text: ['制作图片', 'Imagen', 'Image generation', '图像生成', '生图'], delay: 200 }
        ]
      },
      imageDownload: {
        steps: [
          // 点"下载完整尺寸的图片"按钮（按钮常驻 DOM，无需 hover；中英文 + tag 兜底）
          { selector: [
            'button[aria-label="下载完整尺寸的图片"]',
            'button[aria-label="Download full-size image"]',
            'button[aria-label="Download full size image"]',
            'download-generated-image-button button',
            '[data-test-id="download-generated-image"]'
          ], delay: 300 }
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
          // 2026-11 实测：未登录态无 DeepSearch 入口（模型菜单仅 Fast/Build/Auto/Expert/Heavy，
          // "+"→技能子菜单仅文件技能）；若登录后出现独立按钮则按 data-slot/button+文本命中
          { selector: 'button[data-slot="button"], button', text: ['DeepSearch', 'DeeperSearch', '深度搜索'], delay: 500 }
        ],
        cancelSteps: [
          { selector: 'button[data-slot="button"], button', text: ['DeepSearch', 'DeeperSearch'], delay: 200, optional: true }
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
      },
      imageDownload: {
        steps: [
          // 一步：点生图旁的"下载"按钮（实测：aria-label="下载"+data-icon-button，直接触发下载）
          { selector: [
            'button[aria-label="下载"]',
            'button[aria-label="Download"]',
            'button[data-icon-button][aria-label*="下载"]',
            'button[data-icon-button][aria-label*="Download"]'
          ], delay: 300 }
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
        '#qianwen-layout-right-panel iframe#deep-research-iframe',
        'iframe#deep-research-iframe',
        '#pc-report-container',
        '#qk-markdown-react',
        '.markdown-text-container',
        '[class*="pc-report-container"]',
        '[class*="pc-report-wrap"]'
      ],
      customCSS: ``,
      // 千问国内站：与 models 配置的登录入口、本平台选择器（#qianwen-layout-right-panel、
      // #qk-markdown-react、.tongyi-markdown）同源。chat.qwen.ai 是另一个产品，登录态与 DOM 都不通用。
      newConversationUrl: 'https://www.qianwen.com/',
      researchMode: {
        steps: [
          // 两个站点的入口形态不同，放在同一步按顺序探测：
          // ① chat.qwen.ai：div.mode-select-open[role=button]"选择模式"（非 button 元素）→ div[role=menuitem]"深入研究"；
          // ② qianwen.com：composer 内的"研究"开关按钮（aria-pressed 切换，点一次即开）。
          { selector: [
            'div.mode-select-open[role="button"]',
            '[role="button"][aria-label="选择模式"]',
            '[aria-label="选择模式"]',
            'button[aria-label="研究"]'
          ], delay: 500, menuOpenerFallback: true, skipIfPressed: 'true' },
          { selector: [
            'div[role="menuitem"]',
            '[role="menuitem"]',
            'button'
          ], regex: '深入研究|深度研究|Deep\\s*Research', wordBoundary: false, exclude: ['搜索', 'Search'], delay: 500, optional: true, skipIfPressed: 'true' }
        ],
        cancelSteps: [
          // 退出：chat.qwen.ai 重开菜单选"自动"；qianwen.com 再点一次"研究"开关（aria-pressed 取反）
          { selector: [
            'div.mode-select-open[role="button"]',
            '[role="button"][aria-label="选择模式"]',
            '[aria-label="选择模式"]',
            'button[aria-label="研究"]'
          ], delay: 300, menuOpenerFallback: true, optional: true, skipIfReleased: 'false' },
          { selector: ['div[role="menuitem"]'], regex: '自动|Auto', wordBoundary: false, delay: 200, optional: true, skipIfReleased: 'false' }
        ]
      },
      imageGeneration: {
        steps: [
          { selector: ['button[data-log-name="tool_bar"]', 'button.tagBtn-OADWVI', 'button[data-component-type="tool-item"]'], text: ['生图', '画图', '图像生成', 'Image'], delay: 500 }
        ],
        cancelSteps: [
          { selector: ['button.selected-OsA38F div.flex.items-center.justify-center.overflow-hidden', 'button[data-log-name="tool_bar"] div.flex.items-center.justify-center.overflow-hidden'], delay: 200, exact: true, optional: true }
        ]
      },
      imageDownload: {
        steps: [
          // 步骤1：hover 最新生图容器，触发 popMenu 浮层显示（实测：popMenuItem 默认 invisible，需 hover）
          { selector: [
            'div[class*="imageItem-"][class*="imageWrapper-"]',
            'div[class*="imageWrapper-"]:has(img[data-image-resource-id])',
            'img[data-image-resource-id]'
          ], delay: 500, hover: true },
          // 步骤2：点 popMenu 内含 downloadIcon 的项（实测：popMenuItem 内含 svg.downloadIcon-*）
          { selector: [
            'div[class*="popMenuItem"]:has(svg[class*="downloadIcon"])',
            'div[class*="popMenuItem"]:has(svg.downloadIcon)',
            'div[class*="popMenu-"] div[class*="popMenuItem-"]:nth-of-type(2)'
          ], delay: 300 }
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
        // 2026-11 实测：chat_input_input 元素仍在但 contenteditable/role=textbox 已移除；
        // 真实编辑器是 contenteditable + semi-input textarea 并存
        'textarea.semi-input-textarea',
        'textarea.semi-input-textarea-autosize',
        'textarea[data-testid="chat_input_input"]',
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
        '[data-testid="message_image_content"]',
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
      // 2026-11 实测：技能栏已下架"深入研究/深度研究"（含"更多技能"28 项内亦无），
      // 功能疑并入"工作"模式或整体移除 — researchMode 配置移除，--research 对该平台不应生效
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
          // 步骤1：点最新生图，打开右侧预览面板（图本身可点击，无需 hover）
          { selector: [
            '[data-testid="mdbox_image"]',
            '[data-testid="message_image_content"] img',
            '[class*="image-box-grid"] img'
          ], delay: 800 },
          // 步骤2：点预览面板右上角的"下载"按钮（data-testid 稳定标识）
          { selector: [
            '[data-testid="edit_image_download_button"]',
            'button[data-testid="edit_image_download_button"]'
          ], delay: 300 }
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
      // 2026-11 实测：composer 工具条上有独立深度研究钮，
      // data-application-id 为平台给的稳定语义钩子
      researchMode: {
        steps: [
          { selector: [
            'button[data-application-id="application_id_deep_research"]',
            'button[aria-label="深度研究"][data-application-id]',
            'button[aria-label="深度研究"]'
          ], delay: 500 }
        ],
        cancelSteps: [
          { selector: [
            'button[data-application-id="application_id_deep_research"][aria-pressed="true"]',
            'button[data-application-id="application_id_deep_research"]'
          ], delay: 200, optional: true }
        ]
      },
      imageGeneration: {
        steps: [
          { selector: ['button', '[role="button"]', '[role="menuitem"]'], text: ['生图', '画图', '图像生成', 'Image'], delay: 500 }
        ],
        cancelSteps: [
          { selector: ['button[aria-label*="删除"]', 'button[aria-label*="remove"]'], delay: 200, optional: true }
        ]
      },
      imageDownload: {
        steps: [
          // 步骤1：点最新生图（dic-card-item swiper），打开 photo-view 预览弹层
          { selector: [
            'img.dic-card-item__img',
            'div.dic-card-item img',
            '[class*="dic-card-item"] img'
          ], delay: 800 },
          // 步骤2：点预览 toolbar 的 download 按钮（aria-label="download" 小写英文 + hyc-photo-view 语义类名）
          { selector: [
            'button[aria-label="download"]',
            'button.hyc-photo-view-chrome-v2__btn--download',
            '[class*="hyc-photo-view"] button[aria-label="download"]'
          ], delay: 300 }
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
        // ⚠️ 语义：这是"深度思考"推理开关，不是联网 Deep Research；
        // 保留为平台语义映射，exact 防止误命中"联网搜索"等相邻开关
        steps: [
          { selector: ['button', '[role="button"]', 'div'], text: '深度思考', exact: true, delay: 300 }
        ],
        cancelSteps: [
          { selector: ['button', '[role="button"]', 'div'], text: '深度思考', exact: true, delay: 300 }
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

/**
 * 工作台「回复插入」按钮注入配置（per-platform）。
 *
 * 独立于 ModelSelector / SelectorsConfig 维护，不进 electron-store 版本迁移，
 * 因为这套选择器只服务 WorkbenchAiSidebar 的注入脚本，与消息抓取选择器职责不同。
 *
 * 判定优先级：
 *  1. replyItem 命中 → 每条回复一个容器，按钮挂到该容器内的 actionBar；
 *  2. messageRoot（整个消息流容器）+ replyItem 缺省 → 退化到「最后一条回复」模式；
 *  3. 全部缺省 → 通用回退：在 messageContainer 命中的容器尾部 createBar。
 */
export interface AssistantReplyConfig {
  /**
   * 「单条回复」容器选择器（优先）。命中的每个元素视为一条独立回复，
   * 按钮挂到其内部 actionBar。缺省时退化为「消息流容器 + 取最后一条」。
   */
  replyItem?: string[]
  /**
   * replyItem 命中的是「整轮」容器（含用户消息）时，用该选择器在容器内
   * 定位 AI 正文块；提取 Markdown 只取该块，避免把用户消息一并抓出。
   */
  contentItem?: string[]
  /**
   * replyItem 可能同时命中用户消息与 AI 回复（如豆包共用容器）时，
   * 用该选择器判断「这条命中的容器其实是用户消息」并跳过。
   */
  userItemMarker?: string[]
  /** 注入按钮外框边长 px，缺省 30。原生操作按钮偏大的平台（Gemini 36px）可调大。 */
  btnSize?: number
  /** 注入按钮内 SVG 图标边长 px，缺省 16。 */
  iconSize?: number
  /**
   * 「消息流容器」选择器（replyItem 缺省时使用）。命中的是包含全部对话的容器，
   * 脚本在其中定位最后一条可见回复。
   */
  messageRoot?: string[]
  /**
   * 在 replyItem（或最后一条回复）内部定位「底部操作区」的选择器，
   * 按钮追加到该容器末尾。缺省或全部未命中时按 createBar 处理。
   */
  actionBar?: string[]
  /**
   * true 时不查找 actionBar，改为在 replyItem 末尾新建 div.mc-action-bar。
   * 用于千问等无集中操作区的平台。
   */
  createBar?: boolean
  /**
   * actionBar 命中元素是 DIV 而非 BUTTON（如元宝）。注入按钮用 div[role=button]，
   * 点击用 dispatchEvent 合成 MouseEvent 冒泡触发，而非 .click()。
   */
  actionBarIsDiv?: boolean
}

export const assistantReplyConfigs: Record<string, AssistantReplyConfig> = {
  chatgpt: {
    // data-message-author-role 已失效；AI 回复容器是含 turn-action-controls 的 group，
    // 但用户气泡与 AI 回复同属一个轮次容器，需用 contentItem 只取 AI 正文块，
    // 否则提取 Markdown 会把用户消息一起抓出
    replyItem: ['div.group.flex.flex-col:has(div.turn-action-controls):not([class~="group/user-message"])'],
    contentItem: [
      '[data-chatgpt-search-unit-key*=":assistant"]',
      '[data-content-search-unit-key*=":assistant"]',
      'div[class*="MarkdownRoot"]'
    ],
    // 一轮里有两个 turn-action-controls：用户气泡行的（祖先 flex-row-reverse）
    // 和 AI 回复底部的（actionRow-xxx）。必须限定 actionRow，否则按钮挂到用户气泡下。
    actionBar: ['div.turn-action-controls[class*="actionRow"]', 'div[class*="actionRow-"][class*="turn-action-controls"]']
  },
  gemini: {
    replyItem: ['model-response', '[class*="model-response"]'],
    actionBar: ['div.buttons-container-v2', 'div[class*="buttons-container"]'],
    // 原生操作按钮 36x36、图标 ~20px，注入按钮要匹配才不会显得挤小
    btnSize: 34,
    iconSize: 18
  },
  deepseek: {
    // 结构：ds-message(AI回复,含think+正文) 与 div.ds-flex(底部操作栏,6个div.ds-icon)
    // 是兄弟节点，同属一个父容器。replyItem 须命中该父容器，actionBar 才能在
    // 其内找到底部操作栏；命中 ds-message 本身会错挂到 think 上方的 _5ab5d64（那是
    // "已思考"行的按钮组，非回复操作栏）。
    replyItem: ['div:has(> div.ds-message + div.ds-flex)'],
    contentItem: ['div.ds-markdown.ds-assistant-message-main-content', 'div[class*="ds-assistant-message-main-content"]'],
    // 底部操作栏 = ds-flex 内含 ≥2 个平级 div.ds-button 的行容器（_965abe9，hash 会失效）
    actionBar: ['div.ds-flex:has(> div.ds-button ~ div.ds-button)']
  },
  qwen: {
    // AI 回复容器是 message-select-wrapper-answer-*（区别于 ...-question-* 用户气泡）；
    // 千问无集中 actionBar，在回复容器末尾新建
    replyItem: ['div[class*="message-select-wrapper-answer"]'],
    createBar: true
  },
  doubao: {
    // 豆包用户消息与 AI 回复共用 w-full pl-14 且都含 message-action-bar；
    // 用户消息操作栏特有「编辑」按钮（message_action_edit），据此排除用户气泡。
    replyItem: ['div[class*="w-full pl-14"]:has(div[class*="message-action-bar"])'],
    userItemMarker: ['[data-testid="message_action_edit"]'],
    actionBar: ['div[class*="message-action-bar"] .message-action-button-main', 'div[class*="message-action-bar"]']
  },
  yuanbao: {
    // msgRoot 是整个消息流容器，单条回复在其中
    messageRoot: ['div.agent-chat__list'],
    // agent-chat__bubble 同时有 --human/--ai 变体，必须用 --ai 限定，
    // 否则用户气泡也会被当成回复挂按钮
    replyItem: ['div.agent-chat__list__item--ai', 'div[class*="agent-chat__list__item--ai"]'],
    // 真实操作行是 toolbar__right（flex row 单行，含复制/分享/更多 div[role=button]）；
    // conv--ai__toolbar 外层是 block 容器，直接命中会把按钮 prepend 到错误位置
    actionBar: ['div.agent-chat__toolbar__right', 'div[class*="agent-chat__toolbar__right"]'],
    actionBarIsDiv: true
  }
}
