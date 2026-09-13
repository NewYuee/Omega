import {build} from 'esbuild';
import {copyFile,cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=new URL('../',import.meta.url),out=new URL('../web-dist/',import.meta.url);
await mkdir(out,{recursive:true});await cp(new URL('../public/',import.meta.url),out,{recursive:true});await copyFile(new URL('./src/product.css',import.meta.url),new URL('omega-product.css',out));
await build({absWorkingDir:path.resolve(new URL('..',import.meta.url).pathname),entryPoints:['client/src/main.tsx'],outfile:'web-dist/omega-product.js',bundle:true,format:'esm',target:['safari15','chrome105'],minify:true});
const indexPath=new URL('index.html',out),html=await readFile(indexPath,'utf8');await writeFile(indexPath,html.replace('</head>','<link rel="stylesheet" href="/omega-product.css"></head>').replace('</body>','<script type="module" src="/omega-product.js"></script></body>'));
console.log('Omega React client built.');
