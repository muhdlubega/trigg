import { describe, expect, it } from 'vitest';
import { evaluateCondition, executeWorkflow, interpolate, validateWorkflow } from '../src';
import type { WorkflowDefinition } from '@trigg/shared';

const workflow: WorkflowDefinition = {
  id:'test',name:'Test',description:'',enabled:true,version:1,
  nodes:[
    {id:'manual',type:'trigger.manual',name:'Manual',category:'trigger',position:{x:0,y:0},config:{}},
    {id:'check',type:'logic.condition',name:'Check',category:'logic',position:{x:1,y:0},config:{expression:'{{manual.score}} >= 70'}},
    {id:'save',type:'action.save',name:'Save',category:'action',position:{x:2,y:0},config:{value:'{{manual.message}}'}},
  ],
  edges:[{id:'a',source:'manual',target:'check'},{id:'b',source:'check',target:'save',sourceHandle:'true'}],
};

describe('workflow engine', () => {
  it('interpolates safe paths', () => expect(interpolate('Hi {{event.user}}', {event:{user:'Ada'}})).toBe('Hi Ada'));
  it('evaluates comparisons without eval', () => expect(evaluateCondition('{{review.risk}} > 70',{review:{risk:82}})).toBe(true));
  it('rejects cycles', () => expect(validateWorkflow({...workflow,edges:[...workflow.edges,{id:'c',source:'save',target:'manual'}]}).valid).toBe(false));
  it('branches and executes actions', async () => {
    const result = await executeWorkflow(workflow,{manual:{score:80,message:'ship'}},{'action.save':async (node)=>node.config.value});
    expect(result.status).toBe('success'); expect(result.outputs.save).toBe('ship');
  });
  it('records executor skip markers as skipped nodes', async () => {
    const result = await executeWorkflow({
      id:'skip',name:'Skip',description:'',enabled:true,version:1,
      nodes:[
        {id:'manual',type:'trigger.manual',name:'Manual',category:'trigger',position:{x:0,y:0},config:{}},
        {id:'comment',type:'action.githubComment',name:'Post',category:'action',position:{x:1,y:0},config:{repository:'owner/repo',issueNumber:1,body:''}},
      ],
      edges:[{id:'a',source:'manual',target:'comment'}],
    },{manual:{}},{'action.githubComment':async()=>({skipped:true,reason:'No material findings'})});
    expect(result.status).toBe('success');
    expect(result.nodes.find((node)=>node.nodeId==='comment')?.status).toBe('skipped');
  });
});
