import { cpSync, existsSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import JavaScriptObfuscator from 'javascript-obfuscator'

const shouldObfuscate = process.env.MM_OBFUSCATE !== '0'

function createObfuscationPlugin(target: 'browser' | 'node'): Plugin {
  return {
    name: `multichat:obfuscate:${target}`,
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      if (!shouldObfuscate) return

      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue

        const result = JavaScriptObfuscator.obfuscate(output.code, {
          target,
          log: false,
          compact: true,
          simplify: true,
          renameGlobals: false,
          stringArray: true,
          stringArrayThreshold: 0.75,
          unicodeEscapeSequence: true,
          numbersToExpressions: true,
          controlFlowFlattening: false,
          deadCodeInjection: false,
          debugProtection: false,
          selfDefending: false,
          splitStrings: false,
          sourceMap: false
        })

        output.code = result.getObfuscatedCode()
      }
    }
  }
}

/**
 * PDF.js 运行时资源（cMap / 标准字体 / wasm）不属于 import 图，
 * 构建时整体复制到 out/renderer/pdfjs，dev 与 packaged 使用同一相对路径。
 */
function createPdfjsAssetsPlugin(): Plugin {
  const source = resolve('node_modules/pdfjs-dist')
  const targets = ['cmaps', 'standard_fonts', 'wasm', 'iccs']
  return {
    name: 'multichat:pdfjs-assets',
    apply: 'build',
    closeBundle() {
      const outDir = resolve('out/renderer/pdfjs')
      for (const dir of targets) {
        const from = resolve(source, dir)
        if (!existsSync(from)) continue
        cpSync(from, resolve(outDir, dir), { recursive: true })
      }
    }
  }
}

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true
    },
    plugins: [createObfuscationPlugin('node')]
  },
  preload: {
    build: {
      externalizeDeps: true
    },
    plugins: [createObfuscationPlugin('node')]
  },
  renderer: {
    server: {
      port: 5300,
      host: '127.0.0.1'
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), createPdfjsAssetsPlugin(), createObfuscationPlugin('browser')]
  }
})
