// X ViewLess OpenAI Helper - Calls OpenAI Responses API via fetch.

// Default values matching options.js.
const OPENAI_DEFAULTS = {
  model: "gpt-4o",
  systemInstruction: `You write replies for X. Output exactly one reply. No quotes around the reply. No hashtags unless the user explicitly asks. Do not include links unless the user explicitly asks. Match the requested tone. Be concise and natural. Respect the character limit when provided.`,
  temperature: 0.7,
  maxOutputTokens: 120,
  characterLimit: 280,
  defaultTone: "Neutral",
  defaultReplyStyle: "Short",
};

/**
 * Generate a reply using OpenAI Responses API.
 * @param {object} params - Generation parameters.
 * @param {string} params.postText - The text of the post being replied to.
 * @param {string} [params.commentText] - The text of the specific comment if present.
 * @param {string} [params.tone] - Tone override (Neutral, Friendly, Dry Sarcastic).
 * @param {string} [params.replyStyle] - Reply style override (Short, Medium, Spicy).
 * @param {boolean} [params.allowLonger] - If true, skip character limit enforcement.
 * @returns {Promise<{ok: boolean, text?: string, error?: string}>}
 */
async function generateReply(params) {
  try {
    // Load settings from storage.
    const settings = await chrome.storage.sync.get({
      apiKey: "",
      model: OPENAI_DEFAULTS.model,
      systemInstruction: OPENAI_DEFAULTS.systemInstruction,
      personalContext: "",
      temperature: OPENAI_DEFAULTS.temperature,
      maxOutputTokens: OPENAI_DEFAULTS.maxOutputTokens,
      characterLimit: OPENAI_DEFAULTS.characterLimit,
      defaultTone: OPENAI_DEFAULTS.defaultTone,
      defaultReplyStyle: OPENAI_DEFAULTS.defaultReplyStyle,
    });

    // Validate API key.
    if (!settings.apiKey) {
      return { ok: false, error: "missing_key" };
    }

    // Determine final values with modal overrides.
    const tone = params.tone || settings.defaultTone;
    const replyStyle = params.replyStyle || settings.defaultReplyStyle;
    const charLimit = params.allowLonger ? null : settings.characterLimit;

    // Build user message.
    const userMessage = buildUserMessage({
      personalContext: settings.personalContext,
      tone,
      replyStyle,
      charLimit,
      postText: params.postText,
      commentText: params.commentText,
      username: params.username,
      displayName: params.displayName,
    });

    // Prepare API request for chat completions.
    const requestBody = {
      model: settings.model,
      temperature: settings.temperature,
      max_tokens: settings.maxOutputTokens,
      messages: [
        { role: "system", content: settings.systemInstruction },
        { role: "user", content: userMessage },
      ],
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message = errorData.error?.message || `HTTP ${response.status}`;
      return { ok: false, error: message };
    }

    const data = await response.json();

    // Extract content from chat completions response.
    let outputText = data.choices?.[0]?.message?.content || "";

    // Apply quality safeguards.
    outputText = cleanOutput(outputText, charLimit);

    return { ok: true, text: outputText };
  } catch (error) {
    console.error("X ViewLess: OpenAI request failed:", error);
    return { ok: false, error: error.message || "Network error" };
  }
}

/**
 * Build the user message for the prompt.
 */
function buildUserMessage({
  personalContext,
  tone,
  replyStyle,
  charLimit,
  postText,
  commentText,
  username,
  displayName,
}) {
  const parts = [];

  if (personalContext) {
    parts.push(`[Personal context]\n${personalContext}`);
  }

  // Explicitly include author information if available - make it VERY prominent.
  if (username) {
    if (displayName) {
      parts.push(
        `[IMPORTANT: Author Information]\nYou are replying to a post from:\nUsername: ${username}\nDisplay name: ${displayName}\n\nCheck your system instructions for any special rules that apply ONLY to replies to ${username}.`
      );
    } else {
      parts.push(
        `[IMPORTANT: Author Information]\nYou are replying to a post from:\nUsername: ${username}\n\nCheck your system instructions for any special rules that apply ONLY to replies to ${username}.`
      );
    }
  }

  parts.push(`[Tone]\n${tone}`);
  parts.push(`[Reply style]\n${replyStyle}`);

  if (charLimit) {
    parts.push(`[Character limit]\n${charLimit} characters maximum`);
  }

  if (postText) {
    parts.push(`[Post being replied to]\n${postText}`);
  }

  if (commentText) {
    parts.push(`[Specific comment being replied to]\n${commentText}`);
  }

  parts.push(
    `[Instruction]\nWrite exactly one reply. No alternatives, no bullet points, no numbering.`
  );

  return parts.join("\n\n");
}

/**
 * Clean and post-process the AI output.
 */
function cleanOutput(text, charLimit) {
  // Trim whitespace.
  text = text.trim();

  // Strip leading/trailing quotes.
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }

  // Remove obvious multi-option formatting (lines starting with numbers or bullets).
  const lines = text.split("\n");
  if (lines.length > 1) {
    // Check if it looks like a list.
    const listPattern = /^(\d+[\.\):]|\-|\*|\•)/;
    const isMultiOption = lines.every(
      (line) => !line.trim() || listPattern.test(line.trim())
    );
    if (isMultiOption) {
      // Take just the first option.
      const firstOption = lines.find(
        (line) => line.trim() && listPattern.test(line.trim())
      );
      if (firstOption) {
        text = firstOption.replace(listPattern, "").trim();
      }
    }
  }

  // Enforce character limit if set.
  if (charLimit && text.length > charLimit) {
    text = truncateAtWordBoundary(text, charLimit);
  }

  return text;
}

/**
 * Truncate text at a word boundary and add ellipsis if needed.
 */
function truncateAtWordBoundary(text, limit) {
  if (text.length <= limit) {
    return text;
  }

  // Reserve space for ellipsis.
  const maxLen = limit - 1;
  let truncated = text.slice(0, maxLen);

  // Find last space to break at word boundary.
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.5) {
    truncated = truncated.slice(0, lastSpace);
  }

  return truncated.trim() + "…";
}

// Expose globally for content script.
window.XViewLessOpenAI = { generateReply };
