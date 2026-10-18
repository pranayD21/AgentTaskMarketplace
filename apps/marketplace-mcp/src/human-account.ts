import { createHmac } from 'node:crypto';
import { generateKeypair, keyIdFor, toB64 } from '@atm/crypto';
import { z } from 'zod';
import type { MCPServer } from 'mcp-use';
import { bodyLimit } from 'hono/body-limit';
import { db, ensureSchema, one, unwrap, type AgentRow } from './db.js';
import { env } from './env.js';
import { hashApiKey } from './auth.js';
import { kekSeal } from './kek.js';
import { linkSellerIdentity, verifyGoogleUser, type HumanOwner } from './seller-identity.js';
import { buyerPaymentInfo, payments, PAYOUT_ACCOUNT_RETRY_POLICY } from './payments.js';

export async function linkHumanBuyer(owner: HumanOwner) {
  await ensureSchema();
  const api_key = 'atm_sk_' + createHmac('sha256', Buffer.from(env().SERVER_KEK_B64, 'base64')).update('atm-human-buyer-v1:'+owner.id).digest('base64url');
  const hash = hashApiKey(api_key);
  let agent = await one<AgentRow>(await db().from('agents').select('*').eq('owner_user_id',owner.id).eq('kind','buyer').limit(1));
  if (agent && agent.api_key_hash !== hash) throw Error('ACCOUNT_RECONCILIATION_REQUIRED');
  if (!agent) {
    const kp = generateKeypair();
    const row = {id:'buyer_'+hash.slice(0,32),kind:'buyer',display_name:owner.name.slice(0,80),api_key_hash:hash,
      owner_user_id:owner.id,owner_email:owner.email,buyer_pubkey_b64:toB64(kp.publicKey),buyer_key_id:'buyer-'+keyIdFor(kp.publicKey),
      buyer_secret_enc:kekSeal(toB64(kp.secretKey)),spend_cap_cents:env().DEFAULT_SPEND_CAP_CENTS,reserved_cents:0,spent_cents:0};
    const inserted=await db().from('agents').insert(row).select();
    agent=inserted.error ? await one<AgentRow>(await db().from('agents').select('*').eq('id',row.id).limit(1)) : (unwrap(inserted) as AgentRow[])[0]!;
  }
  if (!agent || agent.owner_user_id!==owner.id || agent.kind!=='buyer' || agent.api_key_hash!==hash) throw Error('ACCOUNT_LINK_FAILED');
  return {agent_id:agent.id,api_key,display_name:agent.display_name,owner:{user_id:owner.id,email:owner.email,name:owner.name}};
}

export async function humanBuyerPayment(agent: AgentRow, includeSetup=false) {
  if (!agent.owner_user_id || agent.kind!=='buyer') throw Error('HUMAN_BUYER_REQUIRED');
  agent=(await one<AgentRow>(await db().from('agents').select('*').eq('id',agent.id).limit(1)))!;
  if (!agent.stripe_customer_id && payments().mode!=='mock') {
    if (!agent.stripe_onboarding_started_at) {
      unwrap(await db().from('agents').update({stripe_onboarding_started_at:new Date().toISOString()}).eq('id',agent.id).is('stripe_onboarding_started_at',null));
      agent=(await one<AgentRow>(await db().from('agents').select('*').eq('id',agent.id).limit(1)))!;
    }
    const attempts=agent.stripe_onboarding_attempts??0;
    if (Date.now()-Date.parse(agent.stripe_onboarding_started_at!)>PAYOUT_ACCOUNT_RETRY_POLICY.window_hours*3600000 || attempts>=PAYOUT_ACCOUNT_RETRY_POLICY.max_attempts) throw Error('STRIPE_SETUP_NEEDS_RECONCILIATION');
    if (!(Date.parse(agent.stripe_onboarding_retry_at??'')>Date.now())) {
      const won=unwrap(await db().from('agents').update({stripe_onboarding_attempts:attempts+1,stripe_onboarding_retry_at:new Date(Date.now()+5000).toISOString()}).eq('id',agent.id).eq('stripe_onboarding_attempts',attempts).select()) as AgentRow[];
      if (won.length) {
        const customer=await payments().onboardBuyer({id:agent.id,display_name:agent.display_name,email:agent.owner_email??undefined,human_onboarding:true});
        if(customer.stripe_customer_id) unwrap(await db().from('agents').update(customer).eq('id',agent.id).is('stripe_customer_id',null));
      }
    }
    agent=(await one<AgentRow>(await db().from('agents').select('*').eq('id',agent.id).limit(1)))!;
  }
  const result=await buyerPaymentInfo(agent,{includeSetup,humanLinked:true});
  if(result.confirmed_payment_method_id) unwrap(await db().from('agents').update({stripe_payment_method_id:result.confirmed_payment_method_id}).eq('id',agent.id).eq('stripe_customer_id',agent.stripe_customer_id));
  const {confirmed_payment_method_id,...publicStatus}=result;
  return publicStatus;
}

export function registerHumanAccountRoutes(server:MCPServer) {
  server.use('/api/account/identity',bodyLimit({maxSize:16384}));
  server.post('/api/account/identity',async c=>{
    c.header('Cache-Control','no-store');
    try {
      const token=/^Bearer (.+)$/i.exec(c.req.header('authorization')??'')?.[1]??'';
      const owner=await verifyGoogleUser(token);
      const input=z.object({agent_key:z.string().regex(/^atm_sk_[A-Za-z0-9_-]{43}$/),display_name:z.string().min(1).max(80)}).parse(await c.req.json());
      const seller=await linkSellerIdentity(owner,input.agent_key,input.display_name);
      const buyer=await linkHumanBuyer(owner);
      return c.json({owner:seller.owner,seller,buyer});
    }catch(error){const code=error instanceof Error?error.message:'';return c.json({error:code==='GOOGLE_SIGN_IN_REQUIRED'?code:'ACCOUNT_LINK_FAILED'},code==='GOOGLE_SIGN_IN_REQUIRED'?401:409);}
  });
  for(const state of ['return','refresh']) server.get('/buyer/setup-'+state,c=>{
    c.header('Cache-Control','no-store');c.header('Referrer-Policy','no-referrer');
    return c.html('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Payment setup</title><body style="font:18px system-ui;max-width:560px;margin:15vh auto;padding:24px"><h1>Return to your marketplace</h1><p>Your local dashboard will check your saved payment method. Payments remain in Stripe TEST MODE.</p><a href="http://127.0.0.1:43118/">Open your dashboard</a><p>If it asks you to reconnect, run <code>atm-seller dashboard</code>.</p></body></html>');
  });
}
