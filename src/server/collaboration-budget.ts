export interface CollaborationBudget {maxMinutes:number;maxTokens:number}
export function validateBudget(value:Record<string,unknown>={}):CollaborationBudget {
  const maxMinutes=value.maxMinutes??0,maxTokens=value.maxTokens??0;
  if(!Number.isInteger(maxMinutes)||Number(maxMinutes)<0||Number(maxMinutes)>10080)throw new Error('协作时间预算需为 0–10080 分钟，0 表示不限制');
  if(!Number.isInteger(maxTokens)||Number(maxTokens)<0||Number(maxTokens)>100000000)throw new Error('Token 预算需为 0–100000000，0 表示不限制');
  return{maxMinutes:Number(maxMinutes),maxTokens:Number(maxTokens)};
}
