import { assertSupportedClaimPolicy } from '../../domain/campaign-policy.js';
import { campaignButtonPostback } from './postback-data.js';
import { buildActivityCard, buildCampaignCard } from '../../integrations/line/campaign-renderer.js';

type PublishCampaign = {
  code: string;
  name: string;
  templateType: string;
  title: string | null;
  subtitle?: string | null;
  heroImage: string | null;
  claimPolicy: string;
  startAt: Date | null;
  endAt: Date | null;
  maxClaims: number | null;
  rewardType: string | null;
  rewardValue: string | null;
  settings?: Record<string, unknown>;
};
type PublishButton = { buttonKey: string; label: string; actionType: string; actionValue: string | null; enabled: boolean };
type PublishActivity = { activityKey: string; title: string; description?: string|null; actionType: string; actionValue: string | null; enabled: boolean };
type PublishMessage = { messageKey: string; content: string };

function validHttpsUrl(value: string | null, maxLength = 2000) {
  if (!value || value.length>maxLength) return false;
  try {
    const url = new URL(value);
    const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
    return url.protocol === 'https:' && !url.username && !url.password && host!=='localhost'&&!host.endsWith('.localhost')
      &&!/^127\./.test(host)&&host!=='::'&&host!=='::1'&&!/^::ffff:/i.test(host)&&!/^f[cd]/i.test(host)&&!/^fe[89ab]/i.test(host)
      &&!/^10\./.test(host)&&!/^192\.168\./.test(host)&&!/^169\.254\./.test(host)&&!/^172\.(1[6-9]|2\d|3[01])\./.test(host);
  } catch {
    return false;
  }
}

function validAction(actionType: string, actionValue: string | null) {
  if (actionType === 'URI') return validHttpsUrl(actionValue,1000);
  if (actionType === 'POSTBACK') return Boolean(actionValue?.trim()) && (actionValue?.length ?? 301) <= 300;
  return false;
}

export function validateCampaignForPublish(
  campaign: PublishCampaign,
  buttons: PublishButton[],
  activities: PublishActivity[],
  messages: PublishMessage[],
) {
  return validateCampaignForPublishDetailed(campaign, buttons, activities, messages).map((issue) => issue.message);
}

export function validateCampaignForPublishDetailed(
  campaign: PublishCampaign,
  buttons: PublishButton[],
  activities: PublishActivity[],
  messages: PublishMessage[],
) {
  const issues: Array<{path:string;message:string}> = [];
  const add = (path:string,message:string) => issues.push({path,message});
  try { assertSupportedClaimPolicy(campaign.claimPolicy); }
  catch { add('campaign.claimPolicy',`claimPolicy must be one of: SINGLE_CLAIM (received ${campaign.claimPolicy})`); }

  if (!campaign.code.trim()) add('campaign.code','Campaign code is required.');
  if (!campaign.name.trim()) add('campaign.name','Campaign name is required.');
  if (!campaign.templateType.trim()) add('campaign.templateType','Template type is required.');
  if (!campaign.title?.trim()) add('campaign.title','Campaign title is required.');
  if (campaign.heroImage && !validHttpsUrl(campaign.heroImage)) add('campaign.heroImage','Hero image must be an HTTPS URL without embedded credentials.');
  const secondaryImage=campaign.settings?.secondaryImage;
  if (typeof secondaryImage==='string'&&secondaryImage&&!validHttpsUrl(secondaryImage)) add('campaign.settings.secondaryImage','Secondary image must be an HTTPS URL without embedded credentials.');
  if (campaign.startAt && campaign.endAt && campaign.startAt >= campaign.endAt) add('campaign.endAt','End date must be after start date.');
  if (campaign.maxClaims !== null && campaign.maxClaims < 1) add('campaign.maxClaims','Maximum claims must be a positive integer.');
  if (Boolean(campaign.rewardType?.trim()) !== Boolean(campaign.rewardValue?.trim())) {
    add('campaign.rewardValue','Reward type and reward value must either both be set or both be empty.');
  }

  const messageByKey = new Map(messages.map((message) => [message.messageKey, message.content]));
  for (const key of ['WELCOME_MESSAGE', 'CLAIM_CREATED', 'CLAIM_ALREADY_EXISTS']) {
    if (!messageByKey.get(key)?.trim()) add(`messages.${key}`,`Campaign message ${key} is required.`);
  }

  const claimButton = buttons.find((button) => button.buttonKey === 'BTN_CLAIM' && button.enabled);
  if (!claimButton) {
    add('buttons.BTN_CLAIM','An enabled BTN_CLAIM button is required.');
  } else if (claimButton.actionType !== 'POSTBACK'
    || claimButton.actionValue !== campaignButtonPostback(campaign.code, 'BTN_CLAIM')) {
    add('buttons.BTN_CLAIM.actionValue','BTN_CLAIM must use its campaign-specific claim postback.');
  }

  for (const [index,button] of buttons.entries()) if (button.enabled) {
    if (!button.label.trim()) add(`buttons[${index}].label`,`Enabled button ${button.buttonKey} needs a label.`);
    if (!validAction(button.actionType, button.actionValue)) add(`buttons[${index}].actionValue`,`Enabled button ${button.buttonKey} has an invalid action value.`);
  }

  const enabledActivities = activities.filter((activity) => activity.enabled);
  if (enabledActivities.length === 0) add('activities','At least one enabled campaign activity is required.');
  for (const [index,activity] of activities.entries()) if (activity.enabled) {
    if (!activity.title.trim()) add(`activities[${index}].title`,`Enabled activity ${activity.activityKey} needs a title.`);
    if (!validAction(activity.actionType, activity.actionValue)) add(`activities[${index}].actionValue`,`Enabled activity ${activity.activityKey} has an invalid action value.`);
  }
  try { buildCampaignCard({...campaign,subtitle:campaign.subtitle??null},buttons); } catch(error) { add('buttons',error instanceof Error?error.message:'Campaign card cannot be rendered.'); }
  if(enabledActivities.length)try { buildActivityCard({title:campaign.title,subtitle:campaign.subtitle??null},enabledActivities); } catch(error) { add('activities',error instanceof Error?error.message:'Activity card cannot be rendered.'); }
  return issues;
}
