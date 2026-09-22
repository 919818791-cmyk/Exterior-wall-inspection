import { useRef, useState } from "react";

const defaultHeroVideos = ["/videos/N1.mp4", "/videos/N2.mp4", "/videos/N3.mp4"];

type NetworkInformation = {
  effectiveType?: string;
  saveData?: boolean;
};

export function HeroVideoPlaylist({ videos = defaultHeroVideos }: { videos?: readonly string[] }) {
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);

  const prepareNextVideo = (currentIndex: number) => {
    const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
    const shouldLimitPreload = connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "");
    const nextVideo = videoRefs.current[(currentIndex + 1) % videos.length];

    if (!nextVideo || nextVideo.preload !== "none") return;
    nextVideo.preload = shouldLimitPreload ? "metadata" : "auto";
    nextVideo.load();
  };

  const playNextVideo = (currentIndex: number) => {
    if (currentIndex !== activeVideoIndex) return;

    const nextIndex = (currentIndex + 1) % videos.length;
    const nextVideo = videoRefs.current[nextIndex];
    if (!nextVideo) {
      setActiveVideoIndex(nextIndex);
      return;
    }

    if (nextVideo.ended) nextVideo.currentTime = 0;
    const activateNextVideo = () => {
      setActiveVideoIndex(nextIndex);
      prepareNextVideo(nextIndex);
    };
    void nextVideo.play().then(activateNextVideo, activateNextVideo);
  };

  return videos.map((video, index) => (
    <video
      key={video}
      ref={(element) => { videoRefs.current[index] = element; }}
      className={`hero-background-video${index === activeVideoIndex ? " is-active" : ""}`}
      autoPlay={index === 0}
      loop={videos.length === 1}
      muted
      playsInline
      preload={index === 0 ? "auto" : "none"}
      aria-hidden="true"
      onEnded={videos.length > 1 ? () => playNextVideo(index) : undefined}
      onPlaying={() => {
        if (videos.length > 1 && index === activeVideoIndex) prepareNextVideo(index);
      }}
    >
      <source src={video} type="video/mp4" />
    </video>
  ));
}
