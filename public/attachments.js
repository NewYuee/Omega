// Authenticated image requests use headers, never access keys in image URLs.
export function createAttachments({getKey, isLocked, onChange, onError}) {
  const dialog = document.getElementById('image-viewer');
  const viewer = document.getElementById('image-view');
  const viewerStatus = document.getElementById('image-view-status');
  const records = [];
  const resources = new Map();
  let queue = Promise.resolve(), viewerController, viewerURL;
  async function imageBlob(id, thumb, signal) {
    const response = await apiFetch('/api/images/'+encodeURIComponent(id)+(thumb ? '?size=thumb' : ''), {
      headers:{authorization:'Bearer '+getKey()},signal
    });
    if (!response.ok) {
      if (response.status === 410 || response.status === 404) throw Error('图片已过期或被清理（保留 7 天）');
      throw Error('图片加载失败，请检查连接后重试');
    }
    return response.blob();
  }
  function remove(record) {
    record.controller.abort();
    if (record.url) URL.revokeObjectURL(record.url);
    const index = records.indexOf(record); if (index >= 0) records.splice(index,1);
  }
  function renderTray() {
    onChange();
  }
  function ingest(files) {
    if (isLocked()) return;
    for (const file of files) {
      if (records.length >= 4) { onError('每条消息最多 4 张图片'); break; }
      if (!['image/png','image/jpeg','image/webp'].includes(file.type)) { onError('仅支持 PNG、JPEG、WebP 图片；请先将其他格式转换后上传'); continue; }
      if (!file.size || file.size > 8*1024*1024) { onError('每张图片不得超过 8 MB'); continue; }
      const record = {name:file.name || '粘贴的图片',status:'等待上传…',controller:new AbortController(),file};
      records.push(record);
      queue = queue.then(async () => {
        if (record.controller.signal.aborted) { record.file = null; return; }
        try {
          record.status = '上传中…'; renderTray();
          const response = await apiFetch('/api/images',{method:'POST',headers:{authorization:'Bearer '+getKey(),'content-type':record.file.type},
            body:record.file,signal:record.controller.signal});
          const result = await response.json();
          if (!response.ok) throw Error(result.error || '上传失败');
          record.image = result;
          const blob = await imageBlob(result.id,true,record.controller.signal);
          if (record.controller.signal.aborted) return;
          record.url = URL.createObjectURL(blob); record.status = '已就绪';
        } catch (e) {
          if (!record.controller.signal.aborted) { record.image = null; record.status = '上传失败，请移除后重试'; onError(e.message); }
        } finally { record.file = null; renderTray(); }
      });
    }
    renderTray();
  }
  function clearViewer() {
    viewerController?.abort(); viewer.removeAttribute('src'); viewer.hidden = true;
    if (viewerURL) URL.revokeObjectURL(viewerURL); viewerURL = null;
  }
  dialog.addEventListener('close',clearViewer);
  document.getElementById('image-view-close').onclick = () => dialog.close();
  async function openImage(ref) {
    clearViewer(); const controller = viewerController = new AbortController();
    viewerStatus.textContent = '正在加载图片…';
    if (!dialog.open) dialog.showModal();
    try {
      const blob = await imageBlob(ref.id,false,controller.signal);
      if (controller.signal.aborted) return;
      viewerURL = URL.createObjectURL(blob); viewer.src = viewerURL; viewer.hidden = false;
      viewerStatus.textContent = '图片自上传起保留 7 天';
    } catch (e) { if (!controller.signal.aborted) viewerStatus.textContent = e.message; }
  }
  function historyImages(refs = []) {
    const group = document.createElement('div'); group.className = 'message-images';
    for (const [index,ref] of refs.slice(0,4).entries()) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'history-image';
      button.textContent = '查看图片 '+(index+1);
      if (Date.now() >= ref.expiresAt) { button.textContent = '图片已过期（保留 7 天）'; button.disabled = true; }
      const resource = {controller:new AbortController(),url:null}; resources.set(button,resource);
      button.onclick = async () => {
        if (resource.url) return openImage(ref);
        button.disabled = true; button.textContent = '加载缩略图…';
        try {
          const blob = await imageBlob(ref.id,true,resource.controller.signal);
          if (resource.controller.signal.aborted) return;
          resource.url = URL.createObjectURL(blob);
          const image = document.createElement('img'); image.src = resource.url; image.alt = '图片 '+(index+1)+'，点击查看大图';
          button.replaceChildren(image); button.title = '点击查看大图';
        } catch (e) { if (!resource.controller.signal.aborted) button.textContent = e.message; }
        finally { button.disabled = false; }
      };
      group.append(button);
    }
    return group;
  }
  function prune() {
    for (const [element,resource] of resources) {
      if (element.isConnected) continue;
      resource.controller.abort(); if (resource.url) URL.revokeObjectURL(resource.url); resources.delete(element);
    }
  }
  return {
    get ready() { return records.every(r => r.image && r.url); },
    get ids() { return records.flatMap(r => r.image ? [r.image.id] : []); },
    get records() { return records.map((record,index)=>({index,name:record.name,status:record.status,url:record.url||'',ready:!!record.image&&!!record.url})); },
    ingest,
    remove(index) { const record=records[index];if(!record||isLocked())return;remove(record);renderTray(); },
    refresh:renderTray, historyImages, prune,
    clear() { for (const record of [...records]) remove(record); clearViewer(); if (dialog.open) dialog.close(); renderTray(); }
  };
}
import { apiFetch } from './platform.js';
