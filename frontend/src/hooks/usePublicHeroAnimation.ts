import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useLayoutEffect, type RefObject } from "react";

gsap.registerPlugin(ScrollTrigger);

export function usePublicHeroAnimation(
  heroRef: RefObject<HTMLElement>,
  animationKey?: unknown,
  scrollerRef?: RefObject<HTMLElement>
) {
  useLayoutEffect(() => {
    const hero = heroRef.current;
    if (!hero) return undefined;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return undefined;

    const context = gsap.context(() => {
      const heroCopy = hero.querySelector<HTMLElement>(".hero-copy, .detail-hero-copy");
      const heroTitle = heroCopy?.querySelector<HTMLElement>("h1");
      const heroDescription = heroCopy?.querySelector<HTMLElement>(".hero-description, .staggered-lead");
      const heroActions = heroCopy?.querySelector<HTMLElement>(".hero-actions, .detail-actions");

      if (heroTitle && heroDescription && heroActions) {
        gsap.timeline()
          .fromTo(
            heroTitle,
            { autoAlpha: 0, y: 60 },
            { autoAlpha: 1, y: 0, duration: 1, delay: 0.2, ease: "power3.out" }
          )
          .fromTo(
            heroDescription,
            { autoAlpha: 0, y: 30 },
            { autoAlpha: 1, y: 0, duration: 0.8, ease: "power2.out" },
            "-=0.4"
          )
          .fromTo(
            heroActions,
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: 0.8, ease: "power2.out" },
            "-=0.25"
          );
      }

      if (heroCopy) {
        const scrollerCandidate = scrollerRef?.current;
        const scroller = scrollerCandidate && !["visible", "clip"].includes(getComputedStyle(scrollerCandidate).overflowY)
          ? scrollerCandidate
          : undefined;
        gsap.to(heroCopy, {
          y: -150,
          autoAlpha: 0,
          ease: "none",
          scrollTrigger: {
            ...(scroller ? { scroller } : {}),
            trigger: hero,
            start: "top top",
            end: "50% top",
            scrub: true
          }
        });
      }
    }, hero);

    const refreshOnLoad = () => ScrollTrigger.refresh();
    window.addEventListener("load", refreshOnLoad, { once: true });
    const refreshFrame = window.requestAnimationFrame(refreshOnLoad);

    return () => {
      window.removeEventListener("load", refreshOnLoad);
      window.cancelAnimationFrame(refreshFrame);
      context.revert();
    };
  }, [animationKey, heroRef, scrollerRef]);
}
