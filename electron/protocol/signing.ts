import { createHash } from 'node:crypto';
export const md5 = (value: string) => createHash('md5').update(value).digest('hex');
export const TV_KEY = '4409e2ce8ffd12b8';
const TV_SECRET = '59b43e04ad6965f34319062b478f83dd';
export function tvParams(input: Record<string, string | number>) {
  const params = new URLSearchParams(Object.entries({ ...input, appkey: TV_KEY }).map(([k, v]) => [k, String(v)]));
  params.sort(); params.set('sign', md5(params.toString() + TV_SECRET)); return params;
}
const permutation = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
export function wbiParams(input: Record<string, string | number>, img: string, sub: string, timestamp = Math.floor(Date.now() / 1000)) {
  const key = permutation.map(i => (img + sub)[i]).join('').slice(0, 32);
  const fields = { ...input, wts: timestamp };
  const query = Object.keys(fields).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(fields[k as keyof typeof fields]).replace(/[!'()*]/g, ''))}`).join('&');
  return `${query}&w_rid=${md5(query + key)}`;
}
/** BewlyCat 9d0b0c6: API defaults merged with the actual ForYou.vue App call. */
export function recommendationParams(accessKey: string, idx: string | number = 1) {
  return { build: 74800100, device: 'pad', mobi_app: 'iphone', c_locate: 'zh-Hans_CN', s_locale: 'zh-Hans_CN', idx, appkey: TV_KEY, access_key: accessKey };
}
