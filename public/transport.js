export function createOmegaTransport({fetchImpl,getKey,deviceId,onUnauthorized=()=>{},timeoutMs=70000}){
  const authorizedFetch=(route,options={})=>fetchImpl('/api/'+route,{...options,headers:{authorization:`Bearer ${getKey()}`,'x-omega-device':deviceId,...(options.headers||{})}});
  const request=async(route,data)=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await authorizedFetch(route,{signal:controller.signal,method:data?'POST':'GET',...(data?{headers:{'content-type':'application/json'},body:JSON.stringify(data)}:{})});
      if(response.status===401)onUnauthorized();
      let result;
      try{result=await response.json();}
      catch(error){if(controller.signal.aborted)throw error;throw new Error(`服务器响应格式异常（HTTP ${response.status}），请检查网络或 FRP 转发`);}
      if(!response.ok)throw Object.assign(new Error(result.error||`HTTP ${response.status}`),{status:response.status});
      return result;
    }catch(error){if(controller.signal.aborted)throw new Error(`请求等待超过 ${Math.round(timeoutMs/1000)} 秒，结果尚未确认`);throw error;}
    finally{clearTimeout(timer);}
  };
  return{request,rpc:(method,params={},extra={})=>request('rpc',{method,params,...extra}),fetch:authorizedFetch};
}
