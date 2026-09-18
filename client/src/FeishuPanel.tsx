import {useEffect,useRef,useState} from 'react';
type Target={kind:'group'|'thread';id:string};
type Binding={chatId:string;chatType:'group'|'p2p';userIds:string[];allowAllMembers?:boolean;target:Target};
type Settings={enabled:boolean;botOpenId:string;omegaUrl?:string;bindings:Binding[]};
type Status={enabled?:boolean;configurationError?:boolean;hasError?:boolean;connection?:string;revision:string;settings:Settings;appId:string;hasSecret:boolean;environmentManaged:boolean;outbox?:{status:string;count:number}[];pairing?:{code:string;expiresAt:number;candidate?:{chatId:string;chatType:'group'|'p2p';userId:string}}|null};
type Targets={groups:{id:string;name:string}[];threads:{id:string;name:string}[];nextCursor?:string|null};
export function FeishuPanel({read}:{read:(route:string,data?:unknown)=>Promise<unknown>}){
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [appId,setAppId]=useState(''),[secret,setSecret]=useState(''),[bindings,setBindings]=useState<Binding[]>([]),[omegaUrl,setOmegaUrl]=useState('');
  const [targets,setTargets]=useState<Targets>({groups:[],threads:[]}),[targetId,setTargetId]=useState(''),[search,setSearch]=useState(''),[dirty,setDirty]=useState(false);
  const revision=useRef(''),mounted=useRef(true),requestEpoch=useRef(0),mutating=useRef(false);
  const accept=(s:Status,reset=false)=>{if(!s.settings||!s.revision){setError('服务端仍是旧版本，请重启 Omega 后刷新。');return;}setStatus(s);if(reset){revision.current=s.revision;setAppId(s.appId||'');setBindings(s.settings.bindings);setOmegaUrl(s.settings.omegaUrl||'');setDirty(false);}};
  const refresh=async(reset=false)=>{if(mutating.current)return;const epoch=++requestEpoch.current;if(reset){mutating.current=true;setBusy(true);}try{const s=await read('feishu') as Status;if(mounted.current&&epoch===requestEpoch.current)accept(s,reset);}catch(e){if(mounted.current&&epoch===requestEpoch.current)setError(e instanceof Error?e.message:'无法读取飞书连接状态');}finally{if(reset){mutating.current=false;if(mounted.current)setBusy(false);}}};
  const loadTargets=async(cursor?:string)=>{try{const value=await read('feishu/targets'+(cursor?`?cursor=${encodeURIComponent(cursor)}`:'')) as Targets;if(mounted.current)setTargets(old=>({...value,threads:cursor?[...new Map([...old.threads,...value.threads].map(t=>[t.id,t])).values()]:value.threads}));}catch{if(mounted.current)setError('无法读取 Omega 会话列表，请确认 App Server 已连接');}};
  useEffect(()=>{mounted.current=true;void refresh(true);void loadTargets();const timer=setInterval(()=>void refresh(),3000);return()=>{mounted.current=false;clearInterval(timer);};},[read]);
  const run=async(action:string,data:Record<string,unknown>={},reset=true)=>{
    if(mutating.current)return;mutating.current=true;requestEpoch.current++;
    setBusy(true);setError('');setNotice('');
    try{const value=await read('feishu',{action,revision:revision.current,...data}) as Status;if(mounted.current){accept(value,reset);setNotice(value.configurationError?'配置已保存，但长连接未启动，请检查网络和飞书后台订阅':'操作已完成');if(action==='connect')setSecret('');if(action==='confirmPair')setTargetId('');}}
    catch(e){if(mounted.current)setError(e instanceof Error?e.message:String(e));}
    finally{requestEpoch.current++;mutating.current=false;if(mounted.current)setBusy(false);}
  };
  const candidate=status?.pairing?.candidate;
  useEffect(()=>{setTargetId('');setSearch('');},[status?.pairing?.code,candidate?.chatId,candidate?.chatType]);
  const options=candidate?.chatType==='p2p'?targets.threads:targets.groups;
  const targetBindings=(id:string)=>(status?.settings.bindings||[]).filter(b=>b.target.id===id&&b.target.kind===(candidate?.chatType==='p2p'?'thread':'group'));
  const removeBinding=(binding:Binding)=>{
    if(!status||dirty)return;
    if(!confirm(`立即移除 ${binding.chatId} 的绑定？成功后该聊天不能再发起任务；不会删除 Omega 群组或撤销已执行操作。`))return;
    void run('save',{enabled:status.settings.enabled,bindings:status.settings.bindings.filter(b=>b.chatId!==binding.chatId),omegaUrl:status.settings.omegaUrl,confirmAuthorization:true});
  };
  const updateBinding=(index:number,change:Partial<Binding>)=>{setBindings(items=>items.map((b,i)=>i===index?{...b,...change}:b));setDirty(true);};
  const confirmSave=()=>{if(!confirm('保存这些绑定和授权范围？授权用户能够驱动目标会话的工具，群内结果对全群可见。'+(bindings.some(b=>b.allowAllMembers)?'已开放的群包含以后新加入的成员，共享目标上下文并消耗模型额度；停止和决策仍限原提问者，执行审批不变。':'')))return;void run('save',{enabled:status?.settings.enabled,bindings,omegaUrl,confirmAuthorization:true});};
  return <section className="omega-integrations omega-feishu" aria-label="飞书连接器">
    <div className="omega-center-section-title"><div><h3>飞书机器人</h3><p>{!status?'正在读取…':status.configurationError?'配置或连接启动失败':!status.enabled?'未启用':status.connection==='connected'?'长连接已连接':`连接状态：${status.connection||'连接中'}`}</p></div><button disabled={busy} onClick={()=>{if(!dirty||confirm('刷新会丢弃尚未保存的绑定修改，继续？'))void refresh(true);}}>刷新</button></div>
    {error&&<p className="omega-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {dirty&&<div role="status"><p>绑定设置有未保存修改，尚未生效。请保存或放弃修改后再配对、移除绑定。</p><button disabled={busy} onClick={()=>{if(confirm('放弃尚未保存的绑定修改？'))void refresh(true);}}>放弃修改</button></div>}
    {status&&<>
      <form className="omega-center-form" onSubmit={e=>{e.preventDefault();const changed=appId!==status.appId&&!!status.settings.bindings.length;if(changed&&!confirm('更换飞书应用会清空原应用的会话绑定，继续？'))return;void run('connect',{appId,appSecret:secret,confirmReset:changed});}}>
        <fieldset disabled={busy} className="omega-feishu-fields"><legend>1 · 连接应用</legend>
          <p>{status.environmentManaged?'凭据由部署环境管理，不能在这里覆盖。':'凭据仅保存在服务端，加密存储，不回显、不进入普通备份。远程配置请使用 HTTPS。'}</p>
          <label>App ID<input value={appId} disabled={status.environmentManaged} onChange={e=>setAppId(e.target.value)} placeholder="cli_…" autoComplete="off" required maxLength={64}/></label>
          {!status.environmentManaged&&<label>App Secret<input type="password" value={secret} onChange={e=>setSecret(e.target.value)} placeholder={status.hasSecret?'已保存，留空保留原密钥':'输入应用 Secret'} autoComplete="new-password" required={!status.hasSecret} maxLength={512}/></label>}
          {status.settings.botOpenId&&<small>机器人：{status.settings.botOpenId}</small>}
          <div className="omega-center-actions"><button type="submit" disabled={dirty}>{busy?'处理中…':'验证并保存连接'}</button>{status.enabled&&<><button type="button" disabled={dirty} onClick={()=>void run('reconnect')}>重新连接</button><button type="button" disabled={dirty} onClick={()=>{if(confirm('停用飞书消息入口？Omega Web 不受影响。'))void run('disable');}}>停用</button></>}</div>
        </fieldset>
      </form>
      <fieldset disabled={busy} className="omega-feishu-fields"><legend>2 · 配对飞书聊天</legend>
        <p>生成配对码，在目标群 @机器人发送；私聊直接发送。识别后在此确认授权，不会自动执行任务。</p>
        <button disabled={!status.enabled||dirty} onClick={()=>void run('pair',{},false)}>生成 5 分钟一次性配对码</button>
        {dirty&&<small>请先保存绑定修改，再进行配对。</small>}
        {status.pairing&&<div className="omega-feishu-pair"><code>/omega-pair {status.pairing.code}</code><div className="omega-center-actions"><button onClick={()=>void navigator.clipboard.writeText(`/omega-pair ${status.pairing!.code}`).then(()=>setNotice('配对命令已复制')).catch(()=>setError('复制失败，请手动复制配对命令'))}>复制命令</button><button onClick={()=>void run('cancelPair',{},false)}>取消配对</button></div><small>有效至 {new Date(status.pairing.expiresAt).toLocaleTimeString()}；只发给你要授权的聊天。</small>
          {candidate?<><p>已识别{candidate.chatType==='group'?'群聊':'私聊'}：{candidate.chatId}<br/>申请用户：{candidate.userId}</p><label>搜索 Omega 目标<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="输入群组或会话名称"/></label><label>绑定到<select aria-label="绑定到" value={targetId} onChange={e=>setTargetId(e.target.value)}><option value="">请选择{candidate.chatType==='group'?'群组':'独立会话'}</option>{options.filter(t=>t.id===targetId||`${t.name} ${t.id}`.toLowerCase().includes(search.toLowerCase())).map(t=><option key={t.id} value={t.id}>{t.name||t.id}{targetBindings(t.id).length?` · 已绑定 ${targetBindings(t.id).length} 个飞书聊天（可复用）`: ''} </option>)}</select></label>{targetId&&targetBindings(targetId).some(b=>b.chatId!==candidate.chatId)&&<p role="note">此目标已被其他飞书聊天使用，可以继续绑定；它们将共享 Omega 上下文，不是隔离会话。</p>}{candidate.chatType==='p2p'&&targets.nextCursor&&<button onClick={()=>void loadTargets(targets.nextCursor!)}>加载更多会话</button>}<button disabled={!targetId||dirty} onClick={()=>{const target={kind:candidate.chatType==='group'?'group':'thread',id:targetId};if(confirm(`授权 ${candidate.userId} 在 ${candidate.chatId} 驱动目标 ${options.find(t=>t.id===targetId)?.name||targetId}？${targetBindings(targetId).some(b=>b.chatId!==candidate.chatId)?'此目标已被其他聊天绑定，继续将共享上下文。':''}若已有不同目标，将替换原绑定和白名单。`))void run('confirmPair',{code:status.pairing!.code,target,confirmAuthorization:true});}}>确认授权并绑定</button></>:<p role="status">等待飞书消息…请确认已订阅接收消息事件并发布应用。</p>}
        </div>}
      </fieldset>
      <fieldset disabled={busy} className="omega-feishu-fields"><legend>3 · 会话绑定与白名单</legend>
        {!bindings.length&&<p>尚无绑定。即使机器人已连接，也不会执行任何任务。</p>}
        {bindings.map((b,index)=><div className="omega-feishu-binding" key={b.chatId}>
          <strong>{b.chatType==='group'?'飞书群':'飞书私聊'} · {b.chatId}</strong>
          <label>Omega 目标<select value={b.target.id} onChange={e=>updateBinding(index,{target:{...b.target,id:e.target.value},allowAllMembers:false})}>{!(b.target.kind==='group'?targets.groups:targets.threads).some(t=>t.id===b.target.id)&&<option value={b.target.id}>{b.target.id}</option>}{(b.target.kind==='group'?targets.groups:targets.threads).map(t=><option key={t.id} value={t.id}>{t.name||t.id}</option>)}</select></label>
          {b.chatType==='group'&&<><label>群成员使用范围<select aria-label={`群成员使用范围 ${b.chatId}`} value={b.allowAllMembers?'all':'allowlist'} onChange={e=>updateBinding(index,{allowAllMembers:e.target.value==='all'})}><option value="allowlist">仅授权成员（默认）</option><option value="all">允许此群所有成员使用</option></select></label><small>{b.allowAllMembers?'此群当前及以后加入的成员均可 @机器人提问，共享上下文并消耗模型额度。停止、决策仅限原提问者，执行审批不变。':'仅下方授权成员可以 @机器人提问；切换目标后恢复此范围。'}</small></>}
          <p>{b.allowAllMembers?'保留白名单（关闭全群开放后生效）：':'允许用户（新增用户请让该用户发送新的配对码）：'}</p><ul>{b.userIds.map(id=><li key={id}>{id} <button aria-label={`移除用户 ${id}`} disabled={b.userIds.length===1} onClick={()=>updateBinding(index,{userIds:b.userIds.filter(user=>user!==id)})}>移除</button></li>)}</ul><button className="danger" disabled={dirty} title={dirty?'请先保存或放弃未保存修改':'确认后立即保存移除'} onClick={()=>removeBinding(b)}>移除绑定</button>
        </div>)}
        <label>打开 Omega 的地址（可选）<input type="url" value={omegaUrl} onChange={e=>{setOmegaUrl(e.target.value);setDirty(true);}} placeholder="https://omega.example.com/"/></label><small>不要填写访问密钥。停用或更换绑定不会撤销已经执行的外部操作。</small>
        <button disabled={!dirty||!status.hasSecret} onClick={confirmSave}>保存绑定设置</button>
      </fieldset>
      {status.outbox?.filter(item=>item.status==='unknown').map(item=><p key={item.status}>{item.count} 条回传结果待核对，不自动重发。</p>)}
      {status.hasError&&<p className="omega-error">近期出现连接或接口错误，请核对飞书后台权限、发布状态及网络。</p>}
    </>}
    <details><summary>飞书后台配置指引</summary><p>创建企业自建应用并启用机器人，开通以下权限：</p><ul>{['im:message:send_as_bot','im:message.group_at_msg:readonly','im:message.p2p_msg:readonly'].map(scope=><li key={scope}><code>{scope}</code> <button onClick={()=>void navigator.clipboard.writeText(scope).catch(()=>setError('复制失败'))}>复制</button></li>)}</ul><p>事件与回调均选择长连接。事件添加 <code>im.message.receive_v1</code>；回调添加 <code>card.action.trigger</code>。发布版本并把机器人加入目标群。若后台提示没有长连接，请先在此验证连接再返回保存。</p><p>图文图片及引用读取需开通消息读取权限（如 <code>im:message:readonly</code>），以飞书后台「获取指定消息的内容」及资源接口要求为准；权限变更后请发布应用。最多沿引用链读取 20 层，不拉取全群历史；直接图文与引用共用最多 20 个附件、合计 32 MB。</p><p>支持纯文本、图片＋文字混排提问，也可引用图片、文本/PDF/Office 文件及可读取的卡片。群内须 @机器人；执行审批仍在 Omega 处理。同一应用只运行一个连接器实例。</p></details>
  </section>;
}
