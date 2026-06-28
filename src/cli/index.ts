import { Command } from 'commander'
import { registerCommands } from './commands'

const program = new Command()

program
  .name('multichat')
  .description('MultiChat CLI Client')
  .version('1.0.0')

registerCommands(program)

void program.parseAsync(process.argv)
