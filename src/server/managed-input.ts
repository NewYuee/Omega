import type {ImageStore} from './images.ts';
import type {PastedTextStore} from './pasted-content.ts';

// Shared by managed turns, including Feishu private conversations. Files must be
// expanded into model input, not represented by a filename or local ID alone.
export async function prepareManagedInput(images:ImageStore,pastes:PastedTextStore,text:string,attachments:{imageIds?:string[];pasteIds?:string[]}={}){
  const pasteRefs=await pastes.refs(attachments.pasteIds||[]);
  const input=await images.turnInput(await pastes.turnInput([{type:'text',text}],attachments.pasteIds||[]),attachments.imageIds||[]);
  return{input,pasteRefs};
}
