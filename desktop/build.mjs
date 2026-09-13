import {build} from 'esbuild';import {cp,mkdir} from 'node:fs/promises';
await mkdir('desktop-dist',{recursive:true});
await Promise.all([build({entryPoints:['desktop/main.ts'],outfile:'desktop-dist/main.cjs',bundle:true,platform:'node',format:'cjs',external:['electron'],target:'node22'}),build({entryPoints:['desktop/preload.ts'],outfile:'desktop-dist/preload.cjs',bundle:true,platform:'node',format:'cjs',external:['electron'],target:'node22'}),build({entryPoints:['desktop/setup.ts'],outfile:'desktop-dist/setup.js',bundle:true,platform:'browser',target:'chrome120'})]);
await Promise.all(['setup.html','setup.css'].map(file=>cp('desktop/'+file,'desktop-dist/'+file)));await cp('native/icon.svg','desktop-dist/icon.svg');console.log('Omega Electron runtime built.');
