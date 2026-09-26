import { campaignButtonPostback } from './postback-data.js';

export const CAMPAIGN_ACTION_REGISTRY = {
  version: 1,
  URI: {
    support: 'SUPPORTED',
    targets: ['button', 'activity'],
    description: 'LINE Flex URI action; requires an HTTPS destination.',
  },
  POSTBACK: {
    support: 'CONDITIONAL',
    targets: ['button'],
    description: 'Only the generated BTN_CLAIM postback is processed by the current webhook.',
  },
} as const;

export type CampaignActionTarget = {
  type: 'button' | 'activity';
  key: string;
  actionType: string;
  actionValue: string | null;
};

export function campaignActionSupport(target: CampaignActionTarget, campaignCode: string) {
  if (target.actionType === 'URI') {
    if (!target.actionValue?.trim()) return { supported: false, reason: 'URI action has no destination.' };
    if (target.actionValue.length > 1000) return { supported: false, reason: 'URI action exceeds the current 1000-character limit.' };
    if (target.actionValue !== target.actionValue.trim()) return { supported: false, reason: 'URI action must not contain leading or trailing whitespace.' };
    try {
      const url = new URL(target.actionValue);
      const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (url.protocol === 'https:' && !url.username && !url.password && host !== 'localhost'
        && !host.endsWith('.localhost') && !/^127\./.test(host) && host !== '::' && host !== '::1'
        && !/^::ffff:/i.test(host) && !/^f[cd]/i.test(host) && !/^fe[89ab]/i.test(host)
        && !/^10\./.test(host) && !/^192\.168\./.test(host) && !/^169\.254\./.test(host)
        && !/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return { supported: true, reason: null };
    } catch {
      return { supported: false, reason: 'URI action must be a valid public HTTPS URL.' };
    }
    return { supported: false, reason: 'URI action must be a valid public HTTPS URL.' };
  }
  if (target.actionType === 'POSTBACK' && target.type === 'button' && target.key === 'BTN_CLAIM'
    && target.actionValue === campaignButtonPostback(campaignCode, 'BTN_CLAIM')) {
    return { supported: true, reason: null };
  }
  return { supported: false, reason: 'This action is not processed by the current campaign/webhook flow.' };
}
