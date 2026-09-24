import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** base64url without padding, per RFC 7636. */
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Opaque, cryptographically random continuation code. */
export function generateContinuationCode(): string {
  return base64url(randomBytes(32));
}

/** S256: BASE64URL(SHA256(ASCII(verifier))). */
export function s256(verifier: string): string {
  return base64url(createHash('sha256').update(verifier, 'ascii').digest());
}

/** Hash under which a continuation code is persisted. The code is never stored. */
export function hashCode(code: string): string {
  return createHash('sha256').update(code, 'ascii').digest('hex');
}

/** Constant-time string comparison. Length mismatch short-circuits by design. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Test/demo helper: a PKCE verifier of the RFC 7636 permitted length. */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}
