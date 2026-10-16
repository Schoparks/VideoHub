import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
await mkdir('.tmp',{recursive:true});
await build({stdin:{contents:`
const { BilibiliProvider } = require('./electron/providers/bilibili');
const { BilibiliAccount } = require('./electron/accounts/bilibili-account');
const { Vault } = require('./electron/accounts/vault');
const { MediaGateway } = require('./electron/playback/gateway');
const vault=new Vault('.tmp',{available:()=>false,encrypt:()=>Buffer.alloc(0),decrypt:()=>''});
const bili=new BilibiliProvider(new BilibiliAccount(vault));
(async()=>{
 const report={};
 const jobs=[['metadata/playback',async()=>{const detail=await bili.detail({id:'bili:BV17x411w7KC',source:'bilibili',kind:'video',title:'probe',bvid:'BV17x411w7KC'});const play=await bili.play(detail.item,detail.parts[0],64);return {parts:detail.parts.length,dashVideoTracks:play.dash?.video?.length,dashAudioTracks:play.dash?.audio?.length};}],['regions',()=>bili.browse({kind:'regions',id:4})],['cinema',()=>bili.browse({kind:'cinema',id:2})],['live search',()=>bili.browse({kind:'search',searchType:'live_room',keyword:'游戏'})]];
 await Promise.all(jobs.map(async([name,run])=>{try{const result=await run();report[name]={ok:true,...(result.items?{items:result.items.length}:result)};}catch(e){report[name]={ok:false,error:e.message};}}));
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});`,resolveDir:process.cwd()},outfile:'.tmp/probe.cjs',bundle:true,platform:'node',format:'cjs',target:'node22'});
const child=spawn(process.execPath,['.tmp/probe.cjs'],{stdio:'inherit',env:process.env});child.on('exit',code=>{process.exitCode=code||0;});
