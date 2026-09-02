import { describe, expect, it } from 'vitest';
import { assertSafeHttpUrl, verifyGitHubSignature } from '../src';

describe('integration security', () => {
  it('accepts a valid GitHub HMAC and rejects tampering', async () => {
    const payload = '{"action":"opened"}';
    const secret = 'test-secret';
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
    const signature = `sha256=${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    await expect(verifyGitHubSignature(payload, signature, secret)).resolves.toBe(true);
    await expect(verifyGitHubSignature(`${payload}x`, signature, secret)).resolves.toBe(false);
  });

  it('blocks obvious internal HTTP destinations', () => {
    expect(() => assertSafeHttpUrl('http://example.com')).toThrow('HTTPS');
    expect(() => assertSafeHttpUrl('https://127.0.0.1/admin')).toThrow('blocked');
    expect(() => assertSafeHttpUrl('https://192.168.1.4/hook')).toThrow('blocked');
    expect(assertSafeHttpUrl('https://example.com/hook').hostname).toBe('example.com');
  });
});
