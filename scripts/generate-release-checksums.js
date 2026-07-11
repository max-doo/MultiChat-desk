const { createHash } = require('crypto')
const { readdir, readFile, writeFile } = require('fs/promises')
const { join } = require('path')

const distDir = join(process.cwd(), 'dist')

async function main() {
  const entries = await readdir(distDir, { withFileTypes: true })
  const artifacts = entries.filter((entry) => entry.isFile() && /\.dmg$/i.test(entry.name))
  if (artifacts.length === 0) {
    throw new Error('dist/ 中未找到 macOS DMG；请先执行 npm run build:mac')
  }

  const lines = await Promise.all(artifacts.sort((a, b) => a.name.localeCompare(b.name)).map(async (artifact) => {
    const content = await readFile(join(distDir, artifact.name))
    const digest = createHash('sha256').update(content).digest('hex')
    return `${digest}  ${artifact.name}`
  }))

  const output = join(distDir, 'SHA256SUMS.txt')
  await writeFile(output, `${lines.join('\n')}\n`, 'utf8')
  console.log(`已写入 ${output}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
