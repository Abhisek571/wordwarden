import { describe, expect, it } from 'vitest';
import { issueHash } from '#/core/hash';

describe('issueHash', () => {
  it('is deterministic and does not retain source text', () => {
    const first = issueHash('Rule', 'private sentence');
    const second = issueHash('Rule', 'private sentence');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}$/u);
    expect(first).not.toContain('private');
  });
});
