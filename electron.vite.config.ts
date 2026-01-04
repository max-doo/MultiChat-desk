import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import JavaScriptObfuscator from 'javascript-obfuscator'

const shouldObfuscate = process.env.MM_OBFUSCATE !== '0'

function createObfuscationPlugin(target: 'browser' | 'node'): Plugin {
  return {
    name: `modelmash:obfuscate:${target}`,
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

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), createObfuscationPlugin('node')]
  },
  preload: {
    plugins: [externalizeDepsPlugin(), createObfuscationPlugin('node')]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), createObfuscationPlugin('browser')]
  }
})
