import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { createDatabase } from './client.js';
import { campaignActivities, campaignButtons, campaignMessages, campaigns } from './schema.js';
import { campaignButtonPostback } from '../modules/campaigns/postback-data.js';

async function seed() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const { db, pool } = createDatabase(connectionString);
  try {
    await db.insert(campaigns).values({
      code: 'OLE88_WELCOME_100', name: 'OLE88 Welcome 100', templateType: 'WELCOME_CAMPAIGN',
      status: 'DRAFT', claimPolicy: 'SINGLE_CLAIM', title: 'Welcome campaign', rewardType: 'CREDIT', rewardValue: '100',
    }).onConflictDoNothing({ target: campaigns.code });
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.code, 'OLE88_WELCOME_100')).limit(1);
    if (!campaign) throw new Error('Seed campaign could not be loaded');

    const buttons = [
      ['BTN_PLAY', 'Play', 'URI'], ['BTN_CLAIM', 'Claim', 'POSTBACK'],
      ['BTN_PROMOTION', 'Promotion', 'URI'], ['BTN_CASHBACK', 'Cashback', 'URI'], ['BTN_REFERRAL', 'Referral', 'URI'],
    ] as const;
    await db.insert(campaignButtons).values(buttons.map(([buttonKey, label, actionType], displayOrder) => ({
      campaignId: campaign.id, buttonKey, label, actionType,
      actionValue: buttonKey === 'BTN_CLAIM' ? campaignButtonPostback(campaign.code, buttonKey) : null,
      enabled: buttonKey === 'BTN_CLAIM', displayOrder,
    }))).onConflictDoNothing();

    const activities = Array.from({ length: 4 }, (_, index) => ({
      campaignId: campaign.id, activityKey: `ACTIVITY_${index + 1}`, title: `Activity ${index + 1}`,
      description: 'Configure this example activity before publishing.', actionType: 'URI',
      actionValue: null, displayOrder: index + 1, required: false, enabled: false,
    }));
    await db.insert(campaignActivities).values(activities).onConflictDoNothing();
    await db.insert(campaignMessages).values([
      ['WELCOME_MESSAGE', 'Welcome to this example campaign.'],
      ['CLAIM_CREATED', 'Your claim was created.'],
      ['CLAIM_ALREADY_EXISTS', 'You already have a claim in this campaign.'],
    ].map(([messageKey, content]) => ({
      campaignId: campaign.id, messageKey: messageKey!, messageType: 'TEXT', content: content!,
    }))).onConflictDoNothing();
  } finally {
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Seed failed'}\n`);
  process.exitCode = 1;
});
