import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BaseProvider, CodeReviewSchema, FallbackAIProvider, type AIProvider, type AIRequest, type AIResponse } from '../src';

const response=(provider:string,text='ok'):AIResponse=>({text,provider,model:'model',inputTokens:1,outputTokens:1,durationMs:1});
const failing=(name:string,error:string):AIProvider=>({name,generate:async()=>{throw new Error(error);},generateStructured:async()=>{throw new Error(error);}});
const validReview=JSON.stringify({summary:'ok',riskScore:10,severity:'low',findings:[],recommendation:'approve'});

class StubProvider extends BaseProvider {
  readonly name='Stub';
  readonly prompts:string[]=[];
  constructor(private readonly replies:string[]){super();}
  async generate(request:AIRequest):Promise<AIResponse>{this.prompts.push(request.prompt);return response('stub',this.replies.shift()??'');}
}

describe('AI fallback',()=>{
  it('uses Gemini-compatible fallback when the primary fails',async()=>{
    const primary=failing('Mistral','down');
    const fallback:AIProvider={generate:async()=>response('gemini'),generateStructured:async<T>(request:AIRequest,schema:z.ZodType<T>)=>{void request;return {data:schema.parse({value:'real'}),usage:response('gemini','{"value":"real"}')};}};
    const provider=new FallbackAIProvider(primary,fallback);
    await expect(provider.generate({prompt:'review'})).resolves.toMatchObject({provider:'gemini'});
    await expect(provider.generateStructured({prompt:'review'},z.object({value:z.string()}))).resolves.toMatchObject({data:{value:'real'},usage:{provider:'gemini'}});
  });
  it('reports both provider errors in a readable sentence',async()=>{
    const provider=new FallbackAIProvider(failing('Mistral','Mistral request failed (429): Rate limit exceeded'),failing('Gemini','Gemini returned invalid structured output'));
    await expect(provider.generate({prompt:'review'})).rejects.toThrow('Both AI providers failed. Mistral: Mistral request failed (429): Rate limit exceeded. Gemini: Gemini returned invalid structured output.');
  });
});

describe('structured output',()=>{
  it('tells the model the allowed enum values',async()=>{
    const provider=new StubProvider([validReview]);
    await provider.generateStructured({prompt:'review'},CodeReviewSchema);
    expect(provider.prompts[0]).toContain('request_changes');
    expect(provider.prompts[0]).toContain('critical');
  });
  it('retries with the validation failure as feedback',async()=>{
    const provider=new StubProvider(['Sure, here you go.','```json\n'+validReview+'\n```']);
    await expect(provider.generateStructured({prompt:'review'},CodeReviewSchema)).resolves.toMatchObject({data:{severity:'low'}});
    expect(provider.prompts[1]).toContain('previous reply was rejected');
  });
  it('reports unusable output in a readable sentence',async()=>{
    const provider=new StubProvider(['{"summary":"ok"}','{"summary":"ok"}','{"summary":"ok"}']);
    await expect(provider.generateStructured({prompt:'review'},CodeReviewSchema)).rejects.toThrow(/^Stub returned invalid structured output: riskScore: /);
  });
});

describe('CodeReviewSchema normalization',()=>{
  it('accepts common wording variants for enums and numbers',()=>{
    const review=CodeReviewSchema.parse({summary:'Looks risky',riskScore:'82.4',severity:'Major',recommendation:'Changes Requested',
      findings:[{title:'SQL injection',description:'Concatenated query',file:'db.ts',line:'42',severity:'BLOCKER'}]});
    expect(review).toMatchObject({riskScore:82,severity:'high',recommendation:'request_changes'});
    expect(review.findings[0]).toMatchObject({line:42,severity:'critical'});
  });
  it('clamps out-of-range scores and drops unusable line numbers',()=>{
    const review=CodeReviewSchema.parse({summary:'ok',riskScore:250,severity:'none',recommendation:'lgtm',
      findings:[{title:'Nit',description:'Naming',line:0,severity:'info'}]});
    expect(review).toMatchObject({riskScore:100,severity:'low',recommendation:'approve'});
    expect(review.findings[0]?.line).toBeUndefined();
  });
});
