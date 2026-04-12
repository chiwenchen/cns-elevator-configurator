export const OTP_EXPIRY_MS = 10 * 60 * 1000
export const OTP_MAX_ATTEMPTS = 5
export const OTP_RATE_LIMIT_MS = 60 * 1000
export const OTP_HOURLY_LIMIT = 5

export function generateOtpCode(): string {
  const array = new Uint32Array(1)
  crypto.getRandomValues(array)
  const num = array[0]! % 1000000
  return String(num).padStart(6, '0')
}

export function isOtpExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now()
}

export function isOtpExhausted(attempts: number): boolean {
  return attempts >= OTP_MAX_ATTEMPTS
}

export function getOtpExpiresAt(): string {
  return new Date(Date.now() + OTP_EXPIRY_MS).toISOString()
}
