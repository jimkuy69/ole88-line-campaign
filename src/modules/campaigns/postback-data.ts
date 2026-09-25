export function campaignButtonPostback(code: string, buttonKey: string) {
  return `campaign:${encodeURIComponent(code)}:button:${encodeURIComponent(buttonKey)}`;
}

export function parseCampaignButtonPostback(data: string): { campaignCode: string; buttonKey: string } | null {
  const match = /^campaign:([^:]+):button:([^:]+)$/.exec(data);
  if (!match?.[1] || !match[2]) return null;
  try {
    return { campaignCode: decodeURIComponent(match[1]), buttonKey: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}
