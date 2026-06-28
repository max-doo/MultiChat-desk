/**
 * HTML 转 Markdown 工具
 * 用于将 AI 平台返回的 HTML 内容转换为 Markdown 格式
 * 
 * 注意：此函数会被序列化为字符串注入到 webview 中执行，
 * 因此不能使用外部依赖，必须是纯 JavaScript 实现
 */

/**
 * 生成 HTML 转 Markdown 的注入脚本
 * @returns 可以在 webview 中执行的 JavaScript 函数字符串
 */
export function getHtmlToMarkdownScript(): string {
  return `
    /**
     * 将 HTML 元素转换为 Markdown 格式
     * @param {HTMLElement} element - 要转换的 HTML 元素
     * @returns {string} Markdown 格式的文本
     */
    function htmlToMarkdown(element) {
      if (!element) return '';
      
      let result = '';
      
      /**
       * 处理 Gemini 引用链接（browse-web-item）
       * @param {HTMLElement} node - browse-web-item 元素
       * @returns {string} Markdown 格式的引用链接
       */
      function processGeminiSourceItem(node) {
        const link = node.querySelector('a[href]');
        if (!link) return '';
        
        const href = link.getAttribute('href') || '';
        if (!href || href.startsWith('javascript:')) return '';
        
        // 获取网站域名
        const displayName = node.querySelector('.display-name, [data-test-id="domain-name"]');
        const domainText = displayName ? displayName.textContent.trim() : '';
        
        // 获取文章标题
        const subTitle = node.querySelector('.sub-title, [data-test-id="sub-title"]');
        const titleText = subTitle ? subTitle.textContent.trim() : '';
        
        // 组合链接文本
        const linkText = titleText || domainText || href;
        
        return '- [' + linkText + '](' + href + ')' + (domainText && titleText ? ' - ' + domainText : '') + '\\n';
      }
      
      /**
       * 处理 Gemini 引用来源列表（source-list）
       * @param {HTMLElement} node - source-list 容器元素
       * @returns {string} Markdown 格式的引用来源列表
       */
      function processGeminiSourceList(node) {
        const items = node.querySelectorAll('browse-web-item');
        if (items.length === 0) return '';
        
        let result = '\\n\\n---\\n\\n**📚 参考来源：**\\n\\n';
        items.forEach((item, index) => {
          const itemContent = processGeminiSourceItem(item);
          if (itemContent) {
            result += itemContent;
          }
        });
        return result + '\\n';
      }
      
      /**
       * 递归处理 DOM 节点
       * @param {Node} node - 当前处理的节点
       * @param {number} listDepth - 列表嵌套深度
       * @param {string|null} listType - 列表类型 ('ol' | 'ul' | null)
       * @param {number} listIndex - 有序列表的当前索引
       * @returns {string} 转换后的 Markdown 文本
       */
      function processNode(node, listDepth = 0, listType = null, listIndex = 1) {
        // 文本节点：直接返回文本内容
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent || '';
        }

        if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
          let fragmentContent = '';
          const fragmentChildren = Array.from(node.childNodes);
          for (const child of fragmentChildren) {
            fragmentContent += processNode(child, listDepth, listType, listIndex);
          }
          return fragmentContent;
        }
        
        // 非元素节点：跳过
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return '';
        }
        
        const tagName = node.tagName.toLowerCase();
        
        // ========== Gemini 特殊元素处理 ==========
        // 处理 Gemini 引用来源列表
        if (node.classList && node.classList.contains('source-list')) {
          return processGeminiSourceList(node);
        }
        
        // 处理单个 Gemini 引用项（如果不在 source-list 内单独出现）
        if (tagName === 'browse-web-item') {
          return processGeminiSourceItem(node);
        }

        if (
          tagName === 'style' ||
          tagName === 'script' ||
          tagName === 'noscript' ||
          tagName === 'head' ||
          tagName === 'meta' ||
          tagName === 'link' ||
          tagName === 'title'
        ) {
          return '';
        }
        
        let content = '';
        
        // 递归处理子节点
        const children = Array.from(node.childNodes);
        let childIndex = 1;
        for (const child of children) {
          const childTag = child.tagName ? child.tagName.toLowerCase() : '';
          if (childTag === 'li') {
            // 列表项需要传递列表类型和索引
            content += processNode(child, listDepth, tagName === 'ol' ? 'ol' : 'ul', childIndex);
            childIndex++;
          } else {
            content += processNode(child, listDepth, listType, listIndex);
          }
        }
        
        // 根据标签类型转换为对应的 Markdown 格式
        if (tagName === 'div' && node.classList && node.classList.contains('ace-line')) {
          const line = content.replace(/[\\u200B\\uFEFF]/g, '').trim();
          if (!line) return '';

          if (node.classList.contains('heading-h1')) return '\\n# ' + line + '\\n\\n';
          if (node.classList.contains('heading-h2')) return '\\n## ' + line + '\\n\\n';
          if (node.classList.contains('heading-h3')) return '\\n### ' + line + '\\n\\n';
          if (node.classList.contains('heading-h4')) return '\\n#### ' + line + '\\n\\n';
          if (node.classList.contains('heading-h5')) return '\\n##### ' + line + '\\n\\n';
          if (node.classList.contains('heading-h6')) return '\\n###### ' + line + '\\n\\n';

          return line + '\\n\\n';
        }

        switch (tagName) {
          // ========== 标题 ==========
          case 'h1':
            return '\\n# ' + content.trim() + '\\n\\n';
          case 'h2':
            return '\\n## ' + content.trim() + '\\n\\n';
          case 'h3':
            return '\\n### ' + content.trim() + '\\n\\n';
          case 'h4':
            return '\\n#### ' + content.trim() + '\\n\\n';
          case 'h5':
            return '\\n##### ' + content.trim() + '\\n\\n';
          case 'h6':
            return '\\n###### ' + content.trim() + '\\n\\n';
          
          // ========== 段落和换行 ==========
          case 'p':
            return content.trim() + '\\n\\n';
          case 'br':
            return '\\n';
          
          // ========== 文本格式 ==========
          case 'strong':
          case 'b':
            return '**' + content + '**';
          case 'em':
          case 'i':
            return '*' + content + '*';
          case 's':
          case 'del':
          case 'strike':
            return '~~' + content + '~~';
          case 'u':
            // Markdown 不支持下划线，使用 HTML 标签
            return '<u>' + content + '</u>';
          case 'mark':
            // Markdown 不支持高亮，使用 HTML 标签
            return '<mark>' + content + '</mark>';
          case 'sub':
            return '<sub>' + content + '</sub>';
          case 'sup':
            return '<sup>' + content + '</sup>';
          
          // ========== 代码 ==========
          case 'code':
            // 如果父元素是 pre，不添加反引号（由 pre 处理代码块）
            if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') {
              return content;
            }
            // 行内代码
            return '\`' + content + '\`';
          
          case 'pre':
            // 代码块
            const codeElement = node.querySelector('code');
            const codeContent = codeElement ? (codeElement.textContent || '') : content;
            // 尝试从 class 中提取语言类型
            let language = '';
            if (codeElement) {
              const className = codeElement.className || '';
              const langMatch = className.match(/language-(\\w+)|lang-(\\w+)|(\\w+)-code/);
              if (langMatch) {
                language = langMatch[1] || langMatch[2] || langMatch[3] || '';
              }
            }
            return '\\n\`\`\`' + language + '\\n' + codeContent.trim() + '\\n\`\`\`\\n\\n';
          
          case 'kbd':
            return '\`' + content + '\`';
          
          // ========== 引用 ==========
          case 'blockquote':
            const lines = content.trim().split('\\n');
            return '\\n' + lines.map(line => '> ' + line).join('\\n') + '\\n\\n';
          
          // ========== 列表 ==========
          case 'ul':
            return '\\n' + content + '\\n';
          case 'ol':
            return '\\n' + content + '\\n';
          case 'li':
            const indent = '  '.repeat(listDepth);
            const bullet = listType === 'ol' ? (listIndex + '. ') : '- ';
            return indent + bullet + content.trim() + '\\n';
          
          // ========== 链接和图片 ==========
          case 'a':
            const href = node.getAttribute('href') || '';
            const linkText = content.trim() || href;
            // 跳过空链接和 javascript: 链接
            if (!href || href.startsWith('javascript:')) {
              return linkText;
            }
            return '[' + linkText + '](' + href + ')';
          
          case 'img':
            const src = node.getAttribute('src') || '';
            const alt = node.getAttribute('alt') || '图片';
            if (!src) return '';
            return '![' + alt + '](' + src + ')';

          case 'iframe':
          case 'frame':
            try {
              const srcdoc = node.getAttribute && node.getAttribute('srcdoc');
              if (srcdoc) {
                const temp = document.createElement('div');
                temp.innerHTML = srcdoc;
                const md = htmlToMarkdown(temp);
                if (md && md.trim()) return md.trim() + '\\n\\n';
              }
            } catch {}

            try {
              const doc = node.contentDocument || (node.contentWindow && node.contentWindow.document);
              if (doc) {
                const html = (doc.body && doc.body.innerHTML) || (doc.documentElement && doc.documentElement.outerHTML) || '';
                if (html) {
                  const temp = document.createElement('div');
                  temp.innerHTML = html;
                  const md = htmlToMarkdown(temp);
                  if (md && md.trim()) return md.trim() + '\\n\\n';
                }
              }
            } catch {}

            return '';
          
          // ========== 分隔线 ==========
          case 'hr':
            return '\\n---\\n\\n';
          
          // ========== 表格 ==========
          case 'table':
            // 检查表格是否有 thead，如果没有，需要自动生成分隔行
            const hasHead = node.querySelector('thead');
            let tableContent = content.trim();
            if (!hasHead && tableContent) {
              // 没有 thead，在第一行后插入分隔行
              const firstLineEnd = tableContent.indexOf('\\n');
              if (firstLineEnd > 0) {
                const firstLine = tableContent.substring(0, firstLineEnd);
                const rest = tableContent.substring(firstLineEnd + 1);
                const colCount = (firstLine.match(/\\|/g) || []).length - 1;
                const sep = '|' + ' --- |'.repeat(Math.max(colCount, 1));
                tableContent = firstLine + '\\n' + sep + '\\n' + rest;
              }
            }
            return '\\n' + tableContent + '\\n';
          case 'thead':
            // 在 thead 后添加表头分隔行
            const headerRow = content.trim();
            if (headerRow) {
              const columnCount = (headerRow.match(/\\|/g) || []).length - 1;
              const separator = '|' + ' --- |'.repeat(Math.max(columnCount, 1));
              return headerRow + '\\n' + separator + '\\n';
            }
            return content;
          case 'tbody':
            return content;
          case 'tr':
            // 每行末尾需要换行符
            const cells = content.trim();
            // 移除末尾多余的 ' | '
            const cleanedCells = cells.endsWith(' | ') ? cells.slice(0, -3) : cells;
            return '| ' + cleanedCells + ' |\\n';
          case 'th':
          case 'td':
            return content.trim() + ' | ';
          
          // ========== 定义列表 ==========
          case 'dl':
            return '\\n' + content + '\\n';
          case 'dt':
            return '**' + content.trim() + '**\\n';
          case 'dd':
            return ': ' + content.trim() + '\\n\\n';
          
          // ========== 容器元素（透传内容） ==========
          case 'div':
          case 'span':
          case 'section':
          case 'article':
          case 'main':
          case 'aside':
          case 'header':
          case 'footer':
          case 'nav':
          case 'figure':
          case 'figcaption':
          case 'details':
          case 'summary':
            return content;
          
          // ========== 其他元素 ==========
          default:
            return content;
        }
      }
      
      result = processNode(element);
      
      // 清理格式
      // 1. 移除连续的空行（保留最多两个换行）
      result = result.replace(/\\n{3,}/g, '\\n\\n');
      // 1.5 移除零宽字符
      result = result.replace(/[\\u200B\\uFEFF]/g, '');
      // 2. 移除开头的空白
      result = result.replace(/^\\s+/, '');
      // 3. 移除末尾多余的空白
      result = result.replace(/\\s+$/, '');
      
      return result;
    }
  `
}

/**
 * 支持的 HTML 元素列表（用于文档说明）
 */
export const SUPPORTED_ELEMENTS = {
  headings: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  textFormatting: ['strong', 'b', 'em', 'i', 's', 'del', 'strike', 'u', 'mark', 'sub', 'sup'],
  code: ['code', 'pre', 'kbd'],
  lists: ['ul', 'ol', 'li', 'dl', 'dt', 'dd'],
  links: ['a', 'img'],
  blocks: ['p', 'br', 'hr', 'blockquote'],
  tables: ['table', 'thead', 'tbody', 'tr', 'th', 'td'],
  containers: ['div', 'span', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav', 'figure', 'figcaption', 'details', 'summary'],
  // Gemini 特定元素
  gemini: {
    sourceList: 'div.source-list',        // 引用来源列表容器
    sourceItem: 'browse-web-item',        // 单个引用项
    displayName: '.display-name',         // 网站域名
    subTitle: '.sub-title'                // 文章标题
  }
}

