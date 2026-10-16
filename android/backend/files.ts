import { native } from './native';
export async function access(uri: string) {
  if (!native.access(uri)) throw new Error('文件不可读取');
}
export async function readdir(): Promise<never> { throw new Error('安卓文件通过授权选择器读取'); }
export async function realpath(): Promise<never> { throw new Error('安卓文件通过授权选择器读取'); }
export async function stat(): Promise<never> { throw new Error('安卓文件通过授权选择器读取'); }
