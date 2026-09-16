const presets:Record<string,string>={developer:'💻',designer:'🎨',tester:'🧪',analyst:'📊',operator:'🛠',coordinator:'🧭'};
export function mentionAvatar(member:{name:string;avatar?:string}){
  const image=member.avatar&&/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(member.avatar)?member.avatar:null;
  return{image,label:presets[member.avatar?.replace(/^preset:/,'')||'']||Array.from(member.name)[0]||'成'};
}
