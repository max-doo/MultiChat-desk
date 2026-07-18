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
      'win.setContentBounds({'
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
    patterns: ['mac-titlebar', 'window.api.windowDragStart', 'window.api.windowDragMove', 'window.api.windowDragEnd', 'setPointerCapture', 'requestAnimationFrame', "window.api.platform === 'win32'", 'justify-end drag-region', 'window.api.minimizeWindow()', 'window.api.maximizeWindow()', 'window.api.closeWindow()', 'isWindowMaximized'],
    forbiddenPatterns: ['native-titlebar', 'native-drag-surface']
  },
  {
    file: 'src/main/webviewManager.ts',
    patterns: ["process.platform === 'win32'", "titleBarStyle: 'hiddenInset'", 'titleBarOverlay: {', 'renderer 自绘三键', '不能设置 titleBarStyle: hidden']
  },
  {
    file: 'src/renderer/src/pages/QuickPage.tsx',
    patterns: ['window.api.windowDragMove', 'window.api.windowDragEnd']
  },
  {
    file: 'src/renderer/src/components/WebviewCard.tsx',
    patterns: ['window.api.windowDragStart', 'setPointerCapture']
  },
  {
    file: 'src/renderer/src/assets/index.css',
    patterns: ['.mac-titlebar', '-webkit-app-region: drag', '-webkit-app-region: no-drag'],
    forbiddenPatterns: ['.native-titlebar', '.native-drag-surface']
  },
  {
    file: 'src/main/ipcHandlers.ts',
    patterns: ['startContentBounds: win.getContentBounds()', 'win.setContentBounds({', 'customMaximizeState', 'screen.getDisplayMatching(win.getBounds()).workArea', 'win.setBounds(workArea, false)'],
    forbiddenPatterns: ['win.setPosition(']
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
