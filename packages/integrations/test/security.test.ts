import { describe, expect, it } from 'vitest';
import { assertSafeHttpUrl, githubErrorMessage, missingGitHubPermissions, normalizePullRequestEvent, verifyGitHubSignature } from '../src';

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

  it('normalizes a real GitHub pull request webhook shape', () => {
    expect(normalizePullRequestEvent({action:'opened',repository:{id:42,full_name:'owner/repo'},pull_request:{number:7,title:'Fix',body:null,html_url:'https://github.com/owner/repo/pull/7',user:{login:'octocat'},base:{ref:'main'},head:{ref:'fix',sha:'abc123'}}})).toEqual({repository:'owner/repo',repositoryId:'42',prNumber:7,title:'Fix',body:'',author:'octocat',action:'opened',baseBranch:'main',headBranch:'fix',headSha:'abc123',url:'https://github.com/owner/repo/pull/7'});
  });
  it('formats GitHub API error bodies as readable sentences', async () => {
    const response=new Response(JSON.stringify({message:'Bad credentials'}),{status:401});
    await expect(githubErrorMessage(response)).resolves.toBe('GitHub API failed (401): Bad credentials');
  });

  it('names the permission a forbidden write needed', async () => {
    const review=await githubErrorMessage(Response.json({message:'Resource not accessible by integration'},{status:403,headers:{'x-ratelimit-remaining':'4999'}}));
    expect(review).toContain('GitHub API failed (403): Resource not accessible by integration');
    expect(review).toContain('accept the updated permissions');
  });

  it('reports required permissions the installation has not accepted', () => {
    expect(missingGitHubPermissions({metadata:'read',contents:'read',pull_requests:'write',checks:'write'})).toEqual([]);
    expect(missingGitHubPermissions({metadata:'read',contents:'read',pull_requests:'read'})).toEqual(['Pull requests: write','Checks: write']);
    expect(missingGitHubPermissions({metadata:'read',contents:'read',pull_requests:'admin',checks:'write'})).toEqual([]);
  });
});
