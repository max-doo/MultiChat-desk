declare module 'prismjs' {
  interface Languages {
    [language: string]: unknown
    markdown: unknown
  }
  interface Token {
    type: string
    alias?: string | string[]
    content: string | Token | Array<string | Token>
    length: number
    greedy?: boolean
  }
  const Prism: {
    languages: Languages
    highlight(text: string, grammar: unknown, language?: string): string
    tokenize(text: string, grammar: unknown): Array<string | Token>
    Token: {
      new (type: string, content: string | Token | Array<string | Token>): Token
    }
  }
  export default Prism
}

declare module 'prismjs/components/*' {
  const register: unknown
  export default register
}
