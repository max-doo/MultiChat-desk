import { formatUrl } from '@lexical/link'

export const BARE_URL_REGEXP =
  /(?<![\w@.-])(?:https?:\/\/|www\.)[^\s<>"'`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。！？；：、（）【】「」《》]+/iu

const BARE_URL_TRAILING_PUNCTUATION = /[.,;:!?'"…]+$/

export interface BareLinkMatch {
  index: number
  length: number
  text: string
  url: string
}

export function trimBareUrl(raw: string): string {
  let url = raw.replace(BARE_URL_TRAILING_PUNCTUATION, '')
  for (const [close, open] of [
    [')', '('],
    [']', '['],
    ['}', '{']
  ] as const) {
    while (
      url.endsWith(close) &&
      url.split(close).length > url.split(open).length
    ) {
      url = url.slice(0, -1).replace(BARE_URL_TRAILING_PUNCTUATION, '')
    }
  }
  return url
}

export function matchBareLink(text: string): BareLinkMatch | null {
  const match = BARE_URL_REGEXP.exec(text)
  if (!match || match.index === undefined) return null

  const visibleText = trimBareUrl(match[0])
  if (!visibleText) return null

  return {
    index: match.index,
    length: visibleText.length,
    text: visibleText,
    url: formatUrl(visibleText)
  }
}
