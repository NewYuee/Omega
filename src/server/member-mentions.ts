type Member={id:string;name:string;role?:string};
export type MemberMention={id:string;name:string;role?:string;start:number;end:number};
export function validateMentions(value:unknown,content:string,members:Member[]):MemberMention[]{
  if(value==null)return[];
  if(!Array.isArray(value)||value.length>50)throw Error('成员标签格式错误或数量过多');
  let end=0;
  return [...value].sort((a,b)=>(a?.start??0)-(b?.start??0)).map(item=>{
    if(!item||typeof item.id!=='string'||typeof item.name!=='string'||!item.name||item.name.length>100||!Number.isInteger(item.start)||!Number.isInteger(item.end)||item.start<end||item.end>content.length||item.end!==item.start+item.name.length+1||content.slice(item.start,item.end)!=='@'+item.name)throw Error('成员标签与消息内容不匹配，请重新选择成员');
    const member=members.find(member=>member.id===item.id);if(!member)throw Error('指定成员已被移除，请重新选择成员');
    end=item.end;return{id:member.id,name:item.name,role:member.role,start:item.start,end:item.end};
  });
}
