import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { wbiParams, tvParams, recommendationParams, md5 } from '../electron/protocol/signing';
import { parseUrl, scanLocal } from '../electron/providers/local';
import { GamepadInterpreter, nearest } from '../src/input/gamepad';
import { defaultPreferences } from '../src/shared/types';
import { MediaGateway, parseRange, rewriteHls } from '../electron/playback/gateway';
import { buildDashManifest } from '../electron/playback/dash';
import { Store } from '../electron/storage/store';
import { Vault } from '../electron/accounts/vault';
import { BilibiliAccount } from '../electron/accounts/bilibili-account';
import { BilibiliProvider } from '../electron/providers/bilibili';
import { schemas } from '../electron/ipc';
const temp = () => mkdtemp(join(tmpdir(),'yingji-test-'));
const cipher = { available: () => true, encrypt: (value:string) => Buffer.from(value), decrypt: (value:Buffer) => value.toString() };
const reply = (data: any) => new Response(JSON.stringify({code:0,data}),{headers:{'content-type':'application/json'}});
describe('Bilibili protocol',()=>{
  it('matches the published WBI vector and filters reserved characters',()=>{
    expect(wbiParams({foo:'114',bar:'514',zab:1919810},'7cd084941338484aae1ad9425b84077c','4932caff0ff746eab6f01bf08b70ac45',1702204169)).toBe('bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4');
    expect(wbiParams({q:"a!'()* b"},'a'.repeat(32),'b'.repeat(32),1)).toContain('q=a%20b');
  });
  it('uses sorted form encoding for TV signing and exact App profile',()=>{
    const signed=tvParams({ts:0,local_id:0}); const signature=signed.get('sign'); signed.delete('sign');
    expect(signature).toBe(md5(signed.toString()+'59b43e04ad6965f34319062b478f83dd'));
    expect(recommendationParams('token',99)).toEqual({build:74800100,device:'pad',mobi_app:'iphone',c_locate:'zh-Hans_CN',s_locale:'zh-Hans_CN',idx:99,appkey:'4409e2ce8ffd12b8',access_key:'token'});
  });
  it('preserves recommendation order and uses the last accepted card for pagination',async()=>{
    const dir=await temp();try{
      const vault=new Vault(dir,cipher);vault.value={accessToken:'test'};
      let calls=0;const urls:string[]=[];
      const card=(aid:number,title:string,idx:number,card_type='small_cover_v2')=>({card_type,goto:'av',args:{aid},bvid:`BV-fixture-${aid}`,title,idx});
      const fetcher=(async(url:any)=>{urls.push(String(url));calls++;return reply({items:calls===1?[card(1,'first',90),card(2,'ad',91,'cm_v1'),card(3,'third',92),card(5,'banner',99,'banner_v8')]:[card(1,'duplicate',93),card(4,'fourth',94)]});}) as typeof fetch;
      const provider=new BilibiliProvider(new BilibiliAccount(vault,fetcher));
      expect((await provider.browse({kind:'recommend'})).items.map(x=>x.title)).toEqual(['first','third']);
      await provider.browse({kind:'recommend'});expect(calls).toBe(1);
      expect((await provider.browse({kind:'recommend',cursor:'92'})).items.map(x=>x.title)).toEqual(['first','third','fourth']);
      expect(new URL(urls[1]).searchParams.get('idx')).toBe('92');
      expect((await provider.browse({kind:'recommend',refresh:true})).items.map(x=>x.title)).toEqual(['duplicate','fourth']);
      expect(new URL(urls[2]).searchParams.get('idx')).toBe('1');
      expect(urls.every(x=>new URL(x).hostname==='app.bilibili.com')).toBe(true);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
});
describe('account lifecycle',()=>{
  it('never resurrects a credential after logout during refresh',async()=>{
    const dir=await temp();try{
      const vault=new Vault(dir,cipher);vault.value={accessToken:'old',refreshToken:'refresh',expiresAt:Date.now()-1};
      let finish!:(value:Response)=>void;const pending=new Promise<Response>(r=>{finish=r;});
      const account=new BilibiliAccount(vault,(()=>pending) as typeof fetch);
      const refreshing=account.accessKey();await vault.clear();finish(reply({token_info:{access_token:'new',expires_in:1000}}));
      await expect(refreshing).rejects.toThrow('过期');expect(vault.value).toEqual({});
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  it('keeps secrets in memory when the OS keyring is unavailable',async()=>{
    const dir=await temp();try{const vault=new Vault(dir,{...cipher,available:()=>false});await vault.init();await vault.update({accessToken:'secret'});expect(vault.storage).toBe('memory');await expect(readFile(join(dir,'account.enc'))).rejects.toThrow();}finally{await rm(dir,{recursive:true,force:true});}
  });
});
describe('media transport',()=>{
  it('supports open, bounded and suffix byte ranges; rejects invalid requests',()=>{
    expect(parseRange('bytes=4-',10)).toEqual({start:4,end:9});expect(parseRange('bytes=-3',10)).toEqual({start:7,end:9});expect(parseRange('bytes=0-100',10)).toEqual({start:0,end:9});
    for(const value of ['bytes=10-','bytes=9-2','bytes=-0','bytes=0-2,4-6','bytes=-'])expect(()=>parseRange(value,10)).toThrow();
  });
  it('serves selected files through opaque capabilities and revokes access',async()=>{
    const dir=await temp(),gateway=new MediaGateway();try{const path=join(dir,'sample.mp4');await writeFile(path,'0123456789');await gateway.start();const address=gateway.register({session:'one',path});const response=await fetch(address,{headers:{Range:'bytes=2-5'}});expect(response.status).toBe(206);expect(response.headers.get('content-range')).toBe('bytes 2-5/10');expect(await response.text()).toBe('2345');expect((await fetch(`${gateway.origin}/media/not-a-token`)).status).toBe(404);gateway.release('one');expect((await fetch(address)).status).toBe(404);}finally{await gateway.stop();await rm(dir,{recursive:true,force:true});}
  });
  it('rewrites child playlists, segments and encryption key URIs without losing queries',()=>{
    const seen:string[]=[];const body=rewriteHls('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../key?x=1"\nchild/stream.m3u8\nsegment.ts?token=x\n','https://media.example/live/main.m3u8',url=>{seen.push(url);return `http://127.0.0.1/token-${seen.length}`;});
    expect(seen).toEqual(['https://media.example/key?x=1','https://media.example/live/child/stream.m3u8','https://media.example/live/segment.ts?token=x']);expect(body).not.toContain('media.example');
    expect(()=>rewriteHls('file:///etc/passwd','https://example.com/',x=>x)).toThrow();
  });
  it('generates separate DASH audio/video with the actually available quality',()=>{
    const track={id:64,baseUrl:'https://media.example/video?a=1&b=2',codecs:'avc1.640028',bandwidth:1000,width:1280,height:720,SegmentBase:{Initialization:'0-900',indexRange:'901-1200'}};
    const result=buildDashManifest({duration:100,video:[track,{...track,id:80,codecs:'hev1'}],audio:[{...track,id:30280,codecs:'mp4a.40.2'}]},x=>x,80);
    expect(result.quality).toBe(64);expect(result.manifest).toContain('audio/mp4');expect(result.manifest).toContain('&amp;b=2');expect(result.manifest).not.toContain('hev1');
  });
});
describe('local content and progress',()=>{
  it('parses supported sources and refuses command/file URLs',()=>{
    expect(parseUrl('BV17x411w7KC').bvid).toBe('BV17x411w7KC');expect(parseUrl('https://www.bilibili.com/bangumi/play/ep123').episodeId).toBe(123);expect(parseUrl('https://live.bilibili.com/6').roomId).toBe(6);expect(parseUrl('http://192.168.1.2/film.mp4').source).toBe('url');
    for(const url of ['file:///secret','javascript:alert(1)','https://user:password@example.com/movie'])expect(()=>parseUrl(url)).toThrow();
  });
  it('indexes supported files and persists separate part progress including rewind',async()=>{
    const dir=await temp();try{
      await writeFile(join(dir,'电影.mp4'),'test');await writeFile(join(dir,'ignore.txt'),'test');expect(await scanLocal([dir])).toHaveLength(1);
      const store=new Store(dir);await store.init();const item=parseUrl('BV17x411w7KC');
      await store.record({item,part:{id:'one',title:'one'},position:100,duration:200,updatedAt:1});
      await store.record({item,part:{id:'two',title:'two'},position:50,duration:200,updatedAt:2});
      await store.record({item,part:{id:'one',title:'one'},position:5,duration:200,updatedAt:3});
      const reopened=new Store(dir);await reopened.init();expect(reopened.state.history.map(x=>x.position)).toEqual([5,50]);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
});
describe('controller and IPC boundary',()=>{
  const makePad=()=>({id:'Xbox 360',mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))});
  it('debounces A while allowing held D-pad repeat and clears on disconnect',()=>{
    const pad=makePad(),input=new GamepadInterpreter();pad.buttons[0].pressed=true;pad.buttons[15].pressed=true;
    expect(input.sample(pad,0,defaultPreferences.gamepadMap)).toEqual(['confirm','right']);expect(input.sample(pad,100,defaultPreferences.gamepadMap)).toEqual([]);expect(input.sample(pad,450,defaultPreferences.gamepadMap)).toEqual(['right']);input.sample(undefined,500,defaultPreferences.gamepadMap);expect(input.sample(pad,510,defaultPreferences.gamepadMap)).toEqual(['confirm','right']);
  });
  it('ignores drift and chooses adjacent columns without wrapping',()=>{
    const input=new GamepadInterpreter(),pad=makePad();pad.axes=[.2,.1];expect(input.sample(pad,0,defaultPreferences.gamepadMap)).toEqual([]);pad.axes=[.7,.1];expect(input.sample(pad,1,defaultPreferences.gamepadMap)).toEqual(['right']);
    const origin={x:100,y:100,width:100,height:100};expect(nearest(origin,[{x:210,y:100,width:100,height:100},{x:110,y:250,width:100,height:100}], 'right')).toBe(0);expect(nearest(origin,[{x:210,y:100,width:100,height:100}], 'left')).toBe(-1);
  });
  it('rejects malformed privileged operations',()=>{
    expect(schemas.progress.safeParse(['not-session',-10,Infinity,true]).success).toBe(false);expect(schemas.login.safeParse(['arbitrary']).success).toBe(false);expect(schemas.queue.safeParse([Array(501).fill(parseUrl('BV17x411w7KC'))]).success).toBe(false);
  });
});
