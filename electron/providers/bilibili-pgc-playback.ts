import type { MediaItem, MediaPart } from '../../src/shared/types';
import { BiliHttp, ProviderError } from '../protocol/http';
import { verifiedClearPgcDash } from './bilibili-pgc-stream';

const enabled = (value: unknown) => value === true || value === 1 || value === '1' || value === 'true';
const disabled = (value: unknown) => value === false || value === 0 || value === '0' || value === 'false';

class PgcFormatError extends Error {}

function protectedStream(value: any): boolean {
  // Positive title flags require verification; explicit negatives retain existing behavior.
  if (enabled(value.is_drm)) return true;
  if (disabled(value.is_drm)) return false;
  return Number(value.drm_tech_type) > 0;
}

async function mediaResponse(result: any) {
  // v2 wraps the media response in video_info; retain flat responses for compatibility.
  const video = result?.video_info ?? result;
  for (const response of [result, video]) {
    if (response?.code !== undefined && Number(response.code) !== 0) {
      throw new ProviderError(String(response.message || response.msg || '当前账号无法播放这集'), Number(response.code));
    }
  }
  if (!video || typeof video !== 'object') throw new Error('B 站没有返回影视播放信息，请重试');
  if (result.play_check?.play_detail === 'PLAY_NONE' || result.play_video_type === 'none') {
    throw new Error('当前账号无法播放这集，请检查登录、会员或地区权限');
  }
  const data = { ...video };
  if (protectedStream(video)) {
    // Some PGC titles mark is_drm even when the supplied DASH is clear, as the
    // official player also demonstrates. Keep that flag and inspect the actual
    // sample descriptions; declared technologies and encrypted/unknown bytes fail closed.
    if (Number(video.drm_tech_type) > 0 || !enabled(video.is_drm)) {
      throw new PgcFormatError('这集使用 DRM 加密，当前播放内核暂不支持');
    }
    if (!video.dash) throw new PgcFormatError('标记为 DRM 的播放流暂无法验证，请重试');
    data.dash = await verifiedClearPgcDash(video.dash);
    if (!data.dash) throw new PgcFormatError('标记为 DRM 的播放流暂无法验证，请重试');
  }
  if (data.dash) {
    const videos = (data.dash.video || []).filter((track: any) => !protectedStream(track));
    const audios = (data.dash.audio || []).filter((track: any) => !protectedStream(track));
    if ((!videos.length && data.dash.video?.length) || (!audios.length && data.dash.audio?.length)) {
      throw new PgcFormatError('这集使用 DRM 加密，当前播放内核暂不支持');
    }
    data.dash = { ...data.dash, video: videos, audio: audios };
  }
  if (data.durl?.length > 1 && !data.dash?.video?.length) {
    throw new PgcFormatError('这集没有返回兼容的单段播放流，请重试');
  }
  data.is_preview = enabled(video.is_preview) || enabled(video.isPreview)
    || result.play_check?.play_detail === 'PLAY_PREVIEW' || result.play_video_type === 'preview';
  data.isPreview = data.is_preview;
  return data;
}

export async function playPgc(http: BiliHttp, item: MediaItem, part: MediaPart | undefined, quality: number) {
  const episodeId = part?.episodeId || item.episodeId;
  const cid = part?.cid || item.cid;
  if (!episodeId && !cid) throw new Error('缺少影视分集信息，请重新选择分集');
  const params = {
    ep_id: episodeId,
    cid,
    bvid: part?.bvid || item.bvid,
    avid: part?.aid || item.aid,
    qn: quality,
    fnver: 0,
    fourk: 1,
    high_quality: 1,
  };
  const result = await http.get('https://api.bilibili.com/pgc/player/web/v2/playurl', { ...params, fnval: 4048 });
  try {
    return await mediaResponse(result);
  } catch (error) {
    if (!(error instanceof PgcFormatError)) throw error;
    // Negotiate a platform-provided MP4 with the same episode, account and quality.
    // Permission failures are never retried, and encryption is never stripped.
    const compatible = await http.get('https://api.bilibili.com/pgc/player/web/v2/playurl', { ...params, fnval: 1 });
    return mediaResponse(compatible);
  }
}
