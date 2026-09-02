import { create } from 'zustand';
import type { WorkflowDefinition } from '@trigg/shared';
type State={draft:WorkflowDefinition|null;selectedNode:string|null;dirty:boolean;setDraft:(draft:WorkflowDefinition)=>void;select:(id:string|null)=>void;update:(recipe:(draft:WorkflowDefinition)=>WorkflowDefinition)=>void;markSaved:()=>void};
export const useWorkflowStore=create<State>((set)=>({draft:null,selectedNode:null,dirty:false,setDraft:(draft)=>set({draft,dirty:false}),select:(selectedNode)=>set({selectedNode}),update:(recipe)=>set((state)=>state.draft?{draft:recipe(state.draft),dirty:true}:state),markSaved:()=>set({dirty:false})}));
