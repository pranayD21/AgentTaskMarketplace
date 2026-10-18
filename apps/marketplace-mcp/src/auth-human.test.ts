import { afterEach, expect, it, vi } from 'vitest';
import { memoryDb } from './memdb.js';
import { env } from './env.js';
import { hashApiKey, requireActor } from './auth.js';
vi.mock('./db.js',async importOriginal=>({...await importOriginal<typeof import('./db.js')>(),db:()=>memoryDb(),ensureSchema:async()=>{}}));
afterEach(()=>{env().DB_MODE='memory';});
it('rejects existing unlinked buyer/seller credentials in production and preserves Google-linked accounts and internal judges',async()=>{
 for(const [id,kind,owner] of [['legacy-b','buyer',null],['legacy-s','seller',null],['human','buyer','google-owner'],['internal','judge',null]] as const){
  await memoryDb().from('agents').insert({id,kind,display_name:id,api_key_hash:hashApiKey(id),owner_user_id:owner});
 }
 env().DB_MODE='insforge';
 for(const key of ['legacy-b','legacy-s']) await expect(requireActor({}, {api_key:key},['buyer','seller'])).rejects.toThrow('Google sign-in is required');
 expect((await requireActor({}, {api_key:'human'},['buyer'])).id).toBe('human');
 expect((await requireActor({}, {api_key:'internal'},['judge'])).id).toBe('internal');
});
