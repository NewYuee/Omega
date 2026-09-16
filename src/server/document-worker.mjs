import {unzipSync} from 'fflate';
import {parseOffice} from 'officeparser';

process.once('message',async({data,type})=>{
  try{
    if(type!=='pdf'){
      let bytes=0,count=0;const entries=new Set();
      unzipSync(new Uint8Array(data),{filter:file=>{
        bytes+=file.originalSize;count++;
        if(bytes>32*1024*1024||count>2000)throw Error('文档解压体积或条目数量超限，请拆分后重试');
        if(file.name.split('/').includes('..')||file.name.startsWith('/'))throw Error('文档包含不安全路径');
        entries.add(file.name);return false;
      }});
      const required={docx:'word/document.xml',xlsx:'xl/workbook.xml',pptx:'ppt/presentation.xml'}[type];
      if(!entries.has('[Content_Types].xml')||!entries.has(required))throw Error('文件结构与扩展名不匹配，或文档已损坏');
      if([...entries].some(name=>/vbaProject\.bin$/i.test(name)))throw Error('暂不支持包含宏的文档，请另存为不含宏的版本');
    }
    const ast=await parseOffice(Buffer.from(data),{fileType:type,extractAttachments:false,ocr:false,decompressionLimits:{maxUncompressedBytes:32*1024*1024,maxZipEntries:2000,maxTableCells:100000}});
    if(ast.warnings?.some(issue=>issue.type==='error'||/LIMIT|TRUNCAT/i.test(String(issue.code))))throw Error('文档解析不完整或达到限制，请拆分后重试');
    const text=ast.toText();
    if(Buffer.byteLength(text)>500*1024)throw Error('提取文字超过 500 KB，请拆分文档后重试');
    process.send?.({text});
  }catch(error){
    const known=/文档|文件|提取文字|暂不支持/.test(error?.message||'');
    process.send?.({error:known?error.message:'无法解析文档：可能已损坏、加密或格式不受支持；请解密或另存后重试'});
  }
});
