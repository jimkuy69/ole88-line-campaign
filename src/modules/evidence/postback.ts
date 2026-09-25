export function evidenceRequestPostback(campaignCode: string, activityKey: string) {
  return `evidence:request:${campaignCode}:${activityKey}`;
}

export function parseEvidenceRequestPostback(value: string): { campaignCode: string; activityKey: string } | null {
  const match = /^evidence:request:([A-Za-z0-9_-]{2,100}):([A-Za-z0-9_-]{1,100})$/.exec(value);
  return match ? { campaignCode: match[1]!, activityKey: match[2]! } : null;
}
