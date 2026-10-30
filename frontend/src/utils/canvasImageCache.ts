// Keep only the current photo and its neighbours decoded, rather than every
// full-resolution image in the task. The cache belongs to one workbench.
export function createCanvasImageCache(limit = 3) {
  const entries = new Map<string, Promise<HTMLImageElement>>();

  return {
    load(src: string): Promise<HTMLImageElement> {
      const cached = entries.get(src);
      if (cached) {
        entries.delete(src);
        entries.set(src, cached);
        return cached;
      }
      const pending = new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new window.Image();
        image.decoding = "async";
        image.onload = async () => {
          // Decode before the canvas uses the photo, off the interaction path.
          await image.decode().catch(() => undefined);
          resolve(image);
        };
        image.onerror = () => reject(new Error("图片加载失败"));
        image.src = src;
      });
      entries.set(src, pending);
      while (entries.size > limit) entries.delete(entries.keys().next().value!);
      void pending.catch(() => {
        if (entries.get(src) === pending) entries.delete(src);
      });
      return pending;
    }
  };
}

export type CanvasImageCache = ReturnType<typeof createCanvasImageCache>;
