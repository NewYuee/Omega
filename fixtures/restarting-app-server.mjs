import {readFile,writeFile} from 'node:fs/promises';

const counter=process.argv[2];
let count=0;
try{count=Number(await readFile(counter,'utf8'))||0}catch{}
await writeFile(counter,String(count+1));
if(count===0)process.exit(23);

process.stdin.setEncoding('utf8');
let buffer='';
process.stdin.on('data',chunk=>{
  buffer+=chunk;
  let newline;
  while((newline=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
    if(!line)continue;
    const message=JSON.parse(line);
    if(message.id)process.stdout.write(JSON.stringify({id:message.id,result:{ready:true}})+'\n');
  }
});
