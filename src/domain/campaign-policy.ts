import { DomainError } from './errors.js';

export const CAMPAIGN_CLAIM_POLICIES = ['SINGLE_CLAIM'] as const;
export type CampaignClaimPolicy = (typeof CAMPAIGN_CLAIM_POLICIES)[number];

export function assertSupportedClaimPolicy(policy: string): asserts policy is CampaignClaimPolicy {
  if (!CAMPAIGN_CLAIM_POLICIES.includes(policy as CampaignClaimPolicy)) {
    throw new DomainError(`Unsupported campaign claim policy: ${policy}`, 'UNSUPPORTED_CLAIM_POLICY');
  }
}
