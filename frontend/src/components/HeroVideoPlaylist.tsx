import { useRef, useState } from "react";

const version = import.meta.env.VITE_HERO_MEDIA_VERSION;
const videos = ["/videos/N1-hero.mp4", "/videos/N2-hero.mp4"].map(path => `${path}?v=${version}`);
const poster = `/images/optimized/hero-poster.webp?v=${version}`;

type NetworkInformation = {
  effectiveType?: string;
  saveData?: boolean;
};

export function HeroVideoPlaylist() {
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  // Keep the poster visible until a video has actually started playing.
  const [activeVideoIndex, setActiveVideoIndex] = useState<number | null>(null);

  const prepareNextVideo = (currentIndex: number) => {
    const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
    const shouldLimitPreload = connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "");
    const nextVideo = videoRefs.current[(currentIndex + 1) % videos.length];

    if (shouldLimitPreload || !nextVideo || nextVideo.preload !== "none") return;
    nextVideo.preload = "auto";
    nextVideo.load();
  };

  const playNextVideo = (currentIndex: number) => {
    if (currentIndex !== activeVideoIndex) return;

    const nextIndex = (currentIndex + 1) % videos.length;
    const nextVideo = videoRefs.current[nextIndex];
    if (!nextVideo) return;

    if (nextVideo.ended) nextVideo.currentTime = 0;
    // onPlaying activates the next layer. If playback fails or is still
    // buffering, retain the current frame instead of revealing an empty video.
    void nextVideo.play().catch(() => {});
  };

  return (
    <>
      <img
        className="hero-background-poster"
        src={poster}
        width={1600}
        height={900}
        alt=""
        aria-hidden="true"
        loading="eager"
        decoding="async"
        fetchPriority="high"
      />
      {videos.map((video, index) => (
        <video
          key={video}
          src={video}
          poster={poster}
          ref={(element) => { videoRefs.current[index] = element; }}
          className={`hero-background-video${index === activeVideoIndex ? " is-active" : ""}`}
          autoPlay={index === 0}
          loop={videos.length === 1}
          muted
          playsInline
          preload={index === 0 ? "auto" : "none"}
          aria-hidden="true"
          onEnded={videos.length > 1 ? () => playNextVideo(index) : undefined}
          onCanPlay={(event) => {
            // Native autoplay can wait for a full-playthrough buffer on slow
            // networks. Start as soon as there are frames available instead.
            if (index === 0 && activeVideoIndex === null) {
              void event.currentTarget.play().catch(() => {});
            }
          }}
          onPlaying={() => setActiveVideoIndex(index)}
          onError={() => setActiveVideoIndex((current) => current === index ? null : current)}
          onTimeUpdate={(event) => {
            const currentVideo = event.currentTarget;
            // Let the first video establish its buffer before using bandwidth for
            // the next clip. Slow connections fetch it only when playback is due.
            if (index === activeVideoIndex && currentVideo.duration - currentVideo.currentTime <= 4) {
              prepareNextVideo(index);
            }
          }}
        />
      ))}
    </>
  );
}
