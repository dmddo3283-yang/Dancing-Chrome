(() => {
  if (window.__dancingChromeSpinner) return;
  window.__dancingChromeSpinner = true;

  const root = document.documentElement;
  const previous = {
    transform: root.style.transform,
    transformOrigin: root.style.transformOrigin,
    transition: root.style.transition,
    overflow: root.style.overflow
  };

  function restore() {
    root.style.transform = previous.transform;
    root.style.transformOrigin = previous.transformOrigin;
    root.style.transition = previous.transition;
    root.style.overflow = previous.overflow;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === "ROTATE") {
      const rad = (message.angle * Math.PI) / 180;
      // 회전해도 모서리에 빈 공간이 생기지 않도록 화면을 덮을 만큼 살짝 키운다.
      const cover = Math.abs(Math.sin(rad)) + Math.abs(Math.cos(rad));
      root.style.transformOrigin = "50% 50%";
      root.style.transition = "transform 60ms linear";
      root.style.overflow = "hidden";
      root.style.transform = `rotate(${message.angle}deg) scale(${cover.toFixed(3)})`;
    } else if (message.type === "ROTATE_STOP") {
      restore();
    }
  });
})();
