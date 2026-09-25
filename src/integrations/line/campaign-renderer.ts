import { DomainError } from '../../domain/errors.js';
import { evidenceRequestPostback } from '../../modules/evidence/postback.js';
import type { LineMessageObject } from './message-client.js';

type CampaignContent={title:string|null;subtitle:string|null;heroImage:string|null};
type ButtonContent={buttonKey:string;label:string;actionType:string;actionValue:string|null;enabled:boolean};
type ActivityContent={activityKey:string;title:string;description?:string|null;actionType:string;actionValue:string|null};

export function buildCampaignCard(campaign:CampaignContent,buttons:ButtonContent[]):LineMessageObject{
  const actions=buttons.filter((button)=>button.enabled).map((button)=>({type:'button',style:'primary',action:button.actionType==='URI'
    ?{type:'uri',label:slice(button.label,40),uri:button.actionValue}:{type:'postback',label:slice(button.label,40),data:button.actionValue}}));
  const contents:Record<string,unknown>[]=[{type:'text',text:campaign.title||'Campaign',weight:'bold',size:'xl',wrap:true},
    ...(campaign.subtitle?[{type:'text',text:campaign.subtitle,wrap:true}]:[]),...actions];
  const bubble:Record<string,unknown>={type:'bubble',body:{type:'box',layout:'vertical',spacing:'md',contents}};
  if(campaign.heroImage)bubble.hero={type:'image',url:campaign.heroImage,size:'full',aspectRatio:'20:13',aspectMode:'cover'};
  assertBubbleSize(bubble);
  return{type:'flex',altText:slice(campaign.title||'Campaign',1500),contents:bubble};
}

export function buildActivityCard(campaign:{title:string|null;subtitle:string|null;code?:string},activities:ActivityContent[],claimCode?:string):LineMessageObject{
  const content:Record<string,unknown>[]=[{type:'text',text:campaign.title||'Campaign activities',weight:'bold',size:'xl',wrap:true},
    ...(campaign.subtitle?[{type:'text',text:campaign.subtitle,wrap:true}]:[])];
  for(const activity of activities){
    content.push({type:'text',text:activity.title,weight:'bold',wrap:true});
    if(activity.description)content.push({type:'text',text:activity.description,wrap:true});
    content.push({type:'button',style:'secondary',action:activity.actionType==='URI'
      ?{type:'uri',label:slice(activity.title,40),uri:activity.actionValue}:{type:'postback',label:slice(activity.title,40),data:activity.actionValue}});
    if (claimCode && campaign.code) content.push({type:'button',style:'primary',action:{type:'postback',
      label:slice(`Submit proof: ${activity.title}`,40),data:evidenceRequestPostback(campaign.code,activity.activityKey)}});
  }
  const bubble:Record<string,unknown>={type:'bubble',body:{type:'box',layout:'vertical',spacing:'md',contents:content}};
  assertBubbleSize(bubble);
  return{type:'flex',altText:slice(campaign.title||'Campaign activities',1500),contents:bubble};
}

function assertBubbleSize(bubble:Record<string,unknown>){if(Buffer.byteLength(JSON.stringify(bubble),'utf8')>30*1024)throw new DomainError('Campaign Flex bubble exceeds LINE 30 KB JSON limit.','FLEX_BUBBLE_TOO_LARGE')}
function slice(value:string,length:number){return Array.from(value).slice(0,length).join('')}
