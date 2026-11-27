import { describe, expect, it } from 'vitest'
import { itemStatus, reconcileOnScreen, type OnScreen } from './onScreen.ts'

const sent: OnScreen = { item: 'upload:a', version: 'none|original', crc32: 0x1234, length: 10 }

describe('itemStatus', () => {
  it('marks the selected item yellow until that version is on the screen', () => {
    const picked = { item: 'upload:b', version: 'none|original' }
    expect(itemStatus('upload:b', picked, sent)).toBe('selected')
    expect(itemStatus('upload:a', picked, sent)).toBe('on-screen')
    expect(itemStatus('upload:c', picked, sent)).toBeNull()
  })

  it('reads as selected again once the crop or compression changes', () => {
    expect(itemStatus('upload:a', { item: 'upload:a', version: 'none|original' }, sent)).toBe('on-screen')
    expect(itemStatus('upload:a', { item: 'upload:a', version: '90:0:0:1:1|original' }, sent)).toBe('selected')
  })

  it('marks nothing as on the screen when nothing was sent', () => {
    expect(itemStatus('example:photo-frame', { item: 'example:photo-frame', version: '' }, null)).toBe('selected')
  })
})

describe('reconcileOnScreen', () => {
  it('keeps what was sent when the screen reports the same CRC', () => {
    expect(reconcileOnScreen(sent, null, { crc32: 0x1234, length: 10 })).toBe(sent)
  })

  it('takes the picture being sent when the screen reports its CRC', () => {
    const next = { ...sent, item: 'upload:b', crc32: 0x9999 }
    expect(reconcileOnScreen(sent, next, { crc32: 0x9999, length: 10 })).toBe(next)
  })

  it("names nothing when the screen holds a picture this browser didn't send, or none", () => {
    expect(reconcileOnScreen(sent, null, { crc32: 0x4321, length: 10 })).toEqual({
      item: null,
      version: '',
      crc32: 0x4321,
      length: 10,
    })
    expect(reconcileOnScreen(sent, null, 'none')).toBeNull()
  })
})
