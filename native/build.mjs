import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'native-dist');
await mkdir(output, { recursive: true });
// Explicit allowlist: never package server data, keys, uploads or workspace files.
for (const file of ['index.html','style.css']) await copyFile(path.join(root,'public',file), path.join(output,file));
await copyFile(path.join(root,'client','src','product.css'),path.join(output,'omega-product.css'));
await build({
  absWorkingDir:root, entryPoints:['native/entry.js'], outfile:'native-dist/app.js',
  bundle:true, format:'esm', target:['safari15','chrome105'], minify:true,
  plugins:[{name:'packaged-vendor',setup(builder) {
    builder.onResolve({filter:/^\/vendor\//},args=>{
      const vendors={'/vendor/marked.js':'node_modules/marked/lib/marked.esm.js','/vendor/purify.js':'node_modules/dompurify/dist/purify.es.mjs'};
      if (!vendors[args.path]) throw new Error('Unknown vendor asset');
      return {path:path.join(root,vendors[args.path])};
    });
  }}]
});
const html = await readFile(path.join(output,'index.html'),'utf8');
await writeFile(path.join(output,'index.html'),html.replace('initial-scale=1','initial-scale=1,viewport-fit=cover').replace('</head>','<link rel="stylesheet" href="/omega-product.css"></head>'));
console.log('Native frontend bundled (local assets only).');
