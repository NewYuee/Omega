export type DiffLine={kind:'added'|'removed'|'context'|'section'|'note';text:string;oldLine?:number;newLine?:number};
export function repositoryDiffLines(diff:string):DiffLine[]{
  const rows:DiffLine[]=[];let oldLine=0,newLine=0,inHunk=false;
  for(const line of diff.split('\n')){
    const hunk=/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if(hunk){oldLine=Number(hunk[1]);newLine=Number(hunk[2]);inHunk=true;rows.push({kind:'section',text:`原第 ${oldLine} 行 → 新第 ${newLine} 行${hunk[3]}`});continue;}
    if(inHunk){
      if(line.startsWith('+')){rows.push({kind:'added',text:line.slice(1),newLine:newLine++});continue;}
      if(line.startsWith('-')){rows.push({kind:'removed',text:line.slice(1),oldLine:oldLine++});continue;}
      if(line.startsWith(' ')){rows.push({kind:'context',text:line.slice(1),oldLine:oldLine++,newLine:newLine++});continue;}
      if(line==='\\ No newline at end of file'){rows.push({kind:'note',text:'文件末尾没有换行'});continue;}
      inHunk=false;
    }
    if(/^(diff --git |index |--- |\+\+\+ )/.test(line))continue;
    if(line)rows.push({kind:'note',text:line});
  }
  return rows;
}
