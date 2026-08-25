import { useEffect, useRef, useState } from 'react';
import { calcThumbGrid } from '../utils';
import './ThumbnailStrip.css';

interface ThumbnailStripProps {
  thumbnails: string[];
  osThumbnail?: string | null;
  compact?: boolean;
}

export default function ThumbnailStrip({ thumbnails, osThumbnail, compact = false }: ThumbnailStripProps) {
  if (!thumbnails || thumbnails.length === 0) {
    if (osThumbnail) {
      return (
        <div className={`thumb-strip ${compact ? 'thumb-strip-compact' : ''}`}>
          <img
            className="thumb-img thumb-img-os thumb-img-loaded"
            src={osThumbnail}
            decoding="async"
            draggable={false}
            alt="OS Preview"
            style={{ gridColumn: 'span 3', gridRow: 'span 2', objectFit: 'cover' }}
          />
        </div>
      );
    }
    return (
      <div className={`thumb-strip thumb-strip-placeholder ${compact ? 'thumb-strip-compact' : ''}`}>
        <div className="thumb-placeholder-pulse" />
      </div>
    );
  }

  const { cols, rows } = calcThumbGrid(thumbnails.length);

  return (
    <div 
      className={`thumb-strip ${compact ? 'thumb-strip-compact' : ''}`}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
    >
      {thumbnails.map((thumb, i) => (
        <FadingThumbImage
          key={thumb}
          src={`thumb://local/${encodeURIComponent(thumb)}`}
          alt={`Frame ${i + 1}`}
        />
      ))}
    </div>
  );
}

function FadingThumbImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [src]);

  return (
    <img
      ref={imageRef}
      className={`thumb-img ${loaded ? 'thumb-img-loaded' : ''}`}
      src={src}
      decoding="async"
      alt={alt}
      draggable={false}
      onLoad={() => setLoaded(true)}
    />
  );
}
