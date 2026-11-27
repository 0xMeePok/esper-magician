import { describe, expect, it } from 'vitest'
import { parseManifest } from './firmware.ts'
import { encodeRpc, ImprovParser } from './improv.ts'
import { md5Hex } from './md5.ts'
import { checkBoardLog, LineBuffer } from './serialLog.ts'

const text = (value: string) => new TextEncoder().encode(value)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('md5Hex', () => {
  it('matches the RFC 1321 test values', () => {
    expect(md5Hex(text(''))).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(md5Hex(text('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(md5Hex(text('12345678901234567890123456789012345678901234567890123456789012345678901234567890'))).toBe(
      '57edf4a22be3c955ac49da2e2107b67a',
    )
  })
})

describe('ImprovParser text', () => {
  it('keeps the log around Improv packets, and holds back only a possible header', () => {
    const parser = new ImprovParser()
    const packet = encodeRpc(2)
    const packets = parser.push(Uint8Array.from([...text('I (1) boot: hi\r\n'), ...packet, ...text('next\r\nIMP')]))
    expect(packets).toHaveLength(0) // an RPC from the website, not something the screen sends
    // The newline after a packet's checksum comes through, and LineBuffer drops the empty line.
    expect(decode(parser.takeText())).toBe('I (1) boot: hi\r\n\nnext\r\n')
    parser.push(text('ORTANT\r\n'))
    expect(decode(parser.takeText())).toBe('IMPORTANT\r\n')
  })
})

describe('LineBuffer', () => {
  it('joins chunks into lines and drops colour codes', () => {
    const lines = new LineBuffer()
    expect(lines.push(text('\x1b[0;32mI (5) es'))).toEqual([])
    expect(lines.push(text('per: ok\x1b[0m\r\nnext'))).toEqual(['I (5) esper: ok'])
  })
})

describe('checkBoardLog', () => {
  const board = (line: string) => ({ source: 'board' as const, text: line })

  it('waits until the screen says something', () => {
    expect(checkBoardLog([], null).every((check) => check.status === 'waiting')).toBe(true)
  })

  it('reports a damaged picture and a brownout', () => {
    const checks = checkBoardLog(
      [
        board('W (500) media: picture is damaged (CRC 0x00000001, expected 0x00000002)'),
        board('Brownout detector was triggered'),
      ],
      null,
    )
    expect(checks.find((check) => check.id === 'picture')?.status).toBe('bad')
    expect(checks.find((check) => check.id === 'crash')?.status).toBe('bad')
  })

  it('compares the CRC with what was sent', () => {
    const lines = [board('I (520) media: GIF, 100 bytes, CRC 0x0000abcd OK')]
    expect(checkBoardLog(lines, { board: null, crc32: 0xabcd, length: 100 })[2]?.status).toBe('ok')
    expect(checkBoardLog(lines, { board: null, crc32: 0xabce, length: 100 })[2]?.status).toBe('bad')
  })
})

describe('parseManifest', () => {
  const manifest = {
    name: 'ESPER player',
    version: '1.1.0',
    board: 'devkit-38',
    mediaOffset: 0xf0000,
    builds: [{ chipFamily: 'ESP32', parts: [{ path: 'a.bin', offset: 0x1000, size: 1, sha256: '' }] }],
  }

  it('refuses firmware built for the other board', () => {
    expect(() => parseManifest(manifest, 'devkit-30')).toThrow(/wrong one/)
    expect(parseManifest(manifest, 'devkit-38').board).toBe('devkit-38')
  })
})
