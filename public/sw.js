self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("ai-chat-shell-v4").then((cache) =>
      cache.addAll([
        "/",
        "/app-icon.svg",
        "/manifest.webmanifest",
        "/provider-icons/qwen.ico",
        "/provider-icons/glm.svg",
        "/provider-icons/kimi.ico",
        "/provider-icons/deepseek.ico",
      ])
    )
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((res) => res || caches.match("/")))
  );
});
