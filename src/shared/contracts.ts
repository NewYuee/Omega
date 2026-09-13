import {z} from 'zod';

export const connectionProfileSchema=z.object({serverUrl:z.string().url(),accessKey:z.string().min(8).max(256),allowHttp:z.boolean().default(false)}).superRefine((value,ctx)=>{const url=new URL(value.serverUrl);if(url.protocol==='http:'&&!value.allowHttp)ctx.addIssue({code:z.ZodIssueCode.custom,message:'HTTP 连接需要明确允许'});if(!['http:','https:'].includes(url.protocol)||url.username||url.password)ctx.addIssue({code:z.ZodIssueCode.custom,message:'服务器地址无效'});});
export type ConnectionProfile=z.infer<typeof connectionProfileSchema>;

export const taskStatusSchema=z.enum(['queued','running','reviewing','completed','failed','unknown','cancelled']);
export const requirementStatusSchema=z.enum(['plan_drafting','awaiting_confirmation','queued','running','finalizing','completed','accepted','paused','failed','unknown','cancelled']);
export type TaskStatus=z.infer<typeof taskStatusSchema>;
export type RequirementStatus=z.infer<typeof requirementStatusSchema>;

export interface OmegaThread {id:string;name?:string;preview?:string;cwd?:string}
export interface OmegaStatus {ready:boolean;workspace:string;active:Record<string,string>;approvals:unknown[];devices?:number}
export interface OmegaEvent<T=unknown> {method:string;params:T}
