import { native } from './native';
export const randomUUID = () => crypto.randomUUID();
export function createHash(algorithm: string) {
  let input = '';
  return {
    update(value: string) { input += value; return this; },
    digest(format: string) {
      if (format !== 'hex' || !['md5', 'sha256'].includes(algorithm)) throw new Error('不支持的摘要格式');
      return native.digest(algorithm, input);
    },
  };
}
