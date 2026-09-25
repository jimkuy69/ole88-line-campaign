import { describe, expect, it } from 'vitest';
import { assertClaimTransition, canTransitionClaim } from '../../src/domain/claim-state.js';
import { DomainError } from '../../src/domain/errors.js';

describe('claim state machine', () => {
  it('accepts valid progression and rejects terminal-state regression', () => {
    expect(canTransitionClaim('CLAIM_CREATED', 'ACTIVITY_SENT')).toBe(true);
    expect(canTransitionClaim('APPROVED', 'CLAIM_CREATED')).toBe(false);
    expect(() => assertClaimTransition('APPROVED', 'CLAIM_CREATED')).toThrow(DomainError);
  });
});
