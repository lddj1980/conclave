import crypto from 'node:crypto';

export const DEFAULT_TOKEN_TTL_DAYS = 30;

export function createAgentToken(): string {
  const rand = crypto.randomBytes(24).toString('base64url');
  return `agt_${rand}`;
}

export function hashAgentToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function secureTokenEqual(token: string, tokenHash: string): boolean {
  const computed = hashAgentToken(token);
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(tokenHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createChallengeNonce(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function computeTokenExpiry(now = new Date(), ttlDays = DEFAULT_TOKEN_TTL_DAYS): Date {
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}

export function verifyEd25519Signature(message: string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    const sig = Buffer.from(signatureBase64, 'base64');
    const msg = Buffer.from(message, 'utf8');
    return crypto.verify(null, msg, publicKeyPem, sig);
  } catch {
    return false;
  }
}

export function generateEd25519KeypairPem(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}
