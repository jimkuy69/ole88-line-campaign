import { describe, expect, it } from 'vitest';
import { CampaignService } from '../../src/modules/campaigns/campaign-service.js';
import { validateCampaignForPublish, validateCampaignForPublishDetailed } from '../../src/modules/campaigns/publish-validation.js';
import { campaignButtonPostback } from '../../src/modules/campaigns/postback-data.js';
import { buildCampaignCard } from '../../src/modules/webhooks/webhook-processor.js';
import { templateDraftSchema, TEMPLATES } from '../../src/modules/admin/templates.js';

const campaign = {
  code: 'WELCOME_TEST', name: 'Welcome Test', templateType: 'WELCOME', title: 'Welcome', heroImage: null,
  claimPolicy: 'SINGLE_CLAIM', startAt: null, endAt: null, maxClaims: null,
  rewardType: null, rewardValue: null,
};
const buttons = [{ buttonKey: 'BTN_CLAIM', label: 'Claim', actionType: 'POSTBACK',
  actionValue: campaignButtonPostback(campaign.code, 'BTN_CLAIM'), enabled: true }];
const activities = [{ activityKey: 'JOIN', title: 'Join', actionType: 'URI', actionValue: 'https://example.org/join', enabled: true }];
const messages = ['WELCOME_MESSAGE', 'CLAIM_CREATED', 'CLAIM_ALREADY_EXISTS']
  .map((messageKey) => ({ messageKey, content: 'Configured message' }));

describe('campaign publish validation', () => {
  it('rejects unsafe secondary image URLs when saving a draft', () => {
    const template = TEMPLATES.find(({ id }) => id === 'welcome-claim');
    if (!template) throw new Error('Welcome template fixture is required.');
    const result = templateDraftSchema.safeParse({
      ...template.draft,
      campaign: { ...template.draft.campaign, settings: { secondaryImage: 'http://example.org/image.png' } }
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(issue => issue.path.join('.')))
        .toContain('campaign.settings.secondaryImage');
    }
  });

  it('accepts complete campaigns and reports required omissions', () => {
    expect(validateCampaignForPublish(campaign, buttons, activities, messages)).toEqual([]);
    const issues = validateCampaignForPublish({ ...campaign, title: null }, [], [], []);
    expect(issues).toContain('Campaign title is required.');
    expect(issues).toContain('An enabled BTN_CLAIM button is required.');
    expect(issues).toContain('At least one enabled campaign activity is required.');
    expect(issues).toContain('Campaign message WELCOME_MESSAGE is required.');
  });

  it('rejects invalid claim policies at publication', () => {
    expect(validateCampaignForPublish({ ...campaign, claimPolicy: 'MULTI_CLAIM' }, buttons, activities, messages))
      .toContain('claimPolicy must be one of: SINGLE_CLAIM (received MULTI_CLAIM)');
  });

  it('rejects unsafe hero image URLs before publication', () => {
    expect(validateCampaignForPublish({ ...campaign, heroImage: 'http://example.org/image.png' }, buttons, activities, messages))
      .toContain('Hero image must be an HTTPS URL without embedded credentials.');
    expect(validateCampaignForPublish({ ...campaign, settings:{secondaryImage:'http://example.org/image.png'} }, buttons, activities, messages))
      .toContain('Secondary image must be an HTTPS URL without embedded credentials.');
  });

  it('rejects a rendered activity card that exceeds LINE Flex bubble size with a field path',()=>{
    const oversized=Array.from({length:9},(_,index)=>({activityKey:`TASK_${index}`,title:`Task ${index}`,description:'x'.repeat(4000),
      actionType:'URI',actionValue:'https://example.org/task',enabled:true}));
    expect(validateCampaignForPublishDetailed(campaign,buttons,oversized,messages)).toEqual(expect.arrayContaining([
      expect.objectContaining({path:'activities',message:expect.stringContaining('30 KB')}),
    ]));
  });

  it('renders the configured claim label, URI button, image, and exact postback data', () => {
    const card = buildCampaignCard({ title: 'DB title', subtitle: 'DB subtitle', heroImage: 'https://example.org/hero.png' }, [
      { buttonKey: 'BTN_CLAIM', label: 'DB claim', actionType: 'POSTBACK', actionValue: campaignButtonPostback('WELCOME_TEST', 'BTN_CLAIM'), enabled: true },
      { buttonKey: 'BTN_PROMOTION', label: 'DB promotion', actionType: 'URI', actionValue: 'https://example.org/promo', enabled: true },
    ]);
    const rendered = JSON.stringify(card);
    expect(rendered).toContain('DB title');
    expect(rendered).toContain('DB claim');
    expect(rendered).toContain('DB promotion');
    expect(rendered).toContain('campaign:WELCOME_TEST:button:BTN_CLAIM');
    expect(rendered).toContain('https://example.org/hero.png');
    expect(rendered).toContain('https://example.org/promo');
  });

  it('renders a configured secondary campaign image inside the Flex card', () => {
    const card=buildCampaignCard({title:'Two images',subtitle:null,heroImage:'https://example.org/hero.png',
      settings:{secondaryImage:'https://example.org/details.png'}},buttons);
    expect(JSON.stringify(card)).toContain('https://example.org/details.png');
  });

  it('does not allow bypassing validation through direct ACTIVE create or update', async () => {
    const db = {} as ConstructorParameters<typeof CampaignService>[0];
    const service = new CampaignService(db);
    await expect(service.createCampaign({ ...campaign, status: 'ACTIVE' } as never))
      .rejects.toMatchObject({ code: 'PUBLISH_VALIDATION_REQUIRED' });
    await expect(service.updateCampaign('id', { status: 'ACTIVE' }))
      .rejects.toMatchObject({ code: 'PUBLISH_VALIDATION_REQUIRED' });
    await expect(service.createCampaign({ ...campaign, claimPolicy: 'MULTI_CLAIM' } as never))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CLAIM_POLICY' });
  });
});
