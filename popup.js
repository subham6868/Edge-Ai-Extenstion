// ⚠️ SECURITY NOTE: Your previous API key was removed for safety.
// Paste your new key below, but consider moving this to chrome.storage for a production extension.
const GEMINI_API_KEY = "Paste Your API key here"; 

function isLegalPage(text, url) {
  const legalKeywords = [
    "terms of service", "terms of use", "terms and conditions",
    "privacy policy", "user agreement", "end user license",
    "cookie policy", "legal notice", "disclaimer", "refund policy",
    "acceptable use", "community guidelines"
  ];
  const combined = (text + " " + url).toLowerCase();
  return legalKeywords.some(kw => combined.includes(kw));
}

async function analyzeWithGemini(pageText, siteUrl, retryCount = 0) {
  const prompt = `You are a legal document analyst. Analyze the following Terms of Service / Privacy Policy text from "${siteUrl}" and respond ONLY with a valid JSON object. No preamble, no markdown, no explanation — just raw JSON.

JSON format:
{
  "findings": [
    { "type": "critical", "label": "SHORT LABEL", "detail": "one sentence explanation" },
    { "type": "warning", "label": "SHORT LABEL", "detail": "one sentence explanation" },
    { "type": "safe", "label": "SHORT LABEL", "detail": "one sentence explanation" }
  ],
  "summary": ["Plain English bullet 1", "Plain English bullet 2", "Plain English bullet 3"],
  "emailDraft": "A short firm email to the company asking them to clarify or remove concerning clauses."
}

Rules:
- Include 1-3 findings per type, only if genuinely found in the text.
- If no critical issues found, omit critical findings entirely.
- Keep labels short (3-5 words max). Detail = one clear sentence.
- Summary: 2-4 plain English bullets a non-lawyer can understand.
- emailDraft: 3-5 sentences, professional but assertive.

Legal text (from ${siteUrl}):
---
${pageText.slice(0, 6000)}
---`;

  // FIX 1: Updated the API endpoint to use gemini-2.5-flash
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // FIX 2: Increased maxOutputTokens to 4000 to give the model room to finish the JSON summary
        generationConfig: { maxOutputTokens: 4000, temperature: 0.2 }
      })
    }
  );

  // Handle rate limit with auto-retry
  if (response.status === 429) {
    if (retryCount < 3) {
      const waitSeconds = (retryCount + 1) * 15;
      document.getElementById("btnText").textContent = `Rate limited — retrying in ${waitSeconds}s...`;
      await new Promise(r => setTimeout(r, waitSeconds * 1000));
      return analyzeWithGemini(pageText, siteUrl, retryCount + 1);
    }
    throw new Error("Too many requests. Please wait 1 minute and try again.");
  }

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err?.error?.message || "Gemini API request failed");
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned);
}

function renderFindings(findings) {
  const list = document.getElementById("findingsList");
  list.innerHTML = "";
  if (!findings || findings.length === 0) {
    list.innerHTML = `<p style="font-size:12px;color:#64748b;">No significant findings.</p>`;
    return;
  }
  findings.forEach(f => {
    const div = document.createElement("div");
    div.className = `finding ${f.type}`;
    div.innerHTML = `<div class="finding-label">${f.type.toUpperCase()}: ${f.label}</div><div>${f.detail}</div>`;
    list.appendChild(div);
  });
}

function renderSummary(summary) {
  const ul = document.getElementById("summaryList");
  ul.innerHTML = "";
  (summary || []).forEach(item => {
    const li = document.createElement("li");
    li.textContent = item;
    ul.appendChild(li);
  });
}

async function getPageText(tab) {
  const tryMessage = () => new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { action: "getPageText" }, (res) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(res);
    });
  });

  let result = await tryMessage();
  if (result) return result;

  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  await new Promise(r => setTimeout(r, 500));
  result = await tryMessage();

  if (!result) throw new Error("Cannot read this page. Please refresh (Ctrl+R) and try again.");
  return result;
}

// ---- Main ----
document.addEventListener("DOMContentLoaded", async () => {
  const analyzeBtn   = document.getElementById("analyzeBtn");
  const btnText      = document.getElementById("btnText");
  const spinner      = document.getElementById("spinner");
  const results      = document.getElementById("results");
  const errorBox     = document.getElementById("errorBox");
  const notLegalPage = document.getElementById("notLegalPage");
  const siteBar      = document.getElementById("siteBar");
  const emailBtn     = document.getElementById("emailBtn");
  let emailDraftText = "";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentUrl = tab?.url || "";
  const domain = currentUrl ? new URL(currentUrl).hostname : "Unknown site";
  siteBar.innerHTML = `Viewing: <span>${domain}</span>`;

  analyzeBtn.addEventListener("click", async () => {
    results.classList.remove("visible");
    errorBox.classList.remove("visible");
    notLegalPage.classList.remove("visible");
    analyzeBtn.disabled = true;
    spinner.style.display = "block";
    btnText.textContent = "Analyzing...";

    try {
      const pageData = await getPageText(tab);
      if (!pageData?.text || pageData.text.length < 100)
        throw new Error("Not enough text found on this page.");

      if (!isLegalPage(pageData.text, currentUrl)) {
        notLegalPage.classList.add("visible");
        return;
      }

      const analysis = await analyzeWithGemini(pageData.text, currentUrl);
      renderFindings(analysis.findings);
      renderSummary(analysis.summary);
      emailDraftText = analysis.emailDraft || "";
      results.classList.add("visible");

    } catch (err) {
      console.error(err);
      errorBox.textContent = `Error: ${err.message}`;
      errorBox.classList.add("visible");
    } finally {
      analyzeBtn.disabled = false;
      spinner.style.display = "none";
      btnText.textContent = "Analyze Legal Text";
    }
  });

  emailBtn.addEventListener("click", () => {
    if (!emailDraftText) return;
    const subject = encodeURIComponent(`Concerns about your Terms of Service - ${domain}`);
    const body = encodeURIComponent(emailDraftText);
    window.open(`mailto:?subject=${subject}&body=${body}`);
  });
});