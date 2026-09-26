import { describe, expect, it, vi } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { orderEnabledActivities } from '../../src/modules/campaigns/campaign-service.js';
import { TrackingService } from '../../src/modules/tracking/tracking-service.js';

describe('campaign and tracking foundation', () => {
  it('supports a dynamic number of ordered activities without a fixed count', () => {
    const rows = Array.from({ length: 11 }, (_, index) => ({ activityKey: `A${index}`, displayOrder: 10 - index, enabled: true }));
    rows.push({ activityKey: 'disabled', displayOrder: 20, enabled: false });
    const ordered = orderEnabledActivities(rows);
    expect(ordered).toHaveLength(11);
    expect(ordered[0]?.displayOrder).toBe(0);
  });

  it('records a provider-neutral tracking event', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'track-1' }]);
    const values = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockReturnValue({ returning }) });
    const insert = vi.fn().mockReturnValue({ values });
    const service = new TrackingService({ insert } as never);
    await expect(service.trackEvent({ eventType: 'BUTTON_CLICK', buttonKey: 'BTN_PROMOTION' })).resolves.toEqual({ id: 'track-1' });
    expect(insert).toHaveBeenCalledWith(schema.trackingEvents);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'BUTTON_CLICK', buttonKey: 'BTN_PROMOTION' }));
  });
});
