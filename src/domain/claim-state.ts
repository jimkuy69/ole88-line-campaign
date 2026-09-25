import { DomainError } from './errors.js';

export const CLAIM_STATES = [
  'NEW', 'ELIGIBLE', 'CLAIM_CREATED', 'ACTIVITY_SENT', 'IN_PROGRESS', 'PROOF_SUBMITTED',
  'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REWARD_SENT', 'EXPIRED', 'CANCELLED',
] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

const transitions: Record<ClaimState, readonly ClaimState[]> = {
  NEW: ['ELIGIBLE', 'EXPIRED', 'CANCELLED'],
  ELIGIBLE: ['CLAIM_CREATED', 'EXPIRED', 'CANCELLED'],
  CLAIM_CREATED: ['ACTIVITY_SENT', 'IN_PROGRESS', 'EXPIRED', 'CANCELLED'],
  ACTIVITY_SENT: ['IN_PROGRESS', 'PROOF_SUBMITTED', 'EXPIRED', 'CANCELLED'],
  IN_PROGRESS: ['PROOF_SUBMITTED', 'EXPIRED', 'CANCELLED'],
  PROOF_SUBMITTED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['REWARD_SENT'],
  // A rejected claim can re-enter the proof workflow after the customer submits corrected evidence.
  REJECTED: ['IN_PROGRESS'], REWARD_SENT: [], EXPIRED: [], CANCELLED: [],
};

export function canTransitionClaim(from: ClaimState, to: ClaimState): boolean {
  return transitions[from].includes(to);
}

export function assertClaimTransition(from: ClaimState, to: ClaimState): void {
  if (!canTransitionClaim(from, to)) {
    throw new DomainError(`Claim transition ${from} -> ${to} is not allowed`, 'INVALID_CLAIM_TRANSITION');
  }
}

export function allowedClaimTransitions(from: ClaimState): readonly ClaimState[] {
  return transitions[from];
}
