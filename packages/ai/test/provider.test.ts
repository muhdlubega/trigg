import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FallbackAIProvider, type AIProvider, type AIRequest, type AIResponse } from '../src';

const response=(provider:string,text='ok'):AIResponse=>({text,provider,model:'model',inputTokens:1,outputTokens:1,durationMs:1});
describe('AI fallback',()=>{
  it('uses Gemini-compatible fallback when the primary fails',async()=>{
    const primary:AIProvider={generate:async()=>{throw new Error('down');},generateStructured:async()=>{throw new Error('down');}};
    const fallback:AIProvider={generate:async()=>response('gemini'),generateStructured:async<T>(request:AIRequest,schema:z.ZodType<T>)=>{void request;return {data:schema.parse({value:'real'}),usage:response('gemini','{"value":"real"}')};}};
    const provider=new FallbackAIProvider(primary,fallback);
    await expect(provider.generate({prompt:'review'})).resolves.toMatchObject({provider:'gemini'});
    await expect(provider.generateStructured({prompt:'review'},z.object({value:z.string()}))).resolves.toMatchObject({data:{value:'real'},usage:{provider:'gemini'}});
  });
});
