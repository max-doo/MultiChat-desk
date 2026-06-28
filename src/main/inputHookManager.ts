import { InputHook } from 'monio-napi'

let hook: InputHook | null = null

export function startInputHook(): void {
  if (hook) return
  hook = new InputHook()

  hook.onMouseDown((e) => {
    console.log(`[InputHook] MouseDown: button=${e.button}, x=${e.x}, y=${e.y}`)
  })

  hook.onMouseUp((e) => {
    console.log(`[InputHook] MouseUp: button=${e.button}, x=${e.x}, y=${e.y}`)
  })

  try {
    hook.start()
    console.log('[InputHook] Hook started successfully')
  } catch (err) {
    console.error('[InputHook] Failed to start hook:', err)
  }
}

export function stopInputHook(): void {
  if (hook) {
    try {
      hook.stop()
      hook.removeAllListeners()
      console.log('[InputHook] Hook stopped successfully')
    } catch (err) {
      console.error('[InputHook] Failed to stop hook:', err)
    }
    hook = null
  }
}
