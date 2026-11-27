// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { adoptScreenFromAddress, readKnownDevice } from './deviceStore.ts'

beforeEach(() => localStorage.clear())

describe('adoptScreenFromAddress', () => {
  it("remembers the screen the setup page links to, and tidies the address bar", () => {
    window.history.replaceState(null, '', '/?screen=' + encodeURIComponent('http://192.168.0.16/') + '#top')
    expect(adoptScreenFromAddress(window.location, 5)).toMatchObject({ url: 'http://192.168.0.16/', savedAt: 5 })
    expect(readKnownDevice()).toMatchObject({ url: 'http://192.168.0.16/' })
    expect(window.location.search).toBe('')
    expect(window.location.hash).toBe('#top')
  })

  it('ignores anything that is not a plain http address', () => {
    window.history.replaceState(null, '', '/?screen=' + encodeURIComponent('javascript:alert(1)'))
    expect(adoptScreenFromAddress(window.location)).toBeNull()
    window.history.replaceState(null, '', '/?screen=https://evil.example/')
    expect(adoptScreenFromAddress(window.location)).toBeNull()
    expect(readKnownDevice()).toBeNull()
  })
})
