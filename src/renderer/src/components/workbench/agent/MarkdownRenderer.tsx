import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy, Code2 } from 'lucide-react'
import { InlineFileCode } from './AttachmentChips'

interface MarkdownRendererProps {
  content: string
  /** 会话 cwd：inline-code 检测到工作区内真实路径时 chip 化所需的解析基准。 */
  cwd?: string
}

interface CodeBlockProps {
  language: string
  code: string
}

function CodeBlock({ language, code }: CodeBlockProps): JSX.Element {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-2xs select-text">
      {/* 顶部极简操作条 */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200/80 bg-slate-50/80 select-none">
        <div className="flex items-center gap-1.5 text-slate-500">
          <Code2 className="w-3.5 h-3.5 shrink-0" />
          <span className="font-mono text-tiny font-medium uppercase tracking-wider text-slate-500">
            {language || 'code'}
          </span>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-tiny text-slate-500 hover:text-slate-800 px-2 py-0.5 rounded hover:bg-slate-200/60 transition-colors"
          title="复制代码"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-600" />
              <span className="text-emerald-600 font-medium">已复制</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>

      {/* 代码内容区域（浅灰底，等宽字体，13px 可读字号） */}
      <div className="p-3 bg-slate-50/40 overflow-x-auto text-caption font-mono text-slate-800 leading-relaxed selection:bg-blue-100">
        <pre className="m-0 p-0 whitespace-pre font-mono text-caption leading-relaxed">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  )
}

export function MarkdownRenderer({ content, cwd }: MarkdownRendererProps): JSX.Element {
  return (
    <div className="text-body text-slate-800 leading-relaxed select-text space-y-2.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 表格
          table({ children }) {
            return (
              <div className="my-3 overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-2xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-body border-collapse">
                    {children}
                  </table>
                </div>
              </div>
            )
          },
          thead({ children }) {
            return (
              <thead className="bg-slate-50/90 border-b border-slate-200/90 text-slate-900 font-semibold select-none">
                {children}
              </thead>
            )
          },
          th({ children }) {
            return (
              <th className="px-3.5 py-2 text-caption font-semibold text-slate-900 tracking-wider uppercase border-b border-slate-200/80">
                {children}
              </th>
            )
          },
          tbody({ children }) {
            return <tbody className="divide-y divide-slate-100 bg-white">{children}</tbody>
          },
          tr({ children }) {
            return (
              <tr className="hover:bg-slate-50/60 transition-colors">
                {children}
              </tr>
            )
          },
          td({ children }) {
            return (
              <td className="px-3.5 py-2 text-body text-slate-800 leading-relaxed align-top">
                {children}
              </td>
            )
          },

          // 代码与代码块
          code({ className, children }) {
            const match = /language-(\w+)/.exec(className || '')
            const codeText = String(children).replace(/\n$/, '')
            const isBlock = Boolean(match) || codeText.includes('\n')

            if (isBlock) {
              return (
                <CodeBlock
                  language={match ? match[1] : ''}
                  code={codeText}
                />
              )
            }

            // 行内代码：含路径分隔符+扩展名的片段交给 InlineFileCode 判定——
            // 文件树里真实存在则渲染成可点击 chip，否则原样 code badge，
            // 保证"能点的必然能打开"，宁可漏认也不出现打不开的假 chip。
            return <InlineFileCode text={codeText} cwd={cwd} />
          },

          pre({ children }) {
            return <>{children}</>
          },

          // 段落：舒适的 14px 正文字号与适度下边距
          p({ children }) {
            return <p className="mb-2.5 last:mb-0 text-body text-slate-800 leading-relaxed">{children}</p>
          },

          // 标题体系
          h1({ children }) {
            return <h1 className="mt-5 mb-2 text-title font-semibold text-slate-900 tracking-tight">{children}</h1>
          },
          h2({ children }) {
            return <h2 className="mt-4 mb-1.5 text-body-lg font-semibold text-slate-900 tracking-tight">{children}</h2>
          },
          h3({ children }) {
            return <h3 className="mt-3 mb-1 text-body font-semibold text-slate-900">{children}</h3>
          },

          // 列表体系
          ul({ children }) {
            return <ul className="my-2.5 pl-5 list-disc space-y-1.5 text-body text-slate-800 marker:text-slate-400">{children}</ul>
          },
          ol({ children }) {
            return <ol className="my-2.5 pl-5 list-decimal space-y-1.5 text-body text-slate-800 marker:text-slate-400">{children}</ol>
          },
          li({ children }) {
            return <li className="leading-relaxed pl-0.5">{children}</li>
          },

          // 引用块
          blockquote({ children }) {
            return (
              <blockquote className="my-3 pl-3.5 py-1.5 border-l-2 border-primary/50 text-slate-600 bg-slate-50/50 rounded-r-lg text-body italic">
                {children}
              </blockquote>
            )
          },

          // 分割线
          hr() {
            return <hr className="my-4 border-slate-200/80" />
          },

          // 链接
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline underline-offset-2 font-medium"
              >
                {children}
              </a>
            )
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
