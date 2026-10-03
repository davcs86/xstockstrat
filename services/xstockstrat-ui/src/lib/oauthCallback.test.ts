import { describe, expect, it } from 'vitest';
import { resolveAgentCallback } from './oauthCallback';

const AGENT = 'https://app.example/agent';
const CB = `${AGENT}/oauth/callback`;

describe('resolveAgentCallback', () => {
  it('accepts the exact agent callback', () => {
    expect(resolveAgentCallback(CB, AGENT)).toBe(CB);
  });

  it('tolerates a trailing slash on AGENT_PUBLIC_URL', () => {
    expect(resolveAgentCallback(CB, `${AGENT}/`)).toBe(CB);
  });

  it.each([
    ['javascript URL', 'javascript:alert(document.domain)//'],
    ['foreign origin', 'https://attacker.example/cb'],
    ['prefix-extended path', `${CB}/../../evil`],
    ['look-alike host', 'https://app.example.attacker.example/agent/oauth/callback'],
    ['protocol-relative', '//attacker.example/agent/oauth/callback'],
    ['missing', null],
  ])('rejects %s', (_label, agentCb) => {
    expect(resolveAgentCallback(agentCb, AGENT)).toBeNull();
  });

  it.each([undefined, '', 'javascript:x'])('rejects when AGENT_PUBLIC_URL is %j', (base) => {
    expect(resolveAgentCallback('javascript:x/oauth/callback', base)).toBeNull();
  });
});
