"use client";

import { useEffect, useRef } from "react";

export function VideoBanner() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Mobile browsers (iOS Safari in particular) sometimes ignore the muted/autoPlay
    // JSX attributes and show a tap-to-play button instead of autoplaying. Setting
    // muted as a JS property before calling play() explicitly is what actually works.
    video.muted = true;
    video.play().catch(() => {});
  }, []);

  return (
    <div className="relative w-full overflow-hidden border-t border-white/10">
      <video
        ref={videoRef}
        className="block h-auto w-full"
        src="/images/reserve_banner_video.mp4"
        autoPlay
        loop
        muted
        playsInline
        controls={false}
        preload="auto"
      />
    </div>
  );
}
