import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendInPage, WifiError } from './wifi.ts'

const DEVICE = { url: 'http://192.168.0.16/', localUrl: 'http://esper-49f5c0.local/', savedAt: 1 }
const SCREEN = { width: 170, height: 320 }
const IMAGE = new Uint8Array([1, 2, 3])

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('sendInPage', () => {
  it('asks the screen for its details, then posts the picture, as local-network requests', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('info') ? json({ screen: SCREEN }) : json({ ok: true, message: 'Saved' }),
    )
    vi.stubGlobal('fetch', fetch)
    await sendInPage(DEVICE, IMAGE, SCREEN)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['http://192.168.0.16/info', 'http://192.168.0.16/media'])
    for (const [, init] of fetch.mock.calls as unknown as Array<[string, RequestInit & { targetAddressSpace?: string }]>) {
      expect(init.targetAddressSpace).toBe('local')
    }
    const post = fetch.mock.calls[1] as unknown as [string, RequestInit]
    expect(post[1].method).toBe('POST')
    expect(new Uint8Array(post[1].body as ArrayBuffer)).toEqual(IMAGE)
  })

  it('tries the .local name when the address has changed', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.startsWith('http://192.168.0.16/')) throw new TypeError('Failed to fetch')
      return url.endsWith('info') ? json({ screen: SCREEN }) : json({ ok: true })
    })
    vi.stubGlobal('fetch', fetch)
    await sendInPage(DEVICE, IMAGE, SCREEN)
    expect(fetch.mock.calls.at(-1)![0]).toBe('http://esper-49f5c0.local/media')
  })

  it("reports unreachable when the browser or network won't let it through", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(sendInPage(DEVICE, IMAGE, SCREEN)).rejects.toMatchObject({ problem: 'unreachable' })
  })

  it("refuses another screen, and passes on the screen's own message", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ screen: { width: 240, height: 320 } })))
    await expect(sendInPage(DEVICE, IMAGE, SCREEN)).rejects.toMatchObject({ problem: 'other-screen' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('info') ? json({ screen: SCREEN }) : json({ ok: false, message: 'The picture arrived damaged. Try again.' }, 400),
      ),
    )
    const error = await sendInPage(DEVICE, IMAGE, SCREEN).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(WifiError)
    expect((error as WifiError).message).toBe('The picture arrived damaged. Try again.')
  })
})
