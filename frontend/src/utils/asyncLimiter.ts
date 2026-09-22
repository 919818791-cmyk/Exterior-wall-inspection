export function createAsyncLimiter(maxConcurrency: number) {
  const limit = Math.max(1, Math.floor(maxConcurrency));
  const queue: Array<() => void> = [];
  let activeCount = 0;

  const acquire = () => new Promise<void>((resolve) => {
    if (activeCount < limit) {
      activeCount += 1;
      resolve();
      return;
    }
    queue.push(resolve);
  });

  const release = () => {
    const next = queue.shift();
    if (next) {
      next();
      return;
    }
    activeCount = Math.max(0, activeCount - 1);
  };

  return async function runLimited<T>(task: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}
