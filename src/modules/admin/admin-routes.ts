import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema.js';
import { AdminAuthService } from './admin-auth-service.js';
import { CampaignAdminService } from './campaign-admin-service.js';
import { templateDraftSchema } from './templates.js';
import { EvidenceService } from '../evidence/evidence-service.js';
import type { EvidenceStorage } from '../evidence/storage.js';
import { AnalyticsService, InvalidAnalyticsRangeError } from './analytics-service.js';

type Db = NodePgDatabase<typeof schema>;
const COOKIE = 'ole88_admin_session';
function cookie(request:FastifyRequest) {
  const header = request.headers.cookie ?? '';
  const found = header.split(';').map((part)=>part.trim()).find((part)=>part.startsWith(`${COOKIE}=`));
  return found ? decodeURIComponent(found.slice(COOKIE.length+1)) : undefined;
}
function body(request:FastifyRequest):unknown {
  const raw=request.body;
  if (!Buffer.isBuffer(raw)) return raw;
  try { return JSON.parse(raw.toString('utf8')) as unknown; } catch { return null; }
}
function safeEqual(a:string,b:string) { const x=Buffer.from(a);const y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y); }
function setCookie(reply:FastifyReply, value:string, maxAge:number, secure:boolean) {
  reply.header('set-cookie',`${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`);
}
const publicRoot=resolve(process.cwd(),'public');
const usernameSchema=z.string().trim().min(3).max(120).regex(/^[A-Za-z0-9_.@-]+$/);
const codeSchema=z.string().regex(/^[A-Za-z0-9_-]{2,100}$/);

export function registerAdminRoutes(app:FastifyInstance, db:Db, isProduction:boolean, evidenceStorage:EvidenceStorage, publicBaseUrl?:string) {
  app.addHook('onSend',async(request,reply,payload)=>{
    if(request.url.startsWith('/admin')||request.url.startsWith('/api/admin/')){
      reply.header('cache-control','no-store');reply.header('referrer-policy','no-referrer');reply.header('x-content-type-options','nosniff');
    }
    return payload;
  });
  const auth=new AdminAuthService(db);
  const campaigns=new CampaignAdminService(db);
  const evidence=new EvidenceService(db,{getMessageContent:async()=>{throw new Error('Evidence media retrieval is worker-only.')}},evidenceStorage);
  const analytics=new AnalyticsService(db);
  app.get('/admin',async(_request,reply)=>reply.header('content-type','text/html; charset=utf-8').header('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'").send(await readFile(resolve(publicRoot,'admin.html'))));
  app.get('/admin.js',async(_request,reply)=>reply.header('content-type','text/javascript; charset=utf-8').header('x-content-type-options','nosniff').send(await readFile(resolve(publicRoot,'admin.js'))));
  app.get('/admin.css',async(_request,reply)=>reply.header('content-type','text/css; charset=utf-8').send(await readFile(resolve(publicRoot,'admin.css'))));
  app.post('/api/admin/login',async(request,reply)=>{
    if(!isSameOrigin(request,publicBaseUrl))return reply.code(403).send({error:'Cross-origin login rejected.'});
    const parsed=z.object({username:usernameSchema,password:z.string().min(1).max(128)}).safeParse(body(request));
    if(!parsed.success)return reply.code(400).send({error:'Invalid login input.'});
    const session=await auth.login(parsed.data.username,parsed.data.password,request.ip);
    if(!session)return reply.code(401).send({error:'Login failed. Check credentials or wait before trying again.'});
    setCookie(reply,session.token,Math.floor((session.expiresAt.getTime()-Date.now())/1000),isProduction);
    return {user:session.user,csrfToken:session.csrfToken};
  });
  app.get('/api/admin/session',async(request,reply)=>{
    const session=await auth.getSession(cookie(request));
    if(!session)return reply.code(401).send({error:'Authentication required.'});
    return {user:session.user,csrfToken:session.session.csrfToken};
  });
  app.post('/api/admin/logout',async(request,reply)=>{
    const session=await requireAdmin(request,reply,auth,true);
    if(!session)return;
    await auth.logout(cookie(request));setCookie(reply,'',0,isProduction);return {ok:true};
  });
  const route=async(request:FastifyRequest,reply:FastifyReply,action:(session:NonNullable<Awaited<ReturnType<typeof auth.getSession>>>)=>Promise<unknown>)=>{
    const session=await requireAdmin(request,reply,auth,request.method!=='GET',publicBaseUrl);if(!session)return;
    try{return await action(session);}catch(error){return sendError(reply,error);}
  };
  app.get('/api/admin/templates',(req,rep)=>route(req,rep,async()=>({templates:campaigns.templates()})));
  app.get('/api/admin/campaigns',(req,rep)=>route(req,rep,async()=>({campaigns:await campaigns.list()})));
  app.post('/api/admin/campaigns',(req,rep)=>route(req,rep,async(session)=>{
    const data=z.object({templateId:z.string().min(1),code:codeSchema}).safeParse(body(req));if(!data.success)return rep.code(400).send({error:'Invalid input.',details:data.error.issues});
    return campaigns.create(session.user.id,data.data.templateId,data.data.code);
  }));
  app.get('/api/admin/campaigns/:id',(req,rep)=>route(req,rep,async()=>campaigns.detail((req.params as {id:string}).id)));
  app.post('/api/admin/campaigns/:id/duplicate',(req,rep)=>route(req,rep,async(session)=>{
    const data=z.object({code:codeSchema}).safeParse(body(req));if(!data.success)return rep.code(400).send({error:'Invalid input.'});
    return campaigns.duplicate(session.user.id,(req.params as {id:string}).id,data.data.code);
  }));
  app.put('/api/admin/campaigns/:id',(req,rep)=>route(req,rep,async(session)=>{
    const data=z.object({expectedVersion:z.number().int().positive(),draft:templateDraftSchema}).safeParse(body(req));
    if(!data.success)return rep.code(400).send({error:'Invalid input.',details:data.error.issues});
    const draft=normalizeDraft(data.data.draft);
    return campaigns.save((req.params as {id:string}).id,draft,data.data.expectedVersion,session.user.id);
  }));
  app.post('/api/admin/campaigns/preview',(req,rep)=>route(req,rep,async()=>{
    const data=templateDraftSchema.safeParse(body(req));if(!data.success)return rep.code(400).send({error:'Invalid input.',details:data.error.issues});
    return campaigns.preview(normalizeDraft(data.data));
  }));
  app.post('/api/admin/campaigns/:id/publish',(req,rep)=>route(req,rep,async(session)=>{
    const data=z.object({expectedVersion:z.number().int().positive(),draft:templateDraftSchema.optional()}).safeParse(body(req));if(!data.success)return rep.code(400).send({error:'Invalid input.',details:data.error.issues});
    const id=(req.params as {id:string}).id;
    return data.data.draft
      ? campaigns.saveAndPublish(id,normalizeDraft(data.data.draft),data.data.expectedVersion,session.user.id)
      : campaigns.publish(id,session.user.id,data.data.expectedVersion);
  }));
  app.post('/api/admin/campaigns/:id/pause',(req,rep)=>route(req,rep,async(session)=>{
    const data=z.object({expectedVersion:z.number().int().positive()}).safeParse(body(req));if(!data.success)return rep.code(400).send({error:'Invalid input.'});
    return campaigns.pause((req.params as {id:string}).id,session.user.id,data.data.expectedVersion);
  }));
  app.get('/api/admin/reviews',(req,rep)=>route(req,rep,async()=>{
    const query=z.object({campaignId:z.string().uuid().optional(),status:z.enum(['SUBMITTED','APPROVED','REJECTED']).optional(),from:z.string().datetime({offset:true}).optional(),to:z.string().datetime({offset:true}).optional()}).safeParse(req.query);
    if(!query.success)return rep.code(400).send({error:'Invalid review filters.'});
    return {items:await evidence.listQueue({...(query.data.campaignId?{campaignId:query.data.campaignId}:{}),...(query.data.status?{status:query.data.status}:{}),
      ...(query.data.from?{from:new Date(query.data.from)}:{}),...(query.data.to?{to:new Date(query.data.to)}:{})})};
  }));
  app.get('/api/admin/review-campaigns',(req,rep)=>route(req,rep,async()=>({campaigns:await campaigns.list()})));
  app.get('/api/admin/analytics',(req,rep)=>route(req,rep,async()=>{
    const query=z.object({from:z.string().datetime({offset:true}),to:z.string().datetime({offset:true}),campaignId:z.string().uuid().optional()}).safeParse(req.query);
    if(!query.success)return rep.code(400).send({error:'Provide valid from/to timestamps and optional campaignId.'});
    try{return await analytics.overview({from:new Date(query.data.from),to:new Date(query.data.to),...(query.data.campaignId?{campaignId:query.data.campaignId}:{})});}
    catch(error){if(error instanceof InvalidAnalyticsRangeError)return rep.code(400).send({error:error.message});throw error;}
  }));
  app.get('/api/admin/analytics/issues',(req,rep)=>route(req,rep,async()=>{
    const query=z.object({kind:z.enum(['webhook','outbound','review']),campaignId:z.string().uuid().optional(),status:z.enum(['FAILED','PROCESSING','UNCERTAIN','SENDING','SUBMITTED']).optional(),limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).max(100000).default(0)}).safeParse(req.query);
    if(!query.success)return rep.code(400).send({error:'Invalid issue filters.'});
    const statuses={webhook:['FAILED','PROCESSING'],outbound:['FAILED','UNCERTAIN','SENDING'],review:['SUBMITTED']} as const;
    if(query.data.status&&!statuses[query.data.kind].includes(query.data.status as never))return rep.code(400).send({error:'Status does not apply to this issue queue.'});
    const globalQueue=query.data.kind==='webhook';
    return {campaignScope:globalQueue?'ALL_CAMPAIGNS':query.data.campaignId?'SELECTED_CAMPAIGN':'ALL_CAMPAIGNS',
      items:await analytics.issues(query.data.kind,{...(!globalQueue&&query.data.campaignId?{campaignId:query.data.campaignId}:{}),...(query.data.status?{status:query.data.status}:{}),limit:query.data.limit,offset:query.data.offset})};
  }));
  app.get('/api/admin/reviews/:id',(req,rep)=>route(req,rep,async()=>evidence.reviewDetail((req.params as {id:string}).id)));
  app.get('/api/admin/evidence/:id/content',(req,rep)=>route(req,rep,async()=>{
    const id=(req.params as {id:string}).id;
    const key=await evidence.assertMediaReadable(id);
    const data=await evidenceStorage.read(key);
    const contentType=key.endsWith('.png')?'image/png':'image/jpeg';
    return rep.header('content-type',contentType).header('cache-control','private, no-store').header('x-content-type-options','nosniff')
      .header('content-disposition','inline; filename="evidence"').send(data);
  }));
  app.post('/api/admin/reviews/:id/approve',(req,rep)=>route(req,rep,async(session)=>{
    const input=z.object({expectedVersion:z.number().int().positive()}).safeParse(body(req));if(!input.success)return rep.code(400).send({error:'Invalid input.'});
    return evidence.decide((req.params as {id:string}).id,session.user.id,'APPROVED',input.data.expectedVersion);
  }));
  app.post('/api/admin/reviews/:id/reject',(req,rep)=>route(req,rep,async(session)=>{
    const input=z.object({expectedVersion:z.number().int().positive(),reason:z.string().trim().min(1).max(1000)}).safeParse(body(req));if(!input.success)return rep.code(400).send({error:'A rejection reason is required.',details:input.error.issues});
    return evidence.decide((req.params as {id:string}).id,session.user.id,'REJECTED',input.data.expectedVersion,input.data.reason);
  }));
}

async function requireAdmin(request:FastifyRequest,reply:FastifyReply,auth:AdminAuthService,mutating:boolean,publicBaseUrl?:string) {
  const session=await auth.getSession(cookie(request));if(!session){reply.code(401).send({error:'Authentication required.'});return null;}
  if(mutating){
    if(!isSameOrigin(request,publicBaseUrl)){reply.code(403).send({error:'Cross-origin request rejected.'});return null;}
    const supplied=request.headers['x-csrf-token'];
    if(typeof supplied!=='string'||!safeEqual(supplied,session.session.csrfToken)){reply.code(403).send({error:'CSRF token required.'});return null;}
  }
  return session;
}
function isSameOrigin(request:FastifyRequest, publicBaseUrl?:string) {
  const origin=request.headers.origin;
  if(!origin)return true;
  const expected=publicBaseUrl?new URL(publicBaseUrl).origin:`${request.protocol}://${request.headers.host}`;
  return origin===expected;
}
function normalizeDraft<T extends {campaign:{heroImage:string|null;rewardType:string|null;rewardValue:string|null}}>(draft:T):T {
  const c=draft.campaign;
  return {...draft,campaign:{...c,heroImage:c.heroImage?.trim()||null,rewardType:c.rewardType?.trim()||null,rewardValue:c.rewardValue?.trim()||null}};
}
function sendError(reply:FastifyReply,error:unknown) {
  const e=error as {code?:string;message?:string;constraint?:string};
  if(e.code==='CAMPAIGN_NOT_PUBLISHABLE')return reply.code(422).send({error:e.message,issues:(error as {details?:unknown}).details??[]});
  const known=new Map([['CAMPAIGN_NOT_FOUND',404],['CLAIM_NOT_FOUND',404],['CLAIM_ACTIVITY_NOT_FOUND',404],['EVIDENCE_NOT_FOUND',404],['TEMPLATE_NOT_FOUND',404],['ACTIVE_CAMPAIGN_IMMUTABLE',409],['CAMPAIGN_ALREADY_ACTIVE',409],['CAMPAIGN_VERSION_CONFLICT',409],['CAMPAIGN_PUBLISH_CONFLICT',409],['CAMPAIGN_NOT_ACTIVE',409],['ACTIVITY_IN_USE',409],['ANOTHER_CAMPAIGN_ACTIVE',409],['CAMPAIGN_NOT_PUBLISHABLE',422],['EVIDENCE_VERSION_CONFLICT',409],['EVIDENCE_OWNER_MISMATCH',409],['EVIDENCE_SOURCE_CONFLICT',409],['CLAIM_NOT_ACCEPTING_EVIDENCE',409],['CLAIM_ACTIVITY_ALREADY_APPROVED',409],['CLAIM_ACTIVITY_EVIDENCE_PENDING',409],['EVIDENCE_LEGACY_UNLINKED',409],['EVIDENCE_CONTEXT_STALE',409],['EVIDENCE_RELATIONSHIP_INVALID',409],['INVALID_CLAIM_TRANSITION',409],['EVIDENCE_REJECTION_REASON_REQUIRED',400]]);
  const status=e.code?known.get(e.code):undefined;
  if(status)return reply.code(status).send({error:e.message,code:e.code});
  if(e.code==='23505')return reply.code(409).send({error:'A campaign with this code already exists.'});
  if(e.code==='ANOTHER_CAMPAIGN_ACTIVE'||e.constraint==='campaigns_single_active_idx')return reply.code(409).send({error:e.message||'Pause the active campaign before publishing another.',code:'ANOTHER_CAMPAIGN_ACTIVE'});
  requestErrorLog(reply,error);
  return reply.code(500).send({error:'Admin operation failed.'});
}
function requestErrorLog(_reply:FastifyReply,_error:unknown) { /* Avoid logging request bodies or credentials. */ }
