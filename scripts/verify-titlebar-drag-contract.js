const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

const checks = [
  {
    file: 'src/main/ipcHandlers.ts',
    patterns: [
      "ipcMain.on('window-drag-start'",
      "ipcMain.on('window-drag-move'",
      "ipcMain.on('window-drag-end'",
      'setContentBounds({'
    ]
  },
  {
    file: 'src/preload/index.ts',
    patterns: ['windowDragStart', 'windowDragMove', 'windowDragEnd']
  },
  {
    file: 'src/preload/index.d.ts',
    patterns: ['windowDragStart', 'windowDragMove', 'windowDragEnd']
  },
  {
    file: 'src/renderer/src/components/Layout.tsx',
    patterns: ['window.api.windowDragStart', 'window.api.windowDragMove', 'window.api.windowDragEnd', 'mac-titlebar'],
    forbiddenPatterns: []
  }
]

const failures = []

for (const check of checks) {
  const source = read(check.file)
  for (const pattern of check.patterns) {
    if (!source.includes(pattern)) {
      failures.push(`${check.file}: missing ${pattern}`)
    }
  }
  for (const pattern of check.forbiddenPatterns || []) {
    if (source.includes(pattern)) {
      failures.push(`${check.file}: forbidden ${pattern}`)
    }
  }
}

if (failures.length) {
  console.error('Titlebar drag contract is incomplete:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Titlebar drag contract verified')
