import { native } from './native';
import type { PlaybackSource } from '../../src/shared/types';
import { createMediaUrlTemplate } from '../../electron/playback/url-template';

interface Resource {
  session: string; path?: string; url?: string; backups?: string[]; text?: string; mime?: string; bili?: boolean;
  referer?: string; request?: typeof fetch;
}
export class MediaGateway {
  register(resource: Resource) {
    const result = native.register(JSON.stringify(resource));
    if (!result.startsWith('https://app.yingji.local/media/')) throw new Error(result || '无法建立媒体通道');
    return result;
  }
  registerTemplate(resource: Resource, url: string) {
    const template = createMediaUrlTemplate(url);
    return this.register({ ...resource, url, mime: 'application/x-yingji-template' }) + '/' + template.suffix;
  }
  release(session: string) { native.release(session); }
}
export function formatMime(format: PlaybackSource['format']) {
  return format === 'hls' ? 'application/vnd.apple.mpegurl' : format === 'dash' ? 'application/dash+xml' : 'video/mp4';
}
