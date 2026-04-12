export interface JwtPayload {
  sub: string
  jti: string
  role: string
  exp: number
  iat: number
}

function base64UrlEncode(data: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...data))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (str.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

async function getKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signJwt(payload: { sub: string; jti: string; role: string }, secret: string, expiresInSeconds: number): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const fullPayload: JwtPayload = { ...payload, iat: now, exp: now + expiresInSeconds }
  const encoder = new TextEncoder()
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)))
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(fullPayload)))
  const signingInput = `${headerB64}.${payloadB64}`
  const key = await getKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput))
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Malformed JWT')
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string]
  const signingInput = `${headerB64}.${payloadB64}`
  const key = await getKey(secret)
  const encoder = new TextEncoder()
  const signature = base64UrlDecode(signatureB64)
  const valid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(signingInput))
  if (!valid) throw new Error('Invalid signature')
  const payload: JwtPayload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)))
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired')
  return payload
}
