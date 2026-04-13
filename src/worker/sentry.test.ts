import { describe, test, expect, mock } from 'bun:test'
import { createSentry, captureException } from './sentry'

describe('createSentry', () => {
  const fakeRequest = new Request('https://example.com/api/test')
  const fakeCtx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext

  test('returns null when SENTRY_DSN is not set', () => {
    const result = createSentry(fakeRequest, {}, fakeCtx)
    expect(result).toBeNull()
  })

  test('returns null when SENTRY_DSN is empty string', () => {
    const result = createSentry(fakeRequest, { SENTRY_DSN: '' }, fakeCtx)
    expect(result).toBeNull()
  })

  test('returns Toucan instance when SENTRY_DSN is set', () => {
    const result = createSentry(
      fakeRequest,
      { SENTRY_DSN: 'https://abc123@o0.ingest.sentry.io/0' },
      fakeCtx,
    )
    expect(result).not.toBeNull()
    expect(typeof result!.captureException).toBe('function')
    expect(typeof result!.setUser).toBe('function')
    expect(typeof result!.setTag).toBe('function')
    expect(typeof result!.setExtra).toBe('function')
  })
})

describe('captureException', () => {
  test('does nothing when sentry is null', () => {
    // Should not throw
    captureException(null, new Error('test'))
    captureException(null, new Error('test'), { key: 'val' })
  })

  test('calls captureException on sentry instance', () => {
    const mockCapture = mock(() => 'event-id')
    const mockSetExtra = mock(() => {})
    const fakeSentry = {
      captureException: mockCapture,
      setExtra: mockSetExtra,
    } as any

    const err = new Error('test error')
    captureException(fakeSentry, err)

    expect(mockCapture).toHaveBeenCalledWith(err)
    expect(mockSetExtra).not.toHaveBeenCalled()
  })

  test('sets extras before capturing', () => {
    const mockCapture = mock(() => 'event-id')
    const mockSetExtra = mock(() => {})
    const fakeSentry = {
      captureException: mockCapture,
      setExtra: mockSetExtra,
    } as any

    const err = new Error('with extras')
    captureException(fakeSentry, err, { route: '/api/test', status: 500 })

    expect(mockSetExtra).toHaveBeenCalledTimes(2)
    expect(mockSetExtra).toHaveBeenCalledWith('route', '/api/test')
    expect(mockSetExtra).toHaveBeenCalledWith('status', 500)
    expect(mockCapture).toHaveBeenCalledWith(err)
  })
})
