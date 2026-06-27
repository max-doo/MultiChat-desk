/**
 * 便携版构建辅助脚本
 * 
 * 功能：
 * 1. 确保 build 目录存在
 * 2. 创建或更新 portable.txt 标记文件
 * 3. 在构建前自动执行
 * 
 * 使用：npm run add-portable-marker
 */

const fs = require('fs')
const path = require('path')

// 项目根目录
const rootDir = path.join(__dirname, '..')
const buildDir = path.join(rootDir, 'build')
const portableMarker = path.join(buildDir, 'portable.txt')

console.log('========================================')
console.log('  MultiChat 便携版标记文件生成工具')
console.log('========================================\n')

// 1. 确保 build 目录存在
if (!fs.existsSync(buildDir)) {
  console.log('📁 创建 build 目录...')
  fs.mkdirSync(buildDir, { recursive: true })
  console.log('✅ build 目录已创建:', buildDir)
} else {
  console.log('✅ build 目录已存在:', buildDir)
}

// 2. 创建标记文件内容
const timestamp = new Date().toISOString()
const version = require(path.join(rootDir, 'package.json')).version || '1.0.0'

const content = `MultiChat Portable Edition
==========================

This file indicates that the application is running in portable mode.

Data Storage Locations:
-----------------------
- Configuration:    [app directory]/resources/data/config.json
- Session/Cookies:  [app directory]/resources/data/Session/
- Cache:            [app directory]/resources/data/Cache/
- Logs:             [app directory]/resources/data/logs/

All user data will be stored in the application directory,
making it truly portable across different computers.

Features:
---------
- No installation required
- Run from USB drive or any folder
- Data travels with the application
- Multiple versions can coexist
- No registry modifications

Usage:
------
1. Extract the portable package to any folder
2. Ensure the folder has write permissions
3. Double-click MultiChat.exe to run
4. Your data will be stored in the 'resources/data/' folder

Version: ${version}
Created: ${timestamp}
`

// 3. 写入标记文件
try {
  fs.writeFileSync(portableMarker, content, 'utf-8')
  console.log('✅ 便携版标记文件已创建:', portableMarker)
  console.log('📝 文件大小:', fs.statSync(portableMarker).size, 'bytes')
  console.log('🎯 版本:', version)
  console.log('\n✨ 准备就绪！现在可以构建便携版了。')
  console.log('\n运行命令: npm run build:win:portable')
  console.log('========================================\n')
  process.exit(0)
} catch (error) {
  console.error('❌ 创建标记文件失败:', error.message)
  console.error(error)
  process.exit(1)
}

