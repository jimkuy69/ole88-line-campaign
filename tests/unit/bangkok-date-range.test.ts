import { describe, expect, it } from 'vitest';
import { bangkokDateRange } from '../../src/modules/admin/bangkok-date-range.js';

describe('Bangkok review date ranges', () => {
  it('uses Bangkok midnight as the inclusive start and exclusive day-after end', () => {
    const range = bangkokDateRange('2026-09-26', '2026-09-26');
    expect(range.from?.toISOString()).toBe('2026-09-25T17:00:00.000Z');
    expect(range.to?.toISOString()).toBe('2026-09-26T17:00:00.000Z');
  });

  it('keeps adjacent calendar days contiguous at midnight', () => {
    const first = bangkokDateRange('2026-09-26', '2026-09-26');
    const next = bangkokDateRange('2026-09-27', '2026-09-27');
    expect(first.to?.getTime()).toBe(next.from?.getTime());
  });
});
