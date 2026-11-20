declare module 'prismjs' {
  interface Languages {
    [language: string]: unknown
    markdown: unknown
  }
  const Prism: {
    languages: Languages
    highlight(text: string, grammar: unknown, language?: string): string
  }
  export default Prism
}

declare module 'prismjs/components/prism-markdown' {
  const register: unknown
  export default register
}
