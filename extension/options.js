// X ViewLess Options Page - Loads and saves settings to chrome.storage.sync.

const DEFAULT_SYSTEM_INSTRUCTION = `You write replies for X. Output exactly one reply. No quotes around the reply. No hashtags unless the user explicitly asks. Do not include links unless the user explicitly asks. Match the requested tone. Be concise and natural. Respect the character limit when provided.`;

const DEFAULTS = {
  apiKey: "",
  model: "gpt-4o",
  systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
  personalContext: "",
  defaultTone: "Neutral",
  defaultReplyStyle: "Short",
  temperature: 0.7,
  maxOutputTokens: 120,
  characterLimit: 280,
  hideViewCounts: false,
};

// Load settings on page open.
document.addEventListener("DOMContentLoaded", loadSettings);

// Handle form submission.
document
  .getElementById("settings-form")
  .addEventListener("submit", saveSettings);

async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get(DEFAULTS);

    document.getElementById("apiKey").value = stored.apiKey || "";
    document.getElementById("model").value = stored.model || DEFAULTS.model;
    document.getElementById("systemInstruction").value =
      stored.systemInstruction || DEFAULTS.systemInstruction;
    document.getElementById("personalContext").value =
      stored.personalContext || "";
    document.getElementById("defaultTone").value =
      stored.defaultTone || DEFAULTS.defaultTone;
    document.getElementById("defaultReplyStyle").value =
      stored.defaultReplyStyle || DEFAULTS.defaultReplyStyle;
    document.getElementById("temperature").value =
      stored.temperature ?? DEFAULTS.temperature;
    document.getElementById("maxOutputTokens").value =
      stored.maxOutputTokens ?? DEFAULTS.maxOutputTokens;
    document.getElementById("characterLimit").value =
      stored.characterLimit ?? DEFAULTS.characterLimit;
    document.getElementById("hideViewCounts").checked =
      stored.hideViewCounts ?? DEFAULTS.hideViewCounts;
  } catch (error) {
    console.error("X ViewLess: Failed to load settings:", error);
  }
}

async function saveSettings(event) {
  event.preventDefault();

  const statusEl = document.getElementById("status");

  // Gather values from form.
  const settings = {
    apiKey: document.getElementById("apiKey").value.trim(),
    model: document.getElementById("model").value.trim() || DEFAULTS.model,
    systemInstruction:
      document.getElementById("systemInstruction").value.trim() ||
      DEFAULTS.systemInstruction,
    personalContext: document.getElementById("personalContext").value.trim(),
    defaultTone: document.getElementById("defaultTone").value,
    defaultReplyStyle: document.getElementById("defaultReplyStyle").value,
    temperature: clamp(
      parseFloat(document.getElementById("temperature").value) ||
        DEFAULTS.temperature,
      0,
      2
    ),
    maxOutputTokens: Math.max(
      10,
      parseInt(document.getElementById("maxOutputTokens").value, 10) ||
        DEFAULTS.maxOutputTokens
    ),
    characterLimit: Math.max(
      50,
      parseInt(document.getElementById("characterLimit").value, 10) ||
        DEFAULTS.characterLimit
    ),
    hideViewCounts: document.getElementById("hideViewCounts").checked,
  };

  try {
    await chrome.storage.sync.set(settings);
    showStatus(statusEl, "Saved!", false);
  } catch (error) {
    console.error("X ViewLess: Failed to save settings:", error);
    showStatus(statusEl, "Error saving settings", true);
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function showStatus(el, message, isError) {
  el.textContent = message;
  el.classList.remove("error");
  if (isError) {
    el.classList.add("error");
  }
  el.classList.add("visible");

  // Hide after 2 seconds.
  setTimeout(() => {
    el.classList.remove("visible");
  }, 2000);
}
