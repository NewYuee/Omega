export const imageMarker=(id:string)=>`[OmegaImage:${id}]`;
export function imageSafeSlice(text:string,start:number,size:number){let from=start,to=start+size;for(const match of text.matchAll(/\[OmegaImage:[a-zA-Z0-9-]+\]/g)){const end=match.index!+match[0].length;if(match.index!<from&&end>from)from=match.index!;if(match.index!<to&&end>to)to=end;}return text.slice(from,to);}
export function splitImageText(text:string,ids:readonly string[]){
  const allowed=new Set(ids),parts:Array<{type:'text';text:string}|{type:'image';id:string}>=[];
  const pattern=/\[OmegaImage:([a-zA-Z0-9-]+)\]/g;let from=0;
  for(const match of text.matchAll(pattern)){if(!allowed.has(match[1]))continue;if(match.index!>from)parts.push({type:'text',text:text.slice(from,match.index)});parts.push({type:'image',id:match[1]});from=match.index!+match[0].length;}
  if(from<text.length)parts.push({type:'text',text:text.slice(from)});return parts;
}
export function inlineImageContent(content:Array<{type?:string;text?:string}>,ids:readonly string[]){let index=0;return content.map(part=>['image','localImage'].includes(part.type||'')&&ids[index]?{type:'text',text:imageMarker(ids[index++])}:part);}
