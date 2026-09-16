import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {importDocument,MAX_DOCUMENT_BYTES} from '../src/server/document-import.ts';

const zip=files=>Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name,text])=>[name,strToU8(text)]))));
const contentTypes='<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>';
test('Office documents extract readable Word, Excel and slide content',async()=>{
  const fixtures={
    docx:{'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello Word</w:t></w:r></w:p></w:body></w:document>'},
    xlsx:{'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hello Excel</t></is></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>'},
    pptx:{'ppt/presentation.xml':'<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>','ppt/slides/slide1.xml':'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello PowerPoint</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'}
  };
  for(const [ext,parts]of Object.entries(fixtures)){const text=await importDocument('sample.'+ext,async()=>zip({'[Content_Types].xml':contentTypes,...parts}));assert.match(text,/Hello/);assert.match(text,new RegExp('sample\\.'+ext));}
});
test('PDF extracts text in isolated process',async()=>{
  const stream='BT /F1 12 Tf 20 100 Td (Hello PDF) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets=[0];for(const [i,obj]of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
  const start=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  assert.match(await importDocument('sample.pdf',async()=>Buffer.from(pdf)),/Hello PDF/);
});
test('document import rejects old formats, forged signatures, oversized input and macro containers',async()=>{
  for(const name of ['x.doc','x.xls','x.ppt','x.zip'])await assert.rejects(()=>importDocument(name,async()=>Buffer.from('x')),/仅支持/);
  await assert.rejects(()=>importDocument('x.docx',async()=>Buffer.from('x')),/不匹配/);
  await assert.rejects(()=>importDocument('x.pdf',async()=>Buffer.alloc(MAX_DOCUMENT_BYTES+1)),/10 MB/);
  await assert.rejects(()=>importDocument('x.docx',async()=>zip({'[Content_Types].xml':contentTypes,'word/document.xml':'<doc/>','word/vbaProject.bin':'macro'})),/宏/);
  await assert.rejects(()=>importDocument('x.docx',async()=>zip({'bad.xml':'bad'})),/结构/);
});
