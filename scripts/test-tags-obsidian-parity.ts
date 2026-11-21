import assert from 'node:assert'
import {
  normalizeTag,
  isValidTag,
  parseTagsFromFrontmatterValue,
  matchTag,
  parseTagSearchQuery,
  extractFrontmatterTags,
  extractInlineTags,
  isTagField
} from '../src/shared/utils/workbenchTags.ts'

console.log('--- 1. Testing normalizeTag ---')
assert.strictEqual(normalizeTag('#react'), 'react')
assert.strictEqual(normalizeTag('###react'), 'react')
assert.strictEqual(normalizeTag('  #project/frontend/  '), 'project/frontend')
assert.strictEqual(normalizeTag('"quoted_tag"'), 'quoted_tag')
assert.strictEqual(normalizeTag("'single_quoted'"), 'single_quoted')
assert.strictEqual(normalizeTag('#中文标签/子分类'), '中文标签/子分类')
assert.strictEqual(normalizeTag('tag with space'), 'tagwithspace')
assert.strictEqual(normalizeTag('tag,with,comma'), 'tagwithcomma')
assert.strictEqual(normalizeTag('//nested//tag//'), 'nested/tag')
assert.strictEqual(normalizeTag('tag:colon'), 'tagcolon')
assert.strictEqual(normalizeTag('#tag!@#$%^&*()'), 'tag')
console.log('✓ normalizeTag passed')

console.log('--- 2. Testing isValidTag ---')
assert.strictEqual(isValidTag('1984'), false, 'pure numbers should be invalid')
assert.strictEqual(isValidTag('y1984'), true)
assert.strictEqual(isValidTag('year-1984'), true)
assert.strictEqual(isValidTag('react'), true)
assert.strictEqual(isValidTag('project/frontend/ui'), true)
assert.strictEqual(isValidTag(''), false)
assert.strictEqual(isValidTag('/invalid'), false)
assert.strictEqual(isValidTag('invalid/'), false)
assert.strictEqual(isValidTag('中文标签'), true)
assert.strictEqual(isValidTag('日本語タグラベル'), true)
assert.strictEqual(isValidTag('tag_with_underscore'), true)
assert.strictEqual(isValidTag('tag-with-hyphen'), true)
assert.strictEqual(isValidTag('#'), false)
assert.strictEqual(isValidTag('###'), false)
assert.strictEqual(isValidTag('///'), false)
console.log('✓ isValidTag passed')

console.log('--- 3. Testing parseTagsFromFrontmatterValue ---')
const arrayVal = '[react, "vue", #nested/tag]'
assert.deepStrictEqual(parseTagsFromFrontmatterValue(arrayVal), ['react', 'vue', 'nested/tag'])

const commaVal = 'react, vue, #nested/tag, react'
assert.deepStrictEqual(parseTagsFromFrontmatterValue(commaVal), ['react', 'vue', 'nested/tag'])

const spaceVal = 'react vue #nested/tag'
assert.deepStrictEqual(parseTagsFromFrontmatterValue(spaceVal), ['react', 'vue', 'nested/tag'])

const emptyVal = ''
assert.deepStrictEqual(parseTagsFromFrontmatterValue(emptyVal), [])

const quotesAndCommas = '"#tag1", \'tag2\', tag3, #tag1'
assert.deepStrictEqual(parseTagsFromFrontmatterValue(quotesAndCommas), ['tag1', 'tag2', 'tag3'])
console.log('✓ parseTagsFromFrontmatterValue passed')

console.log('--- 4. Testing matchTag ---')
assert.strictEqual(matchTag('project', 'project'), true)
assert.strictEqual(matchTag('Project', 'project'), true)
assert.strictEqual(matchTag('project/alpha', 'project'), true, 'parent should match child')
assert.strictEqual(matchTag('project/alpha/ui', 'project'), true, 'root should match deep child')
assert.strictEqual(matchTag('project/alpha/ui', 'project/alpha'), true, 'mid parent should match deep child')
assert.strictEqual(matchTag('projection', 'project'), false, 'prefix-only word should NOT match')
assert.strictEqual(matchTag('project', 'project/alpha'), false, 'child should not match parent')
assert.strictEqual(matchTag('中文/研发', '中文'), true)
assert.strictEqual(matchTag('中文/研发/前端', '中文/研发'), true)
assert.strictEqual(matchTag('中文研究', '中文'), false)
console.log('✓ matchTag passed')

console.log('--- 5. Testing parseTagSearchQuery ---')
assert.deepStrictEqual(parseTagSearchQuery('tag:#vue'), {
  isTagQuery: true,
  tagTerm: 'vue',
  rawQuery: 'tag:#vue'
})
assert.deepStrictEqual(parseTagSearchQuery('tag:vue'), {
  isTagQuery: true,
  tagTerm: 'vue',
  rawQuery: 'tag:vue'
})
assert.deepStrictEqual(parseTagSearchQuery('tag:#project/backend'), {
  isTagQuery: true,
  tagTerm: 'project/backend',
  rawQuery: 'tag:#project/backend'
})
assert.deepStrictEqual(parseTagSearchQuery('#react'), {
  isTagQuery: true,
  tagTerm: 'react',
  rawQuery: '#react'
})
assert.deepStrictEqual(parseTagSearchQuery('#project/frontend'), {
  isTagQuery: true,
  tagTerm: 'project/frontend',
  rawQuery: '#project/frontend'
})
assert.strictEqual(parseTagSearchQuery('#').isTagQuery, false)
assert.strictEqual(parseTagSearchQuery('hello world').isTagQuery, false)
assert.strictEqual(parseTagSearchQuery('# Heading').isTagQuery, false)
assert.deepStrictEqual(parseTagSearchQuery('TAG:#UppercaseTag'), {
  isTagQuery: true,
  tagTerm: 'UppercaseTag',
  rawQuery: 'TAG:#UppercaseTag'
})
console.log('✓ parseTagSearchQuery passed')

console.log('--- 6. Testing extractFrontmatterTags with multiple key variations ---')
const sampleMd1 = `---
title: 测试笔记
tags:
  - react
  - project/alpha
  - #vue
date: 2026-11-21
---

# 正文内容
`
const res1 = extractFrontmatterTags(sampleMd1)
assert.deepStrictEqual(res1.tags, ['react', 'project/alpha', 'vue'])
assert.strictEqual(res1.lineMap.get('react'), 4)
assert.strictEqual(res1.lineMap.get('project/alpha'), 5)
assert.strictEqual(res1.lineMap.get('vue'), 6)

const sampleMd2 = `---
tag: [react, vue, #project/beta]
---
正文
`
const res2 = extractFrontmatterTags(sampleMd2)
assert.deepStrictEqual(res2.tags, ['react', 'vue', 'project/beta'])
assert.strictEqual(res2.lineMap.get('react'), 2)

const sampleMdCn = `---
标签:
  - 研发/前端
  - 设计
---
正文
`
const resCn = extractFrontmatterTags(sampleMdCn)
assert.deepStrictEqual(resCn.tags, ['研发/前端', '设计'])
console.log('✓ extractFrontmatterTags passed')

console.log('--- 7. Testing extractInlineTags ---')
const sampleMd3 = `---
tags:
  - frontmatter-tag
---

# 这是标题（不应作为标签）

这里是普通文本，带有 #meeting 和 #project/ui 标签。

\`\`\`javascript
// 这里是代码块，里面的 #fake-tag 不应被提取
const x = 1;
\`\`\`

还有行末标签 #daily-note
`
const inlines = extractInlineTags(sampleMd3)
assert.strictEqual(inlines.length, 3)
assert.strictEqual(inlines[0].tag, 'meeting')
assert.strictEqual(inlines[1].tag, 'project/ui')
assert.strictEqual(inlines[2].tag, 'daily-note')
assert.strictEqual(inlines.some(t => t.tag === 'fake-tag'), false, 'code block tags must be ignored')
assert.strictEqual(inlines.some(t => t.tag === '这是标题（不应作为标签）'), false, 'headings must be ignored')
console.log('✓ extractInlineTags passed')

console.log('--- 8. Testing isTagField ---')
assert.strictEqual(isTagField('tags'), true)
assert.strictEqual(isTagField('tag'), true)
assert.strictEqual(isTagField('TAGS'), true)
assert.strictEqual(isTagField('TAG'), true)
assert.strictEqual(isTagField('标签'), true)
assert.strictEqual(isTagField('title'), false)
assert.strictEqual(isTagField('date'), false)
console.log('✓ isTagField passed')

console.log('--- 9. Testing Obsidian YAML frontmatter format with quoted list items ---')
const userObsidianNote = `---
title: "深度解析2026 GTC: 英伟达万亿订单背后的AI大爆发、Token经济学与失衡供应链"
video_type: "analysis"
tags:
  - "英伟达"
  - "GTC2026"
  - "AI算力"
  - "Token经济学"
  - "AI供应链"
  - "黄仁勋"
url: "https://www.youtube.com/watch?v=B3wJuvYjLu0&list=LL&index=1"
author: "硅谷101（陈茜）"
published_at: "2026-03"
---

正文
`
const extractedUserTags = extractFrontmatterTags(userObsidianNote)
assert.deepStrictEqual(extractedUserTags.tags, [
  '英伟达',
  'GTC2026',
  'AI算力',
  'Token经济学',
  'AI供应链',
  '黄仁勋'
])
console.log('✓ Obsidian frontmatter with quotes parsed correctly')

console.log('--- 10. Testing Unicode and international tags ---')
assert.strictEqual(isValidTag('café'), true, 'café should be valid tag')
assert.strictEqual(isValidTag('résumé'), true, 'résumé should be valid tag')
assert.strictEqual(isValidTag('münchen'), true, 'münchen should be valid tag')
assert.strictEqual(isValidTag('Русский'), true, 'Cyrillic should be valid tag')
assert.strictEqual(isValidTag('한국어'), true, 'Hangul should be valid tag')
assert.strictEqual(normalizeTag('#café'), 'café')
assert.strictEqual(normalizeTag('#résumé/v1'), 'résumé/v1')
assert.deepStrictEqual(parseTagsFromFrontmatterValue('[café, résumé, #münchen]'), ['café', 'résumé', 'münchen'])
console.log('✓ Unicode and international tags passed')

console.log('--- 11. Testing Frontmatter without trailing newline at EOF ---')
const noTrailingNewline = `---
title: "No Trailing Newline"
tags:
  - "英伟达"
  - "Token经济学"
---`
const extractedNoTrailing = extractFrontmatterTags(noTrailingNewline)
assert.deepStrictEqual(extractedNoTrailing.tags, ['英伟达', 'Token经济学'])
assert.strictEqual(extractedNoTrailing.lineMap.get('英伟达'), 4)
console.log('✓ Frontmatter without trailing newline parsed correctly')

console.log('--- 12. Testing single scalar tags in Frontmatter ---')
const singleScalar1 = `---
tags: 英伟达
---
`
assert.deepStrictEqual(extractFrontmatterTags(singleScalar1).tags, ['英伟达'])

const singleScalar2 = `---
tag: "GTC2026"
---
`
assert.deepStrictEqual(extractFrontmatterTags(singleScalar2).tags, ['GTC2026'])
console.log('✓ Single scalar tags parsed correctly')

console.log('--- 13. Testing inline tags with Unicode ---')
const mdInlineUnicode = `
Here is a note with #café and #résumé and #AI供应链 in the body text.
`
const inlineUnicodeHits = extractInlineTags(mdInlineUnicode)
assert.strictEqual(inlineUnicodeHits.length, 3)
assert.strictEqual(inlineUnicodeHits[0].tag, 'café')
assert.strictEqual(inlineUnicodeHits[1].tag, 'résumé')
assert.strictEqual(inlineUnicodeHits[2].tag, 'AI供应链')
console.log('✓ Inline tags with Unicode parsed correctly')

console.log('\nALL 13 TEST SUITES PASSED SUCCESSFULLY!')
