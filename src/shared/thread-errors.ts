export const THREAD_WRITER_BUSY = 'THREAD_WRITER_BUSY';

type ErrorLike = {code?:unknown;message?:unknown;threadId?:unknown};

export function activeWriterThreadId(cause:unknown):string|null {
  const value=cause as ErrorLike|null;
  if(value?.code===THREAD_WRITER_BUSY&&typeof value.threadId==='string')return value.threadId;
  const message=value?.message instanceof String?String(value.message):typeof value?.message==='string'?value.message:String(cause||'');
  return /thread\s+([a-f0-9-]{36})\s+already has an active writer/i.exec(message)?.[1]||null;
}

export function isThreadWriterConflict(cause:unknown):boolean {
  return (cause as ErrorLike|null)?.code===THREAD_WRITER_BUSY||activeWriterThreadId(cause)!==null;
}

export function isMissingThreadHistory(cause:unknown):boolean {
  const value=cause as ErrorLike|null;
  const message=value?.message instanceof String?String(value.message):typeof value?.message==='string'?value.message:String(cause||'');
  return /no rollout found for thread id|missing source rollout|invalid paginated history lineage|thread not found|does not exist/i.test(message);
}

export function threadWriterBusyMessage():string {
  return '该会话正被另一个 Codex 窗口占用，当前以只读方式打开。其他会话和服务器连接不受影响。';
}
