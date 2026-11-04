// Vite dispatches this when a lazy route or one of its dependencies fails.
// Retry once per minute so a real network outage cannot cause a reload loop.
window.addEventListener("vite:preloadError", (event) => {
  const key = "app:chunk-recovery";
  try {
    const lastReload = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - lastReload < 60_000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // Without storage we cannot safely guard against repeated reloads.
    return;
  }
  event.preventDefault();
  window.location.reload();
});
