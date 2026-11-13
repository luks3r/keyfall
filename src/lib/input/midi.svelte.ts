import { platform, type Device } from '../platform'
import { settings } from '../settings.svelte'
import type { NoteSink } from './sink'

const NOTE_ON = 0x90
const NOTE_OFF = 0x80
const CONTROL_CHANGE = 0xb0
const SUSTAIN_PEDAL = 64

export class MidiPorts {
  readonly supported = platform.midi.supported
  enabled = $state(false)
  inputs = $state.raw<Device[]>([])
  outputs = $state.raw<Device[]>([])
  error = $state('')

  #sink: NoteSink
  /** Takes messages first (controller mappings); returning true keeps them from playing notes. */
  intercept?: (message: number[]) => boolean

  constructor(sink: NoteSink) {
    this.#sink = sink
  }

  #onMessage = (message: number[], sounded: boolean) => {
    if (this.intercept?.(message)) return
    const [status, note, velocity] = message
    const command = status & 0xf0
    if (command === NOTE_ON && velocity > 0) this.#sink.press(note, velocity / 127, sounded)
    else if (command === NOTE_OFF || command === NOTE_ON) this.#sink.release(note, sounded)
    else if (command === CONTROL_CHANGE && note === SUSTAIN_PEDAL) this.#sink.setSustain(velocity >= 64, sounded)
  }

  async #attempt(action: () => Promise<unknown>) {
    try {
      await action()
      this.error = ''
    } catch (error) {
      this.error = String(error)
    }
  }

  async restore() {
    if (this.supported && (!platform.midi.needsPermission || settings.midiEnabled)) await this.enable()
  }

  async enable() {
    await this.#attempt(async () => {
      await this.refresh()
      this.enabled = true
      settings.midiEnabled = true
      await Promise.all([this.setInput(settings.midiInput), this.setOutput(settings.midiOutput)])
    })
  }

  async refresh() {
    ;[this.inputs, this.outputs] = await Promise.all([platform.midi.inputs(), platform.midi.outputs()])
  }

  async setInput(id: string | null) {
    settings.midiInput = id
    await this.#attempt(() => platform.midi.openInput(id, this.#onMessage))
  }

  async setOutput(id: string | null) {
    settings.midiOutput = id
    await this.#attempt(() => platform.midi.openOutput(id))
  }

  close() {
    void platform.midi.openInput(null, this.#onMessage)
    void platform.midi.openOutput(null)
  }
}
