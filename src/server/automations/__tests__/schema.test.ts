import { describe, expect, it } from 'vitest'
import { parseAutomationDeleteOptions } from '../schema'

describe('automation request schema', () => {
  it('defaults delete requests to the Desktop-native destructive path', () => {
    expect(parseAutomationDeleteOptions({}, {})).toEqual({ removeNative: true })
    expect(parseAutomationDeleteOptions({ removeNative: 'true' }, {})).toEqual({ removeNative: true })
  })

  it('keeps sidecar-only cleanup explicit for debug maintenance', () => {
    expect(parseAutomationDeleteOptions({ sidecarOnly: 'true' }, {})).toEqual({ removeNative: false })
    expect(parseAutomationDeleteOptions({}, { removeNative: false })).toEqual({ removeNative: false })
    expect(() => parseAutomationDeleteOptions({}, { sidecarOnly: 'yes' })).toThrow(/sidecarOnly/)
    expect(() => parseAutomationDeleteOptions({ sidecarOnly: 'true', removeNative: 'true' }, {})).toThrow(/sidecarOnly/)
  })
})
