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
      ['CLAIM_STATUS_IN_PROGRESS','Your campaign activities are in progress.'],
      ['CLAIM_STATUS_UNDER_REVIEW','Your evidence is waiting for review.'],
      ['CLAIM_STATUS_APPROVED','Your required activities were approved. Reward delivery is handled separately.'],
      ['CLAIM_STATUS_REJECTED','Evidence was rejected. Please review the note and submit it again.'],
      ['EVIDENCE_SELECT_ACTIVITY','Choose the activity you are submitting proof for.'],
      ['EVIDENCE_UPLOAD_PROMPT','Send one JPEG or PNG image, up to 10 MB, for this activity.'],
      ['EVIDENCE_RECEIVED','We received your evidence.'],['EVIDENCE_PENDING','It is waiting for Admin review.'],
      ['EVIDENCE_INVALID','That image could not be accepted. Send a JPEG or PNG image under 10 MB.'],
      ['EVIDENCE_APPROVED','Your activity evidence was approved.'],['EVIDENCE_REJECTED','Your activity evidence was rejected: {{reason}}'],
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
