const ACTIVE=new Set(['queued','running']);
export const POLL_INTERVAL_MS=10_000;
export function isActiveRun(status?:string){return ACTIVE.has(String(status??'').toLowerCase());}
export function pollWhileActive(status?:string):number|false{return isActiveRun(status)?POLL_INTERVAL_MS:false;}
export function pollIfAnyActive(rows?:Array<{status?:string|number|null}>):number|false{return rows?.some((row)=>isActiveRun(String(row.status)))?POLL_INTERVAL_MS:false;}
export function parseJson<T>(value:unknown,fallback:T):T{if(value==null||value==='')return fallback;if(typeof value==='object')return value as T;try{return JSON.parse(String(value)) as T;}catch{return fallback;}}
