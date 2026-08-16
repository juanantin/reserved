export function VideoBanner() {
  return (
    <div className="relative w-full overflow-hidden border-t border-white/10">
      <video
        className="block h-auto w-full"
        src="/images/reserve_banner_video.mp4"
        autoPlay
        loop
        muted
        playsInline
      />
    </div>
  );
}
