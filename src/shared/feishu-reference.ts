export const FEISHU_REFERENCE_START='[直接引用及上层引用的飞书消息 · 参考资料]';
export const FEISHU_REFERENCE_END='[引用结束]';

export function feishuReferenceContext(content:string){
  const start=content.indexOf(FEISHU_REFERENCE_START),end=content.lastIndexOf(FEISHU_REFERENCE_END);
  return start>=0&&end>start?content.slice(start,end+FEISHU_REFERENCE_END.length):'';
}
