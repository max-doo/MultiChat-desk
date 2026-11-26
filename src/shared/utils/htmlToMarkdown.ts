/**
 * HTML 转 Markdown 注入脚本。脚本被序列化后注入 webview 执行，
 * 因此不能引用外部依赖，必须是纯 JavaScript。
 */
export function getHtmlToMarkdownScript(): string {
  return `
    function htmlToMarkdown(element) {
      if (!element) return '';
      
      let result = '';
      
      // Gemini 引用链接（browse-web-item）
      function processGeminiSourceItem(node) {
        const link = node.querySelector('a[href]');
        if (!link) return '';
        
        const href = link.getAttribute('href') || '';
        if (!href || href.startsWith('javascript:')) return '';
        
        const displayName = node.querySelector('.display-name, [data-test-id="domain-name"]');
        const domainText = displayName ? displayName.textContent.trim() : '';
        
        const subTitle = node.querySelector('.sub-title, [data-test-id="sub-title"]');
        const titleText = subTitle ? subTitle.textContent.trim() : '';
        
        const linkText = titleText || domainText || href;
        
        return '- [' + linkText + '](' + href + ')' + (domainText && titleText ? ' - ' + domainText : '') + '\\n';
      }
      
      // Gemini 引用来源列表（source-list）
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
      
      function processNode(node, listDepth = 0, listType = null, listIndex = 1) {
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
        
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return '';
        }
        
        const tagName = node.tagName.toLowerCase();
        
        if (node.classList && node.classList.contains('source-list')) {
          return processGeminiSourceList(node);
        }
        
        // 引用项也可能脱离 source-list 单独出现
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

        // 千问回复末尾常带视频/笔记卡片(.qk-md-has-multi-modal, [data-card-type])
        // 这些卡片的标题/作者名会污染正文，跳过整块。
        if (node.classList && (
          node.classList.contains('qk-md-has-multi-modal') ||
          node.getAttribute && node.getAttribute('data-card-type')
        )) {
          return '';
        }

        // 正文内引用上标形如 <span data-index="6" class="options-item-...">6</span>
        // 转成 [6] 嵌入正文，保留引用语义。来源详情由 webviewScripts 的来源脚本追加。
        if (node.getAttribute && node.getAttribute('data-index') &&
            node.classList && (node.classList.contains('options-item') || (node.className && String(node.className).indexOf('options-item') !== -1))) {
          const idx = node.getAttribute('data-index');
          if (idx) return '[' + idx + ']';
        }

        // .reference-wrap 是文末"9篇来源"汇总卡片，其文字会与下方来源列表重复，
        // 跳过整块；真实来源由 webviewScripts 从悬停 tooltip 单独提取。
        if (node.classList && (
          node.classList.contains('reference-wrap') ||
          (node.className && String(node.className).indexOf('reference-wrap') !== -1)
        )) {
          return '';
        }
        
        let content = '';
        
        const children = Array.from(node.childNodes);
        let childIndex = 1;
        for (const child of children) {
          const childTag = child.tagName ? child.tagName.toLowerCase() : '';
          if (childTag === 'li') {
            content += processNode(child, listDepth, tagName === 'ol' ? 'ol' : 'ul', childIndex);
            childIndex++;
          } else {
            content += processNode(child, listDepth, listType, listIndex);
          }
        }
        
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
          
          case 'p':
            return content.trim() + '\\n\\n';
          case 'br':
            return '\\n';
          
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
          
          case 'code':
            // 如果父元素是 pre，不添加反引号（由 pre 处理代码块）
            if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') {
              return content;
            }
            return '\`' + content + '\`';
          
          case 'pre':
            const codeElement = node.querySelector('code');
            const codeContent = codeElement ? (codeElement.textContent || '') : content;
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
          
          case 'blockquote':
            const lines = content.trim().split('\\n');
            return '\\n' + lines.map(line => '> ' + line).join('\\n') + '\\n\\n';
          
          case 'ul':
            return '\\n' + content + '\\n';
          case 'ol':
            return '\\n' + content + '\\n';
          case 'li':
            const indent = '  '.repeat(listDepth);
            const bullet = listType === 'ol' ? (listIndex + '. ') : '- ';
            return indent + bullet + content.trim() + '\\n';
          
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

            // AI 回复里常见 <img> 形式的表情/状态/徽标图标，
            // 转成 markdown 会污染正文。判定依据：class/role/尺寸/alt 特征。
            const imgClass = String(node.className || '') + ' ' + String(node.getAttribute('class') || '');
            const imgAlt = String(alt);
            const w = parseInt(node.getAttribute('width') || '0', 10);
            const h = parseInt(node.getAttribute('height') || '0', 10);
            const role = String(node.getAttribute('role') || '');
            const ariaHidden = node.getAttribute('aria-hidden');
            const dataEmoji = node.getAttribute('data-emoji') || node.getAttribute('data-emoticon') || '';

            const isIcon =
              /icon|emoji|emoticon|avatar|badge|smiley|sticker/i.test(imgClass) ||
              role === 'presentation' ||
              ariaHidden === 'true' ||
              (w > 0 && w <= 32) || (h > 0 && h <= 32) ||
              // SVG dataUrl 基本都是图标（照片/截图几乎不会用 svg）
              src.startsWith('data:image/svg') ||
              !!dataEmoji;

            if (isIcon) {
              // emoji 图标保留 alt 文字（通常是 emoji 字符本身），其余装饰图直接丢
              const isEmojiChar = imgAlt && imgAlt.length <= 8 && /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(imgAlt);
              if (isEmojiChar || dataEmoji) {
                return imgAlt || dataEmoji;
              }
              return '';
            }

            return '![' + imgAlt + '](' + src + ')';

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
          
          case 'hr':
            return '\\n---\\n\\n';
          
          case 'table':
            // 无 thead 时自动生成分隔行
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
            const cells = content.trim();
            // td/th 已自带 ' | ' 收尾，tr 只补行首管道，避免结尾重复追加 ' |' 产生空列
            return '| ' + cells + '\\n';
          case 'th':
          case 'td':
            return content.trim() + ' | ';
          
          case 'dl':
            return '\\n' + content + '\\n';
          case 'dt':
            return '**' + content.trim() + '**\\n';
          case 'dd':
            return ': ' + content.trim() + '\\n\\n';
          
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
          
          default:
            return content;
        }
      }
      
      result = processNode(element);
      
      result = result.replace(/\\n{3,}/g, '\\n\\n');
      result = result.replace(/[\\u200B\\uFEFF]/g, '');
      result = result.replace(/^\\s+/, '');
      result = result.replace(/\\s+$/, '');
      
      return result;
    }
  `
}

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

