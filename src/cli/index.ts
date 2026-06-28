import { Command } from 'commander'
import { registerCommands } from './commands'
const { version } = require('../../package.json') as { version: string }

const program = new Command()

program
  .name('multichat')
  .description('MultiChat CLI Client')
  .version(version)

registerCommands(program)

void program.parseAsync(process.argv)
