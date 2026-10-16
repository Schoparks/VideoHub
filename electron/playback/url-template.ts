import { httpMediaUrl } from '../providers/url-media';

export interface MediaUrlTemplate {
  suffix: string;
  expand: (values: string[]) => string;
}

/** URL capabilities substitute digits only; placeholders can never change the host. */
export function createMediaUrlTemplate(input: string): MediaUrlTemplate {
  const url = httpMediaUrl(input);
  if (/\$/.test(new URL(url).host)) throw new Error('不支持动态媒体主机');
  const tokens = [...url.matchAll(/\$(Number|Time)(?:%0(\d{1,2})d)?\$/g)];
  if (!tokens.length || tokens.length > 10 || url.replace(/\$(Number|Time)(?:%0\d{1,2}d)?\$/g, '').includes('$')) {
    throw new Error('不支持的 DASH 分段模板');
  }
  return {
    suffix: tokens.map(token => token[0]).join('/'),
    expand(values) {
      if (values.length !== tokens.length || values.some(value => !/^\d{1,20}$/.test(value))) {
        throw new Error('无效的 DASH 分段参数');
      }
      let index = 0;
      return url.replace(/\$(Number|Time)(?:%0\d{1,2}d)?\$/g, () => values[index++]);
    },
  };
}
