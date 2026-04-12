import { describe, test, expect } from 'bun:test'
import { normalizeEmail } from './normalize-email'

describe('normalizeEmail', () => {
  test('lowercases all emails', () => {
    expect(normalizeEmail('Alice@Example.COM')).toBe('alice@example.com')
  })
  test('removes dots from Gmail local part', () => {
    expect(normalizeEmail('c.w.chen@gmail.com')).toBe('cwchen@gmail.com')
  })
  test('removes plus tag from Gmail', () => {
    expect(normalizeEmail('cwchen+test@gmail.com')).toBe('cwchen@gmail.com')
  })
  test('removes dots AND plus tag from Gmail', () => {
    expect(normalizeEmail('c.w.chen+work@gmail.com')).toBe('cwchen@gmail.com')
  })
  test('treats googlemail.com as Gmail', () => {
    expect(normalizeEmail('c.w.chen+x@googlemail.com')).toBe('cwchen@googlemail.com')
  })
  test('removes plus tag from non-Gmail but keeps dots', () => {
    expect(normalizeEmail('john.doe+tag@outlook.com')).toBe('john.doe@outlook.com')
  })
  test('preserves dots in non-Gmail addresses', () => {
    expect(normalizeEmail('first.last@company.com')).toBe('first.last@company.com')
  })
  test('handles email without plus tag', () => {
    expect(normalizeEmail('user@domain.org')).toBe('user@domain.org')
  })
  test('handles already-normalized email', () => {
    expect(normalizeEmail('cwchen2000@gmail.com')).toBe('cwchen2000@gmail.com')
  })
})
