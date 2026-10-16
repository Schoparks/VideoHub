import { useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import { ImageOff } from 'lucide-react';
import { coverUrl, thumbnailUrl, type ArtworkSize } from '../shared/images';

interface Props extends ImgHTMLAttributes<HTMLImageElement> {
  fallback?: ReactNode;
  artworkSize?: ArtworkSize;
}

export function CoverImage({ src, alt = '', fallback, artworkSize = 960, ...props }: Props) {
  const [failed, setFailed] = useState<string>();
  const image = thumbnailUrl(src, artworkSize);
  const address = window.hubPlatform === 'android' && image
    ? `https://app.yingji.local/image?url=${encodeURIComponent(image)}` : coverUrl(image, !!window.hub);
  if (!address || failed === address) return <span className="image-fallback" role="img" aria-label={alt || '封面暂不可用'}>{fallback || <><ImageOff/><span>封面暂不可用</span></>}</span>;
  return <img decoding="async" {...props} src={address} alt={alt} referrerPolicy="no-referrer" onError={() => setFailed(address)}/>;
}
