import { Command } from 'commander'
import { sendDaemonRequest, type DaemonResponse } from './client'

function isJsonMode(cmd: Command): boolean {
  return Boolean(cmd.optsWithGlobals().json || process.argv.includes('--json'))
}

function handleCommandResponse(res: DaemonResponse, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(res, null, 2))
    if (!res.success) {
      process.exit(1)
    }
  } else {
    if (!res.success) {
      console.error(res.error || '执行失败')
      process.exit(1)
    } else {
      if (typeof res.data === 'string') {
        console.log(res.data)
      } else if (typeof res.data === 'object' && res.data !== null) {
        console.log(JSON.stringify(res.data, null, 2))
      } else if (res.data !== undefined) {
        console.log(String(res.data))
      }
    }
  }
}

export function registerCommands(program: Command): void {
  program.option('--json', 'Output results in JSON format')

  const daemonCmd = program
    .command('daemon')
    .description('Manage MultiChat daemon')
    .option('--json', 'Output results in JSON format')

  daemonCmd
    .command('status')
    .description('Check if Daemon is running')
    .option('--json', 'Output results in JSON format')
    .action(async (_options: Record<string, unknown>, cmd: Command) => {
      const jsonMode = isJsonMode(cmd)
      const res = await sendDaemonRequest({ action: 'status' }, jsonMode)
      handleCommandResponse(res, jsonMode)
    })

  program
    .command('exec')
    .description('Execute a prompt on a specified AI model')
    .option('-m, --model <model>', 'AI model or platform ID')
    .option('-p, --prompt <prompt>', 'Prompt text to execute')
    .option('--json', 'Output results in JSON format')
    .action(async (options: { model?: string; prompt?: string }, cmd: Command) => {
      const jsonMode = isJsonMode(cmd)
      const res = await sendDaemonRequest(
        { action: 'exec', model: options.model || '', prompt: options.prompt || '' },
        jsonMode
      )
      handleCommandResponse(res, jsonMode)
    })

  program
    .command('collect')
    .description('Collect the latest response from a session or model')
    .option('-s, --session <session>', 'Session ID')
    .option('-m, --model <model>', 'AI model or platform ID')
    .option('--json', 'Output results in JSON format')
    .action(async (options: { session?: string; model?: string }, cmd: Command) => {
      const jsonMode = isJsonMode(cmd)
      const res = await sendDaemonRequest(
        { action: 'collect', session: options.session || '', model: options.model || '' },
        jsonMode
      )
      handleCommandResponse(res, jsonMode)
    })
}
