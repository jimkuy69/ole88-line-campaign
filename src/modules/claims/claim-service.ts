import { randomUUID } from 'node:crypto';
import { assertClaimTransition, type ClaimState } from '../../domain/claim-state.js';
import { assertSupportedClaimPolicy } from '../../domain/campaign-policy.js';
import { DomainError } from '../../domain/errors.js';

export interface CampaignForClaim {
  id: string;
  status: string;
  startAt: Date | null;
  endAt: Date | null;
  maxClaims: number | null;
  claimPolicy: string;
}

export interface ClaimRecord {
  id: string;
  userId: string;
  campaignId: string;
  status: ClaimState;
  claimCode: string;
}

export interface ClaimUnitOfWork {
  getCampaignForUpdate(code: string): Promise<CampaignForClaim | null>;
  getExistingClaim(userId: string, campaignId: string): Promise<ClaimRecord | null>;
  countClaims(campaignId: string): Promise<number>;
  insertClaimOnConflictDoNothing(input: ClaimRecord): Promise<ClaimRecord | null>;
  trackClaimRequest?(input: { sourceEventId: string; userId: string; campaignId: string; claimId: string; created: boolean }): Promise<void>;
}

export interface ClaimStore {
  transaction<T>(work: (tx: ClaimUnitOfWork) => Promise<T>): Promise<T>;
  getClaim(id: string): Promise<ClaimRecord | null>;
  updateClaimState(id: string, expected: ClaimState, next: ClaimState, at: Date): Promise<ClaimRecord | null>;
}

export class ClaimService {
  constructor(private readonly store: ClaimStore, private readonly now: () => Date = () => new Date()) {}

  checkEligibility(campaign: CampaignForClaim, existing: ClaimRecord | null, claimsCount: number, at = this.now()) {
    assertSupportedClaimPolicy(campaign.claimPolicy);
    if (existing) return { eligible: false, reason: 'ALREADY_CLAIMED' as const };
    if (campaign.status !== 'ACTIVE') return { eligible: false, reason: 'CAMPAIGN_DISABLED' as const };
    if ((campaign.startAt && campaign.startAt > at) || (campaign.endAt && campaign.endAt < at)) {
      return { eligible: false, reason: 'CAMPAIGN_OUT_OF_SCHEDULE' as const };
    }
    if (campaign.maxClaims !== null && claimsCount >= campaign.maxClaims) {
      return { eligible: false, reason: 'CAMPAIGN_LIMIT_REACHED' as const };
    }
    return { eligible: true as const, reason: null };
  }

  async createClaim(userId: string, campaignCode: string, sourceEventId?: string) {
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const campaign = await tx.getCampaignForUpdate(campaignCode);
      if (!campaign) throw new DomainError('Campaign not found', 'CAMPAIGN_NOT_FOUND');

      const existing = await tx.getExistingClaim(userId, campaign.id);
      if (existing) {
        if (sourceEventId) await tx.trackClaimRequest?.({sourceEventId,userId,campaignId:campaign.id,claimId:existing.id,created:false});
        return { claim: existing, created: false };
      }

      const eligible = this.checkEligibility(campaign, null, await tx.countClaims(campaign.id), at);
      if (!eligible.eligible) throw new DomainError(`Claim is not eligible: ${eligible.reason}`, eligible.reason);

      const created = await tx.insertClaimOnConflictDoNothing({
        id: randomUUID(), userId, campaignId: campaign.id, status: 'CLAIM_CREATED', claimCode: randomUUID(),
      });
      if (created) {
        if (sourceEventId) await tx.trackClaimRequest?.({sourceEventId,userId,campaignId:campaign.id,claimId:created.id,created:true});
        return { claim: created, created: true };
      }

      const concurrentClaim = await tx.getExistingClaim(userId, campaign.id);
      if (concurrentClaim) {
        if (sourceEventId) await tx.trackClaimRequest?.({sourceEventId,userId,campaignId:campaign.id,claimId:concurrentClaim.id,created:false});
        return { claim: concurrentClaim, created: false };
      }
      throw new DomainError('Claim insert conflicted without an existing claim', 'CLAIM_CREATE_CONFLICT');
    });
  }

  async getExistingClaim(userId: string, campaignId: string) {
    return this.store.transaction((tx) => tx.getExistingClaim(userId, campaignId));
  }

  async getClaimStatus(claimId: string) {
    const claim = await this.store.getClaim(claimId);
    if (!claim) throw new DomainError('Claim not found', 'CLAIM_NOT_FOUND');
    return claim.status;
  }

  async transitionClaim(claimId: string, next: ClaimState) {
    const claim = await this.store.getClaim(claimId);
    if (!claim) throw new DomainError('Claim not found', 'CLAIM_NOT_FOUND');
    assertClaimTransition(claim.status, next);
    const updated = await this.store.updateClaimState(claim.id, claim.status, next, this.now());
    if (!updated) throw new DomainError('Claim changed concurrently; reload and retry', 'CLAIM_STATE_CONFLICT');
    return updated;
  }
}
