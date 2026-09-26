export function bangkokDateRange(from?: string, to?: string) {
  return {
    from: from ? bangkokMidnight(from) : undefined,
    to: to ? bangkokMidnight(to, 1) : undefined,
  };
}

function bangkokMidnight(date: string, dayOffset = 0) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + dayOffset) - 7 * 60 * 60 * 1000);
}
