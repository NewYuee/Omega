export const AVATAR_PRESETS = Object.freeze([
  {value:'preset:developer',label:'💻',name:'开发'},
  {value:'preset:designer',label:'🎨',name:'设计'},
  {value:'preset:tester',label:'🧪',name:'测试'},
  {value:'preset:analyst',label:'📊',name:'分析'},
  {value:'preset:operator',label:'🛠',name:'运维'},
  {value:'preset:coordinator',label:'🧭',name:'协调'},
]);

const presetMap=new Map(AVATAR_PRESETS.map(item=>[item.value,item]));
export const validAvatar=value=>typeof value==='string'&&(value===''||presetMap.has(value)||(/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value)&&value.length<=100000));

export function avatarNode(value,name='',className='member-avatar'){
  const preset=presetMap.get(value),node=document.createElement(value?.startsWith('data:image/')&&validAvatar(value)?'img':'span');
  node.className=className;node.setAttribute('aria-hidden','true');
  if(node instanceof HTMLImageElement){node.src=value;node.alt='';}
  else{node.textContent=preset?.label||Array.from(name.trim())[0]?.toUpperCase()||'Ω';if(preset)node.dataset.preset=value.slice(7);}
  return node;
}

export async function avatarFromFile(file){
  if(!/^image\/(?:png|jpeg|webp)$/.test(file?.type||''))throw new Error('头像仅支持 PNG、JPEG 或 WebP');
  if(file.size>5*1024*1024)throw new Error('头像原图不能超过 5 MB');
  const url=URL.createObjectURL(file),image=new Image();
  try{
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('头像图片无法读取'));image.src=url;});
    const size=Math.min(image.naturalWidth,image.naturalHeight);if(!size)throw new Error('头像图片尺寸无效');
    const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
    const context=canvas.getContext('2d');if(!context)throw new Error('当前设备无法处理头像图片');
    context.drawImage(image,(image.naturalWidth-size)/2,(image.naturalHeight-size)/2,size,size,0,0,128,128);
    let result=canvas.toDataURL('image/webp',.78);if(!validAvatar(result))result=canvas.toDataURL('image/jpeg',.72);
    if(!validAvatar(result))throw new Error('压缩后的头像仍然过大，请选择更简单的图片');
    return result;
  }finally{URL.revokeObjectURL(url);}
}
