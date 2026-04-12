import { describe, test, expect } from 'bun:test'
import { generateOtpCode, isOtpExpired, isOtpExhausted, OTP_EXPIRY_MS, OTP_MAX_ATTEMPTS } from './otp'

describe('OTP', () => {
  test('generateOtpCode returns 6-digit string', () => {
    const code = generateOtpCode()
    expect(code).toMatch(/^\d{6}$/)
    expect(code.length).toBe(6)
  })
  test('generateOtpCode produces different codes', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateOtpCode()))
    expect(codes.size).toBeGreaterThan(1)
  })
  test('isOtpExpired returns false for fresh OTP', () => {
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS).toISOString()
    expect(isOtpExpired(expiresAt)).toBe(false)
  })
  test('isOtpExpired returns true for old OTP', () => {
    const expiresAt = new Date(Date.now() - 1000).toISOString()
    expect(isOtpExpired(expiresAt)).toBe(true)
  })
  test('isOtpExhausted returns false under limit', () => {
    expect(isOtpExhausted(OTP_MAX_ATTEMPTS - 1)).toBe(false)
  })
  test('isOtpExhausted returns true at limit', () => {
    expect(isOtpExhausted(OTP_MAX_ATTEMPTS)).toBe(true)
  })
  test('OTP_EXPIRY_MS is 10 minutes', () => {
    expect(OTP_EXPIRY_MS).toBe(10 * 60 * 1000)
  })
  test('OTP_MAX_ATTEMPTS is 5', () => {
    expect(OTP_MAX_ATTEMPTS).toBe(5)
  })
})
