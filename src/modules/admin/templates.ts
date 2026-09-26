import { z } from 'zod';
import { imageHotspotMapsSchema, validateImageHotspotTargets } from '../campaigns/image-hotspots.js';

export const CAMPAIGN_MESSAGE_KEYS = ['WELCOME_MESSAGE','CLAIM_CREATED','CLAIM_ALREADY_EXISTS','CLAIM_STATUS_IN_PROGRESS','CLAIM_STATUS_UNDER_REVIEW',
  'CLAIM_STATUS_APPROVED','CLAIM_STATUS_REJECTED','EVIDENCE_SELECT_ACTIVITY','EVIDENCE_UPLOAD_PROMPT','EVIDENCE_RECEIVED','EVIDENCE_PENDING',
  'EVIDENCE_INVALID','EVIDENCE_APPROVED','EVIDENCE_REJECTED'] as const;

const draftShape = z.object({
  campaign: z.object({
    code: z.string().regex(/^[A-Za-z0-9_-]{2,100}$/), name: z.string().min(1).max(200), templateType: z.string().min(1).max(64),
    claimPolicy: z.literal('SINGLE_CLAIM').default('SINGLE_CLAIM'), title: z.string().max(5000).nullable(), subtitle: z.string().max(5000).nullable(),
    rewardType: z.string().max(100).nullable(), rewardValue: z.string().max(5000).nullable(), heroImage: z.string().max(2000).nullable(),
    startAt: z.string().datetime({offset:true}).nullable(), endAt: z.string().datetime({offset:true}).nullable(), maxClaims: z.number().int().positive().nullable(),
    settings: z.record(z.string(), z.unknown()).default({}),
  }).strict(),
  buttons: z.array(z.object({ buttonKey:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),label:z.string().max(200),actionType:z.enum(['URI','POSTBACK']),
    actionValue:z.string().nullable(),displayOrder:z.number().int().nonnegative(),enabled:z.boolean(),metadata:z.record(z.string(),z.unknown()).default({}) }).strict()).max(100),
  activities: z.array(z.object({ activityKey:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),title:z.string().max(5000),description:z.string().max(5000).nullable(),
    actionType:z.enum(['URI','POSTBACK']),actionValue:z.string().nullable(),displayOrder:z.number().int().nonnegative(),required:z.boolean(),enabled:z.boolean(),
    metadata:z.record(z.string(),z.unknown()).default({}) }).strict()).max(200),
  messages: z.array(z.object({messageKey:z.enum(CAMPAIGN_MESSAGE_KEYS),messageType:z.literal('TEXT'),content:z.string().max(5000),metadata:z.record(z.string(),z.unknown()).default({})}).strict()).max(CAMPAIGN_MESSAGE_KEYS.length),
}).strict();
function safeHttps(value:string|null|undefined) {
  if(!value)return true;
  try { const url=new URL(value);const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
    return url.protocol==='https:'&&!url.username&&!url.password&&value.length<=2000&&host!=='localhost'&&!host.endsWith('.localhost')
      &&!/^127\./.test(host)&&host!=='::'&&host!=='::1'&&!/^::ffff:/i.test(host)&&!/^f[cd]/i.test(host)&&!/^fe[89ab]/i.test(host)
      &&!/^10\./.test(host)&&!/^192\.168\./.test(host)&&!/^169\.254\./.test(host)&&!/^172\.(1[6-9]|2\d|3[01])\./.test(host);
  }catch{return false;}
}
export const templateDraftSchema = draftShape.superRefine((draft,ctx)=>{
  if(!safeHttps(draft.campaign.heroImage))ctx.addIssue({code:'custom',path:['campaign','heroImage'],message:'Use an HTTPS URL without credentials or private/local host.'});
  const secondaryImage=draft.campaign.settings.secondaryImage;
  if(typeof secondaryImage==='string'&&secondaryImage&&!safeHttps(secondaryImage))ctx.addIssue({code:'custom',path:['campaign','settings','secondaryImage'],message:'Use an HTTPS URL without credentials or private/local host.'});
  if(draft.campaign.settings.imageHotspots!==undefined){
    const parsedMaps=imageHotspotMapsSchema.safeParse(draft.campaign.settings.imageHotspots);
    if(!parsedMaps.success)ctx.addIssue({code:'custom',path:['campaign','settings','imageHotspots'],message:'Image hotspot configuration is invalid.'});
    else{
      parsedMaps.data.forEach((map,index)=>{
        if(!safeHttps(map.imageUrl))ctx.addIssue({code:'custom',path:['campaign','settings','imageHotspots',index,'imageUrl'],message:'Use an HTTPS image URL without credentials or private/local host.'});
      });
      for(const issue of validateImageHotspotTargets(parsedMaps.data,
        draft.buttons.map((item)=>({key:item.buttonKey,label:item.label,actionType:item.actionType,actionValue:item.actionValue,enabled:item.enabled})),
        draft.activities.map((item)=>({key:item.activityKey,label:item.title,actionType:item.actionType,actionValue:item.actionValue,enabled:item.enabled})))) {
        ctx.addIssue({code:'custom',path:issue.path,message:issue.message});
      }
    }
  }
  for(const [group,items] of [['buttons',draft.buttons],['activities',draft.activities]] as const){
    items.forEach((item,index)=>{if(item.actionType==='URI'&&item.actionValue&&!safeHttps(item.actionValue))ctx.addIssue({code:'custom',path:[group,index,'actionValue'],message:'Use an HTTPS URL without credentials or private/local host.'})});
    const keys=items.map((item)=>group==='buttons'?(item as typeof draft.buttons[number]).buttonKey:(item as typeof draft.activities[number]).activityKey);
    keys.forEach((key,index)=>{if(keys.indexOf(key)!==index)ctx.addIssue({code:'custom',path:[group,index],message:`Duplicate ${group==='buttons'?'button':'activity'} ID.`})});
  }
  const messageKeys=draft.messages.map((message)=>message.messageKey);
  messageKeys.forEach((key,index)=>{if(messageKeys.indexOf(key)!==index)ctx.addIssue({code:'custom',path:['messages',index,'messageKey'],message:'Duplicate message key.'})});
});
export type CampaignDraft = z.infer<typeof templateDraftSchema>;

export const TEMPLATES: Array<{id:string;name:string;description:string;draft:CampaignDraft}> = [
  { id:'welcome-claim',name:'Welcome + Claim',description:'LINE welcome card with a claim postback and an activity list.',draft:{
    campaign:{code:'NEW_CAMPAIGN',name:'New campaign',templateType:'WELCOME_CLAIM',claimPolicy:'SINGLE_CLAIM',title:'Campaign title',subtitle:'Short campaign description',rewardType:'',rewardValue:'',heroImage:'',startAt:null,endAt:null,maxClaims:null,settings:{}},
    buttons:[{buttonKey:'BTN_CLAIM',label:'Claim reward',actionType:'POSTBACK',actionValue:'',displayOrder:0,enabled:true,metadata:{}}],
    activities:[{activityKey:'ACTIVITY_1',title:'First activity',description:'Explain what participants do.',actionType:'URI',actionValue:null,displayOrder:0,required:false,enabled:true,metadata:{}}],
    messages:defaultMessages('Welcome! Choose a campaign below.'),
  }},
  { id:'activity-challenge',name:'Activity challenge',description:'A reusable claim campaign with several activities.',draft:{
    campaign:{code:'NEW_CHALLENGE',name:'New activity challenge',templateType:'ACTIVITY_CHALLENGE',claimPolicy:'SINGLE_CLAIM',title:'Challenge',subtitle:'Complete the activities',rewardType:'',rewardValue:'',heroImage:'',startAt:null,endAt:null,maxClaims:null,settings:{}},
    buttons:[{buttonKey:'BTN_CLAIM',label:'Start challenge',actionType:'POSTBACK',actionValue:'',displayOrder:0,enabled:true,metadata:{}}],
    activities:[{activityKey:'FOLLOW_CHANNEL',title:'Open activity',description:'',actionType:'URI',actionValue:null,displayOrder:0,required:true,enabled:true,metadata:{}}],
    messages:defaultMessages('Welcome! Start your challenge.'),
  }},
];

function defaultMessages(welcome:string) {
  const text:Record<typeof CAMPAIGN_MESSAGE_KEYS[number],string>={
    WELCOME_MESSAGE:welcome,CLAIM_CREATED:'Your claim was created.',CLAIM_ALREADY_EXISTS:'You already have a claim in this campaign.',
    CLAIM_STATUS_IN_PROGRESS:'Your campaign activities are in progress.',CLAIM_STATUS_UNDER_REVIEW:'Your evidence is waiting for review.',
    CLAIM_STATUS_APPROVED:'Your required activities were approved. Reward delivery is handled separately.',CLAIM_STATUS_REJECTED:'Evidence was rejected. Please review the note and submit it again.',
    EVIDENCE_SELECT_ACTIVITY:'Choose the activity you are submitting proof for.',EVIDENCE_UPLOAD_PROMPT:'Send one JPEG or PNG image, up to 10 MB, for this activity.',
    EVIDENCE_RECEIVED:'We received your evidence.',EVIDENCE_PENDING:'It is waiting for Admin review.',EVIDENCE_INVALID:'That image could not be accepted. Send a JPEG or PNG image under 10 MB.',
    EVIDENCE_APPROVED:'Your activity evidence was approved.',EVIDENCE_REJECTED:'Your activity evidence was rejected: {{reason}}',
  };
  return CAMPAIGN_MESSAGE_KEYS.map((messageKey)=>({messageKey,messageType:'TEXT' as const,content:text[messageKey],metadata:{}}));
}
