import { Command } from 'commander'
import { registerCommands } from './commands'
const { version } = require('../../package.json') as { version: string }

const program = new Command()

program
  .name('multichat')
  .description('MultiChat CLI Client')
  .version(version)

// exitOverride 须在注册命令前调用：子命令创建时拷贝 _exitCallback。
// commander 用法错误（缺参数/未知 option）统一落到退出码 2，执行错误由各 action 自行 exit 1。
program.exitOverride()
registerCommands(program)

program.parseAsync(process.argv).catch((err: unknown) => {
  const code = (err as { code?: string }).code
  if (code === 'commander.helpDisplayed' || code === 'commander.version') process.exit(0)
  if (typeof code === 'string' && code.startsWith('commander.')) process.exit(2)
  throw err
})
