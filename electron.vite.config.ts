import { cpSync, createReadStream, existsSync, statSync } from 'fs'
import { join, normalize, resolve, sep } from 'path'
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
 * dev 服务器不经过构建产物目录，这里直接用中间件从 node_modules 提供，
 * 否则 /pdfjs/* 会被 vite 的 SPA fallback 返回 index.html，wasm 与 cmap 全部静默失效。
 *
 * pdf.worker 同样必须原始字节直出：vite dev 会对经 /@fs/ 提供的模块做 import
 * 分析并注入 /@vite/client 与 injectQuery 改写，worker bundle 内的 emscripten
 * glue（jbig2 wasm 实例化与 fallback 动态 import）会被破坏，扫描件解码静默失败。
 */
function createPdfjsAssetsPlugin(): Plugin {
  const source = resolve('node_modules/pdfjs-dist')
  const targets = ['cmaps', 'standard_fonts', 'wasm', 'iccs']
  const mimeTypes: Record<string, string> = {
    '.wasm': 'application/wasm',
    '.bcmap': 'application/octet-stream',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.icc': 'application/octet-stream'
  }
  return {
    name: 'multichat:pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (url === '/pdfjs/pdf.worker.min.mjs') {
          const workerPath = join(source, 'build/pdf.worker.min.mjs')
          if (existsSync(workerPath)) {
            res.setHeader('Content-Type', 'text/javascript')
            createReadStream(workerPath).pipe(res)
            return
          }
        }
        if (!url.startsWith('/pdfjs/')) {
          next()
          return
        }
        const subPath = normalize(decodeURIComponent(url.slice('/pdfjs/'.length)))
        if (subPath.startsWith('..') || subPath.includes(`..${sep}`)) {
          res.statusCode = 403
          res.end()
          return
        }
        const filePath = join(source, subPath)
        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
          res.statusCode = 404
          res.end()
          return
        }
        const ext = filePath.slice(filePath.lastIndexOf('.'))
        res.setHeader('Content-Type', mimeTypes[ext] ?? 'application/octet-stream')
        createReadStream(filePath).pipe(res)
      })
    },
    closeBundle() {
      const outDir = resolve('out/renderer/pdfjs')
      for (const dir of targets) {
        const from = resolve(source, dir)
        if (!existsSync(from)) continue
        cpSync(from, resolve(outDir, dir), { recursive: true })
      }
      const workerFrom = resolve(source, 'build/pdf.worker.min.mjs')
      if (existsSync(workerFrom)) {
        cpSync(workerFrom, resolve(outDir, 'pdf.worker.min.mjs'))
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
