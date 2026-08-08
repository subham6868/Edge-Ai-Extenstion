// content.js - Extracts page text for analysis
(function() {
  // Avoid duplicate listeners
  if (window.__edgeEyeLoaded) return;
  window.__edgeEyeLoaded = true;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getPageText") {
      try {
        const bodyText = document.body.innerText || document.body.textContent || "";
        const trimmed = bodyText.replace(/\s+/g, " ").trim().slice(0, 8000);
        sendResponse({ text: trimmed, url: window.location.href, title: document.title });
      } catch (e) {
        sendResponse({ text: "", url: window.location.href, title: "" });
      }
    }
    return true;
  });
})();
