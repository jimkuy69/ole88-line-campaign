import { describe, expect, it } from 'vitest';
import { ClaimService, type CampaignForClaim, type ClaimRecord, type ClaimStore, type ClaimUnitOfWork } from '../../src/modules/claims/claim-service.js';

class MemoryClaimStore implements ClaimStore {
  readonly campaign: CampaignForClaim = { id: 'campaign-1', status: 'ACTIVE', startAt: null, endAt: null, maxClaims: null, claimPolicy: 'SINGLE_CLAIM' };
  private readonly records = new Map<string, ClaimRecord>();
  private tail: Promise<void> = Promise.resolve();

  async transaction<T>(work: (tx: ClaimUnitOfWork) => Promise<T>): Promise<T> {
    const before = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await before;
    try {
      return await work({
        getCampaignForUpdate: async (code) => code === 'WELCOME_TEST' ? this.campaign : null,
        getExistingClaim: async (userId, campaignId) => [...this.records.values()].find((row) => row.userId === userId && row.campaignId === campaignId) ?? null,
        countClaims: async (campaignId) => [...this.records.values()].filter((row) => row.campaignId === campaignId).length,
        insertClaimOnConflictDoNothing: async (input) => {
          if ([...this.records.values()].some((row) => row.userId === input.userId && row.campaignId === input.campaignId)) return null;
          this.records.set(input.id, input);
          return input;
        },
      });
    } finally {
      release();
    }
  }

  async getClaim(id: string) { return this.records.get(id) ?? null; }

  async updateClaimState(id: string, expected: ClaimRecord['status'], next: ClaimRecord['status']) {
    const current = this.records.get(id);
    if (!current || current.status !== expected) return null;
    const updated = { ...current, status: next };
    this.records.set(id, updated);
    return updated;
  }
}

describe('claim service', () => {
  it('creates the first claim and returns that claim on a repeat request', async () => {
    const service = new ClaimService(new MemoryClaimStore());
    const first = await service.createClaim('user-1', 'WELCOME_TEST');
    const second = await service.createClaim('user-1', 'WELCOME_TEST');
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.claim.id).toBe(first.claim.id);
  });

  it('serializes concurrent attempts so only one claim is created', async () => {
    const service = new ClaimService(new MemoryClaimStore());
    const results = await Promise.all(Array.from({ length: 12 }, () => service.createClaim('user-1', 'WELCOME_TEST')));
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.claim.id)).size).toBe(1);
  });

  it('rejects disabled or expired campaigns', async () => {
    const disabledStore = new MemoryClaimStore();
    disabledStore.campaign.status = 'PAUSED';
    await expect(new ClaimService(disabledStore).createClaim('user-1', 'WELCOME_TEST')).rejects.toMatchObject({ code: 'CAMPAIGN_DISABLED' });

    const expiredStore = new MemoryClaimStore();
    expiredStore.campaign.endAt = new Date('2020-01-01T00:00:00.000Z');
    await expect(new ClaimService(expiredStore, () => new Date('2021-01-01T00:00:00.000Z')).createClaim('user-1', 'WELCOME_TEST'))
      .rejects.toMatchObject({ code: 'CAMPAIGN_OUT_OF_SCHEDULE' });
  });

  it('rejects unsupported claim policies explicitly', async () => {
    const store = new MemoryClaimStore();
    store.campaign.claimPolicy = 'MULTI_CLAIM';
    await expect(new ClaimService(store).createClaim('user-1', 'WELCOME_TEST'))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CLAIM_POLICY' });
  });
});
