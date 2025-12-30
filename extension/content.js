// X ViewLess Content Script - Injects AI Reply button and handles modal interaction.

(function () {
  "use strict";

  // Inject styles once.
  injectStyles();

  // Track the active composer for insertion.
  let activeComposer = null;

  // Start observing for reply composers.
  const observer = new MutationObserver(debounce(scanForComposers, 100));
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial scan.
  scanForComposers();

  // Also scan after a short delay (X loads content dynamically).
  setTimeout(scanForComposers, 1000);
  setTimeout(scanForComposers, 3000);

  // Handle view count hiding for own posts - start immediately.
  initViewCountHiding();

  // Handle follower count hiding - start immediately.
  initFollowerCountHiding();

  /**
   * Scan the DOM for reply composers and inject buttons.
   */
  async function scanForComposers() {
    // Check if AI Reply button is enabled.
    const settings = await chrome.storage.sync.get({
      showAIReplyButton: false,
    });
    if (!settings.showAIReplyButton) {
      // Remove any existing buttons if setting is disabled.
      const existingButtons = document.querySelectorAll(".xviewless-btn");
      existingButtons.forEach((btn) => btn.remove());
      // Remove markers so buttons can be re-added if setting is re-enabled.
      const markedComposers = document.querySelectorAll(
        '[data-xviewless-injected="true"]'
      );
      markedComposers.forEach((composer) =>
        composer.removeAttribute("data-xviewless-injected")
      );
      return;
    }

    // Look for contenteditable textboxes used as composers.
    const composers = document.querySelectorAll(
      '[role="textbox"][contenteditable="true"]'
    );

    composers.forEach((composer, index) => {
      // Skip if this specific composer already has our button nearby.
      if (composer.hasAttribute("data-xviewless-injected")) return;

      // Find the composer's container (usually a few levels up).
      const container = findComposerContainer(composer);
      if (!container) return;

      // Find a suitable place to inject the button (near the action toolbar).
      const toolbar = findToolbar(container);
      if (!toolbar) return;

      // Check if button already exists in this toolbar.
      const existingButton = toolbar.querySelector(".xviewless-btn");
      if (existingButton) {
        // If button exists but composer isn't marked, mark it now.
        if (!composer.hasAttribute("data-xviewless-injected")) {
          composer.setAttribute("data-xviewless-injected", "true");
        }
        // If button is currently generating, don't interfere.
        if (existingButton.dataset.generating === "true") {
          return;
        }
        return;
      }

      // Mark composer as processed.
      composer.setAttribute("data-xviewless-injected", "true");

      // Create and inject the AI Reply button.
      const button = createAIReplyButton(composer, container);

      // Insert before the Reply button if possible, otherwise append.
      const replyBtn =
        toolbar.querySelector('button[data-testid="tweetButton"]') ||
        toolbar.querySelector('button[data-testid="tweetButtonInline"]');

      if (replyBtn && replyBtn.parentElement) {
        // Store reference to the reply button's parent for re-positioning.
        button.dataset.replyButtonParent = "true";
        replyBtn.parentElement.insertBefore(button, replyBtn);
      } else {
        toolbar.appendChild(button);
      }

      // Set up a watcher to maintain button position if toolbar changes.
      setupButtonPositionWatcher(button, toolbar, replyBtn);

      // Also re-position when composer is focused (common trigger for layout changes).
      composer.addEventListener(
        "focus",
        () => {
          setTimeout(() => {
            if (button.isConnected && !button.dataset.generating) {
              const currentReplyBtn =
                toolbar.querySelector('button[data-testid="tweetButton"]') ||
                toolbar.querySelector(
                  'button[data-testid="tweetButtonInline"]'
                );
              if (currentReplyBtn && currentReplyBtn.parentElement) {
                const buttonParent = button.parentElement;
                const replyParent = currentReplyBtn.parentElement;
                if (
                  buttonParent !== replyParent ||
                  Array.from(replyParent.children).indexOf(button) >=
                    Array.from(replyParent.children).indexOf(currentReplyBtn)
                ) {
                  currentReplyBtn.parentElement.insertBefore(
                    button,
                    currentReplyBtn
                  );
                }
              }
            }
          }, 50);
        },
        { passive: true }
      );
    });
  }

  /**
   * Find the composer's parent container.
   */
  function findComposerContainer(composer) {
    // Walk up to find a reasonable container — look for the modal or main composer wrapper.
    let el = composer;
    for (let i = 0; i < 15; i++) {
      el = el.parentElement;
      if (!el) return null;

      // Stop at known container patterns.
      if (
        el.matches('[data-testid="tweetTextarea_0_label"]') ||
        el.matches('[data-testid="toolBar"]')?.parentElement ||
        el.matches('[aria-labelledby*="modal"]') ||
        el.matches('[role="dialog"]') ||
        el.matches('div[class*="DraftEditor"]')
      ) {
        return el;
      }

      // Check if this element contains both the composer and a toolbar-like area.
      const hasToolbar =
        el.querySelector('[data-testid="toolBar"]') ||
        el.querySelector('button[data-testid="tweetButton"]') ||
        el.querySelector('button[data-testid="tweetButtonInline"]');
      if (hasToolbar) {
        return el;
      }
    }

    // Fallback: go up 8 levels from composer.
    el = composer;
    for (let i = 0; i < 8; i++) {
      if (el.parentElement) el = el.parentElement;
    }
    return el;
  }

  /**
   * Set up a watcher to maintain button position when toolbar changes.
   */
  function setupButtonPositionWatcher(button, toolbar, replyBtn) {
    // Only watch if we have a reply button reference.
    if (!replyBtn || !replyBtn.parentElement) return;

    let repositionTimeout = null;

    // Debounced reposition function.
    const repositionButton = () => {
      if (repositionTimeout) clearTimeout(repositionTimeout);
      repositionTimeout = setTimeout(() => {
        // Check if button is still in the correct position.
        if (!button.isConnected) return;

        // If button is generating, don't move it.
        if (button.dataset.generating === "true") return;

        // Check if button is still a sibling of the reply button.
        const currentReplyBtn =
          toolbar.querySelector('button[data-testid="tweetButton"]') ||
          toolbar.querySelector('button[data-testid="tweetButtonInline"]');

        if (currentReplyBtn && currentReplyBtn.parentElement) {
          const buttonParent = button.parentElement;
          const replyParent = currentReplyBtn.parentElement;

          // If button is not in the same parent as reply button, re-position it.
          if (buttonParent !== replyParent) {
            console.log("[X ViewLess] Button moved, re-positioning...");
            currentReplyBtn.parentElement.insertBefore(button, currentReplyBtn);
          } else {
            // Check if button is still positioned before reply button.
            const siblings = Array.from(replyParent.children);
            const buttonIndex = siblings.indexOf(button);
            const replyIndex = siblings.indexOf(currentReplyBtn);

            if (
              buttonIndex !== -1 &&
              replyIndex !== -1 &&
              buttonIndex >= replyIndex
            ) {
              console.log(
                "[X ViewLess] Button order changed, re-positioning..."
              );
              currentReplyBtn.parentElement.insertBefore(
                button,
                currentReplyBtn
              );
            }
          }
        }
      }, 100); // Debounce by 100ms.
    };

    // Create a MutationObserver to watch for changes in the toolbar.
    const watcher = new MutationObserver((mutations) => {
      repositionButton();
    });

    // Watch for child list changes in the toolbar.
    watcher.observe(toolbar, { childList: true, subtree: true });

    // Also watch the reply button's parent if different.
    if (replyBtn.parentElement && replyBtn.parentElement !== toolbar) {
      watcher.observe(replyBtn.parentElement, { childList: true });
    }

    // Store watcher on button so we can disconnect it later if needed.
    button._xviewlessWatcher = watcher;
  }

  /**
   * Find the toolbar area within the composer container or nearby.
   */
  function findToolbar(container) {
    // First, look for the row containing the Reply/Post button.
    const replyButton =
      container.querySelector('button[data-testid="tweetButton"]') ||
      container.querySelector('button[data-testid="tweetButtonInline"]') ||
      container.querySelector('button[data-testid="replyButton"]');

    if (replyButton) {
      return replyButton.parentElement;
    }

    // Look for the toolBar testid.
    const toolBar = container.querySelector('[data-testid="toolBar"]');
    if (toolBar) {
      return toolBar.parentElement || toolBar;
    }

    // Look for the bottom action row (contains media buttons + reply button).
    const allButtons = container.querySelectorAll(
      'button[role="button"], button'
    );
    for (const btn of allButtons) {
      const parent = btn.parentElement;
      if (parent && parent.children.length >= 3) {
        return parent;
      }
    }

    // Fallback: find any div with role="group".
    const group = container.querySelector('[role="group"]');
    if (group) return group;

    // Last resort: search the entire document for the reply button.
    const globalReplyBtn =
      document.querySelector('button[data-testid="tweetButton"]') ||
      document.querySelector('button[data-testid="tweetButtonInline"]');
    if (globalReplyBtn) {
      return globalReplyBtn.parentElement;
    }

    return null;
  }

  /**
   * Create the AI Reply button element.
   */
  function createAIReplyButton(composer, container) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "xviewless-btn";
    button.textContent = "AI Reply";
    button.title = "Generate an AI reply and insert directly";

    // Track if this is the first generation.
    let isFirstGeneration = true;

    // Use click with capture to catch the event early, and add a small delay to let X's UI settle.
    button.addEventListener(
      "click",
      async (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        console.log(
          "[X ViewLess] Button clicked, generating:",
          button.dataset.generating
        );

        // Prevent double clicks while generating.
        if (button.dataset.generating === "true") {
          console.log("[X ViewLess] Already generating, skipping");
          return;
        }

        // Store references before DOM might change.
        const buttonRef = button;
        const containerRef = container;
        const composerRef = composer;

        // Show loading state immediately to give visual feedback.
        buttonRef.dataset.generating = "true";
        buttonRef.disabled = true;
        buttonRef.textContent = "⏳ Generating...";
        buttonRef.style.opacity = "0.7";

        // Small delay to let X's UI finish any layout updates after the click.
        await sleep(50);

        // Double-check the button is still valid after the delay.
        if (!buttonRef.isConnected) {
          console.log("[X ViewLess] Button disconnected after delay, aborting");
          return;
        }

        console.log("[X ViewLess] Starting generation...");

        try {
          // Extract context using stored container reference.
          const context = extractContext(containerRef);
          console.log(
            "[X ViewLess] Context:",
            context.postText?.substring(0, 50)
          );

          // Load settings for defaults.
          const settings = await chrome.storage.sync.get({
            defaultTone: "Neutral",
            defaultReplyStyle: "Short",
          });
          console.log("[X ViewLess] Settings loaded, calling API...");

          // Generate reply.
          const result = await window.XViewLessOpenAI.generateReply({
            postText: context.postText,
            commentText: context.commentText,
            username: context.username,
            displayName: context.displayName,
            tone: settings.defaultTone,
            replyStyle: settings.defaultReplyStyle,
            allowLonger: false,
          });

          console.log(
            "[X ViewLess] API result:",
            result.ok,
            result.text?.substring(0, 50),
            result.error
          );

          if (result.ok && result.text) {
            // Find the current active composer (might have changed since button was created).
            const currentComposer =
              findActiveComposer(containerRef) || composerRef;
            console.log(
              "[X ViewLess] Using composer:",
              currentComposer,
              "isConnected:",
              currentComposer?.isConnected
            );

            // First time: try to insert directly. Subsequent times: use clipboard.
            if (isFirstGeneration) {
              insertIntoComposerDirect(currentComposer, result.text);
              isFirstGeneration = false;
              buttonRef.textContent = "✓ Done";
              setTimeout(() => {
                if (buttonRef.isConnected) {
                  buttonRef.textContent = "AI Reply";
                }
              }, 1000);
            } else {
              insertIntoComposer(currentComposer, result.text);
              buttonRef.textContent = "✓ Copied";
              setTimeout(() => {
                if (buttonRef.isConnected) {
                  buttonRef.textContent = "AI Reply";
                }
              }, 1000);
            }
          } else if (result.error === "missing_key") {
            alert(
              "X ViewLess: Please set your OpenAI API key in the extension settings."
            );
            const url = chrome.runtime.getURL("options.html");
            window.open(url, "_blank");
            if (buttonRef.isConnected) {
              buttonRef.textContent = "AI Reply";
            }
          } else {
            alert("X ViewLess Error: " + (result.error || "Generation failed"));
            if (buttonRef.isConnected) {
              buttonRef.textContent = "AI Reply";
            }
          }
        } catch (error) {
          console.error("[X ViewLess] Error:", error);
          alert("X ViewLess Error: " + error.message);
          if (buttonRef.isConnected) {
            buttonRef.textContent = "AI Reply";
          }
        } finally {
          console.log("[X ViewLess] Generation complete, resetting button");
          if (buttonRef.isConnected) {
            buttonRef.disabled = false;
            buttonRef.dataset.generating = "false";
            buttonRef.style.opacity = "1";
          }
        }
      },
      true
    ); // Use capture phase to catch event early.

    return button;
  }

  /**
   * Open the modal overlay.
   */
  async function openModal(composerContainer) {
    // Extract context before opening.
    const context = extractContext(composerContainer);

    // Load settings for defaults.
    const settings = await chrome.storage.sync.get({
      defaultTone: "Neutral",
      defaultReplyStyle: "Short",
    });

    // Create modal elements.
    const overlay = document.createElement("div");
    overlay.className = "xviewless-overlay";

    const modal = document.createElement("div");
    modal.className = "xviewless-modal";

    modal.innerHTML = `
      <div class="xviewless-header">
        <span class="xviewless-title">🌿 X ViewLess</span>
        <button type="button" class="xviewless-close" title="Close">&times;</button>
      </div>
      <div class="xviewless-body">
        <div class="xviewless-controls">
          <div class="xviewless-control-group">
            <label>Tone</label>
            <select class="xviewless-tone">
              <option value="Neutral">Neutral</option>
              <option value="Friendly">Friendly</option>
              <option value="Dry Sarcastic">Dry Sarcastic</option>
            </select>
          </div>
          <div class="xviewless-control-group">
            <label>Style</label>
            <select class="xviewless-style">
              <option value="Short">Short</option>
              <option value="Medium">Medium</option>
              <option value="Spicy">Spicy</option>
            </select>
          </div>
          <div class="xviewless-control-group xviewless-checkbox-group">
            <label>
              <input type="checkbox" class="xviewless-allow-longer">
              Allow longer
            </label>
          </div>
        </div>
        <textarea class="xviewless-textarea" placeholder="Generating reply..." readonly></textarea>
        <div class="xviewless-error" style="display:none;"></div>
      </div>
      <div class="xviewless-footer">
        <button type="button" class="xviewless-btn-secondary xviewless-regenerate" disabled>Regenerate</button>
        <button type="button" class="xviewless-btn-primary xviewless-insert" disabled>Insert into X</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Get references to elements.
    const closeBtn = modal.querySelector(".xviewless-close");
    const textarea = modal.querySelector(".xviewless-textarea");
    const errorDiv = modal.querySelector(".xviewless-error");
    const toneSelect = modal.querySelector(".xviewless-tone");
    const styleSelect = modal.querySelector(".xviewless-style");
    const allowLongerCheckbox = modal.querySelector(".xviewless-allow-longer");
    const regenerateBtn = modal.querySelector(".xviewless-regenerate");
    const insertBtn = modal.querySelector(".xviewless-insert");

    // Set defaults from settings.
    toneSelect.value = settings.defaultTone;
    styleSelect.value = settings.defaultReplyStyle;

    // Close handlers.
    const closeModal = () => {
      overlay.remove();
    };

    closeBtn.addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener("keydown", function escHandler(e) {
      if (e.key === "Escape") {
        closeModal();
        document.removeEventListener("keydown", escHandler);
      }
    });

    // Generation function.
    const generate = async () => {
      textarea.value = "";
      textarea.placeholder = "Generating reply...";
      textarea.readOnly = true;
      errorDiv.style.display = "none";
      regenerateBtn.disabled = true;
      insertBtn.disabled = true;

      const result = await window.XViewLessOpenAI.generateReply({
        postText: context.postText,
        commentText: context.commentText,
        tone: toneSelect.value,
        replyStyle: styleSelect.value,
        allowLonger: allowLongerCheckbox.checked,
      });

      if (result.ok) {
        textarea.value = result.text;
        textarea.placeholder = "";
        textarea.readOnly = false;
        regenerateBtn.disabled = false;
        insertBtn.disabled = false;
      } else {
        if (result.error === "missing_key") {
          showError(errorDiv, "API key not configured.", true);
        } else {
          showError(errorDiv, `Error: ${result.error}`, false);
        }
        textarea.placeholder = "Generation failed";
        regenerateBtn.disabled = false;
      }
    };

    // Regenerate handler.
    regenerateBtn.addEventListener("click", generate);

    // Insert handler.
    insertBtn.addEventListener("click", () => {
      const text = textarea.value.trim();
      if (text && activeComposer) {
        insertIntoComposer(activeComposer, text);
        closeModal();
      }
    });

    // Start initial generation.
    generate();
  }

  /**
   * Show an error message in the modal.
   */
  function showError(errorDiv, message, showSettingsButton) {
    errorDiv.innerHTML = "";
    errorDiv.style.display = "block";

    const msgSpan = document.createElement("span");
    msgSpan.textContent = message;
    errorDiv.appendChild(msgSpan);

    if (showSettingsButton) {
      const settingsBtn = document.createElement("button");
      settingsBtn.type = "button";
      settingsBtn.className = "xviewless-btn-settings";
      settingsBtn.textContent = "Open Settings";
      settingsBtn.addEventListener("click", () => {
        const url = chrome.runtime.getURL("options.html");
        window.open(url, "_blank");
      });
      errorDiv.appendChild(settingsBtn);
    }
  }

  /**
   * Extract context from the page for the reply.
   */
  function extractContext(composerContainer) {
    const context = {
      postText: "",
      commentText: "",
      username: "",
      displayName: "",
    };

    try {
      // Find all tweet text elements on the page.
      const allTweetTexts = document.querySelectorAll(
        '[data-testid="tweetText"]'
      );

      // Collect all tweets with their positions.
      const tweets = [];
      allTweetTexts.forEach((el, index) => {
        const text = el.textContent.trim();
        if (text) {
          const rect = el.getBoundingClientRect();
          tweets.push({
            text,
            element: el,
            index,
            top: rect.top,
            isVisible: rect.top >= 0 && rect.top < window.innerHeight,
          });
        }
      });

      // Find the composer's position.
      const composerRect = composerContainer?.getBoundingClientRect();

      if (tweets.length > 0) {
        // Find the tweet that's closest above the composer (or the most recent visible tweet).
        let targetTweet = null;

        if (composerRect) {
          // Find tweets that are above the composer.
          const tweetsAbove = tweets.filter((t) => t.top < composerRect.top);
          if (tweetsAbove.length > 0) {
            // Get the one closest to the composer (last one above it).
            targetTweet = tweetsAbove[tweetsAbove.length - 1];
          }
        }

        // Fallback: use the first visible tweet or just the first tweet.
        if (!targetTweet) {
          targetTweet = tweets.find((t) => t.isVisible) || tweets[0];
        }

        if (targetTweet) {
          context.postText = targetTweet.text;

          // Try to get the author (handle and display name).
          const article = targetTweet.element.closest("article");
          if (article) {
            // Look for the username/handle - try multiple selectors.
            let handle =
              article.querySelector('a[href^="/"][tabindex="-1"]') ||
              article.querySelector('a[href*="/"][tabindex="-1"]') ||
              article.querySelector('[data-testid="User-Name"] a[href*="/"]');

            if (handle) {
              const handleText = handle.textContent.trim();
              if (handleText.startsWith("@")) {
                context.username = handleText;
              } else if (handleText && !handleText.includes("·")) {
                // Might be just the handle without @
                context.username = handleText.startsWith("@")
                  ? handleText
                  : "@" + handleText;
              }
            }

            // Try to get display name.
            const nameEl =
              article.querySelector(
                '[data-testid="User-Name"] span:not([dir])'
              ) || article.querySelector('[data-testid="User-Name"]');
            if (nameEl) {
              const nameText = nameEl.textContent.trim();
              // Remove handle if it's in there.
              const cleanName = nameText.split("·")[0].trim();
              if (cleanName && cleanName !== context.username) {
                context.displayName = cleanName;
              }
            }

            // Build postText with author info.
            if (context.username) {
              if (context.displayName) {
                context.postText = `${context.username} (${context.displayName}) posted: ${context.postText}`;
              } else {
                context.postText = `${context.username} posted: ${context.postText}`;
              }
              console.log(
                "[X ViewLess] Extracted author:",
                context.username,
                context.displayName || ""
              );
            }
          }
        }

        // If there are multiple tweets, the second-to-last visible might be a parent tweet.
        if (tweets.length > 1 && targetTweet) {
          const otherTweets = tweets.filter((t) => t.text !== targetTweet.text);
          if (otherTweets.length > 0) {
            // Could be part of a thread - capture as additional context.
            context.commentText = otherTweets[0].text;
          }
        }
      }

      // Fallback: use document title and selected text.
      if (!context.postText) {
        const selected = window.getSelection().toString().trim();
        if (selected) {
          context.postText = selected;
        } else {
          // Parse document title for context.
          const title = document.title;
          // X titles are like: "Username on X: "tweet content" / X"
          const match = title.match(/on X: [""](.+)[""] \/ X/);
          if (match) {
            context.postText = match[1];
          } else {
            context.postText = title
              .replace(" / X", "")
              .replace(" on X:", ": ")
              .trim();
          }
        }
      }
    } catch (error) {
      console.error("[X ViewLess] Context extraction failed:", error);
      // Use document title as fallback.
      context.postText = document.title.replace(" / X", "").trim();
    }

    return context;
  }

  /**
   * Insert text directly into composer (first generation attempt).
   * Tries multiple methods to work with X's Draft.js editor.
   */
  async function insertIntoComposerDirect(composer, text) {
    try {
      if (!composer || !composer.isConnected) {
        throw new Error("Composer is no longer in the document");
      }

      console.log("[X ViewLess] Attempting direct insertion...");

      // Focus and activate.
      composer.focus();
      composer.click();
      await sleep(100);

      // Try method 1: selectAll + insertText (simplest).
      document.execCommand("selectAll", false, null);
      await sleep(50);
      const success = document.execCommand("insertText", false, text);

      if (success) {
        console.log("[X ViewLess] Direct insertion succeeded via execCommand");
        composer.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: text,
          })
        );
        return;
      }

      // Method 2: Try clipboard paste programmatically.
      await navigator.clipboard.writeText(text);
      document.execCommand("selectAll", false, null);
      await sleep(50);
      document.execCommand("paste", false, null);
      await sleep(100);

      // Check if it worked.
      const content = composer.textContent || "";
      if (content.includes(text.substring(0, 20))) {
        console.log("[X ViewLess] Direct insertion succeeded via paste");
        return;
      }

      // If both failed, fall back to clipboard + hint.
      console.log(
        "[X ViewLess] Direct insertion failed, falling back to clipboard"
      );
      showPasteHint();
    } catch (error) {
      console.error("[X ViewLess] Direct insertion error:", error);
      // Fall back to clipboard.
      try {
        await navigator.clipboard.writeText(text);
        composer.focus();
        showPasteHint();
      } catch (clipError) {
        alert("X ViewLess: Generated reply:\n\n" + text);
      }
    }
  }

  /**
   * Insert text into the active X composer (subsequent generations).
   * X's Draft.js editor is very protective, so we copy to clipboard and let user paste.
   * This is the most reliable approach for regenerations.
   */
  async function insertIntoComposer(composer, text) {
    try {
      // Verify the composer is still in the document.
      if (!composer || !composer.isConnected) {
        throw new Error("Composer is no longer in the document");
      }

      console.log("[X ViewLess] Copying to clipboard and focusing composer...");

      // Copy text to clipboard.
      await navigator.clipboard.writeText(text);

      // Focus the composer so user can paste.
      composer.focus();
      composer.click();

      // Show friendly notification.
      showPasteHint();

      console.log("[X ViewLess] Text copied, ready to paste");
    } catch (error) {
      console.error("[X ViewLess] Failed to copy to clipboard:", error);
      // Last resort: show in alert.
      alert(
        "X ViewLess: Generated reply:\n\n" + text + "\n\n(Please copy manually)"
      );
    }
  }

  /**
   * Show a non-blocking hint to paste.
   */
  function showPasteHint() {
    // Remove any existing toast.
    const existing = document.querySelector(".xviewless-toast");
    if (existing) existing.remove();

    // Create a toast-style notification.
    const toast = document.createElement("div");
    toast.className = "xviewless-toast";
    const isMac = navigator.platform.includes("Mac");
    const shortcut = isMac ? "Cmd+V" : "Ctrl+V";
    toast.innerHTML = `📋 <strong>Reply copied!</strong> Press <kbd>${shortcut}</kbd> to paste`;
    document.body.appendChild(toast);

    // Remove after 4 seconds.
    setTimeout(() => {
      toast.classList.add("xviewless-toast-hide");
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  /**
   * Simple sleep utility.
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Inject CSS styles into the page.
   */
  function injectStyles() {
    if (document.querySelector("[data-xviewless-style]")) return;

    const style = document.createElement("style");
    style.setAttribute("data-xviewless-style", "true");
    style.textContent = `
      /* X ViewLess Button. */
      .xviewless-btn {
        display: inline-flex !important;
        align-items: center;
        gap: 4px;
        padding: 6px 12px;
        font-size: 13px;
        font-weight: 600;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #fff;
        background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
        border: none;
        border-radius: 9999px;
        cursor: pointer;
        transition: transform 0.1s, box-shadow 0.1s, opacity 0.2s;
        box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        margin-left: 8px;
        margin-right: 0 !important;
        min-width: 80px;
        justify-content: center;
        flex-shrink: 0;
        position: relative;
        z-index: 1;
      }
      .xviewless-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 2px 6px rgba(0,0,0,0.25);
      }
      .xviewless-btn:active:not(:disabled) {
        transform: translateY(0);
      }
      .xviewless-btn:disabled {
        cursor: wait;
      }
      
      /* Modal Overlay. */
      .xviewless-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 999999;
        animation: xviewless-fade-in 0.15s ease-out;
      }
      @keyframes xviewless-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      /* Modal Card. */
      .xviewless-modal {
        background: #ffffff;
        border-radius: 16px;
        width: 90%;
        max-width: 480px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        animation: xviewless-slide-up 0.2s ease-out;
        overflow: hidden;
      }
      @keyframes xviewless-slide-up {
        from { opacity: 0; transform: translateY(20px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      
      /* Modal Header. */
      .xviewless-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid #e5e7eb;
      }
      .xviewless-title {
        font-size: 16px;
        font-weight: 700;
        color: #15803d;
      }
      .xviewless-close {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        color: #6b7280;
        background: none;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        transition: background 0.1s, color 0.1s;
      }
      .xviewless-close:hover {
        background: #f3f4f6;
        color: #374151;
      }
      
      /* Modal Body. */
      .xviewless-body {
        padding: 16px 20px;
        flex: 1;
        overflow-y: auto;
      }
      
      /* Controls. */
      .xviewless-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 12px;
      }
      .xviewless-control-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .xviewless-control-group label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #6b7280;
      }
      .xviewless-control-group select {
        padding: 6px 28px 6px 10px;
        font-size: 13px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: #fff;
        cursor: pointer;
        appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 8px center;
      }
      .xviewless-control-group select:focus {
        outline: none;
        border-color: #22c55e;
        box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
      }
      .xviewless-checkbox-group {
        justify-content: flex-end;
      }
      .xviewless-checkbox-group label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        text-transform: none;
        letter-spacing: normal;
        color: #374151;
        cursor: pointer;
      }
      .xviewless-checkbox-group input[type="checkbox"] {
        width: 16px;
        height: 16px;
        cursor: pointer;
        accent-color: #22c55e;
      }
      
      /* Textarea. */
      .xviewless-textarea {
        width: 100%;
        min-height: 120px;
        padding: 12px;
        font-size: 14px;
        font-family: inherit;
        line-height: 1.5;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        resize: vertical;
        transition: border-color 0.1s;
      }
      .xviewless-textarea:focus {
        outline: none;
        border-color: #22c55e;
        box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
      }
      .xviewless-textarea::placeholder {
        color: #9ca3af;
      }
      .xviewless-textarea[readonly] {
        background: #f9fafb;
        cursor: wait;
      }
      
      /* Error Message. */
      .xviewless-error {
        margin-top: 12px;
        padding: 12px;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        color: #dc2626;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .xviewless-btn-settings {
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 600;
        color: #dc2626;
        background: #fff;
        border: 1px solid #fecaca;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.1s;
      }
      .xviewless-btn-settings:hover {
        background: #fef2f2;
      }
      
      /* Modal Footer. */
      .xviewless-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 16px 20px;
        border-top: 1px solid #e5e7eb;
        background: #f9fafb;
      }
      .xviewless-btn-secondary {
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 600;
        color: #374151;
        background: #fff;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.1s, border-color 0.1s;
      }
      .xviewless-btn-secondary:hover:not(:disabled) {
        background: #f3f4f6;
        border-color: #9ca3af;
      }
      .xviewless-btn-secondary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .xviewless-btn-primary {
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 600;
        color: #fff;
        background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: transform 0.1s, box-shadow 0.1s;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
      .xviewless-btn-primary:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 2px 6px rgba(0,0,0,0.15);
      }
      .xviewless-btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }
      
      /* Toast notification. */
      .xviewless-toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
        color: #fff;
        padding: 14px 24px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 500;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 8px 24px rgba(0,0,0,0.25);
        z-index: 999999;
        animation: xviewless-toast-in 0.3s ease-out;
        pointer-events: none;
      }
      .xviewless-toast strong {
        font-weight: 600;
      }
      .xviewless-toast kbd {
        background: rgba(255,255,255,0.2);
        padding: 3px 8px;
        border-radius: 4px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
        font-size: 12px;
        font-weight: 600;
        margin: 0 2px;
        border: 1px solid rgba(255,255,255,0.3);
      }
      .xviewless-toast-hide {
        opacity: 0;
        transform: translateX(-50%) translateY(10px);
        transition: opacity 0.3s, transform 0.3s;
      }
      @keyframes xviewless-toast-in {
        from { 
          opacity: 0; 
          transform: translateX(-50%) translateY(10px); 
        }
        to { 
          opacity: 1; 
          transform: translateX(-50%) translateY(0); 
        }
      }
      
      /* View count toggle button. */
      .xviewless-viewcount-toggle {
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        height: 28px;
        padding: 0 8px;
        margin-left: 8px;
        background: transparent;
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 14px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 400;
        transition: background 0.15s, border-color 0.15s;
        opacity: 0.6;
        visibility: visible !important;
        white-space: nowrap;
      }
      .xviewless-viewcount-toggle:hover {
        background: rgba(0, 0, 0, 0.05);
        border-color: rgba(0, 0, 0, 0.2);
        opacity: 1;
      }
      .xviewless-viewcount-toggle:active {
        transform: scale(0.95);
      }
      
      /* Dark mode support. */
      @media (prefers-color-scheme: dark) {
        .xviewless-modal {
          background: #1f2937;
          color: #f9fafb;
        }
        .xviewless-header {
          border-color: #374151;
        }
        .xviewless-title {
          color: #4ade80;
        }
        .xviewless-close {
          color: #9ca3af;
        }
        .xviewless-close:hover {
          background: #374151;
          color: #f9fafb;
        }
        .xviewless-control-group label {
          color: #9ca3af;
        }
        .xviewless-control-group select {
          background: #374151;
          border-color: #4b5563;
          color: #f9fafb;
        }
        .xviewless-checkbox-group label {
          color: #e5e7eb;
        }
        .xviewless-textarea {
          background: #374151;
          border-color: #4b5563;
          color: #f9fafb;
        }
        .xviewless-textarea:focus {
          border-color: #4ade80;
          box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.2);
        }
        .xviewless-textarea[readonly] {
          background: #1f2937;
        }
        .xviewless-textarea::placeholder {
          color: #6b7280;
        }
        .xviewless-footer {
          background: #111827;
          border-color: #374151;
        }
        .xviewless-btn-secondary {
          background: #374151;
          border-color: #4b5563;
          color: #e5e7eb;
        }
        .xviewless-btn-secondary:hover:not(:disabled) {
          background: #4b5563;
        }
        .xviewless-viewcount-toggle {
          border-color: rgba(255, 255, 255, 0.2);
          opacity: 0.7;
        }
        .xviewless-viewcount-toggle:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.3);
          opacity: 1;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Find the currently active composer element.
   */
  function findActiveComposer(container) {
    // Try to find the composer in the container first.
    if (container && container.isConnected) {
      const composerInContainer = container.querySelector(
        '[role="textbox"][contenteditable="true"]'
      );
      if (composerInContainer && composerInContainer.isConnected) {
        return composerInContainer;
      }
    }

    // Fallback: find any active composer on the page.
    const allComposers = document.querySelectorAll(
      '[role="textbox"][contenteditable="true"]'
    );
    for (const c of allComposers) {
      if (c.isConnected) {
        // Prefer one that's visible.
        const rect = c.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return c;
        }
      }
    }

    // Return the first connected one.
    return Array.from(allComposers).find((c) => c.isConnected) || null;
  }

  /**
   * Simple debounce utility.
   */
  function debounce(fn, delay) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /**
   * Initialize view count hiding for own posts.
   */
  async function initViewCountHiding() {
    // Check if feature is enabled.
    const settings = await chrome.storage.sync.get({ hideViewCounts: false });
    if (!settings.hideViewCounts) return;

    // Inject CSS to hide view counts immediately while processing.
    injectViewCountHidingCSS();

    // Get current user's handle.
    const currentUserHandle = getCurrentUserHandle();
    if (!currentUserHandle) {
      // Retry more aggressively if user handle not found yet.
      setTimeout(initViewCountHiding, 500);
      setTimeout(initViewCountHiding, 1000);
      setTimeout(initViewCountHiding, 2000);
      return;
    }

    console.log("[X ViewLess] Hiding view counts for user:", currentUserHandle);

    // Process existing posts immediately.
    processViewCounts(currentUserHandle);

    // Process again after short delays to catch late-loading content.
    setTimeout(() => processViewCounts(currentUserHandle), 100);
    setTimeout(() => processViewCounts(currentUserHandle), 300);
    setTimeout(() => processViewCounts(currentUserHandle), 500);
    setTimeout(() => processViewCounts(currentUserHandle), 1000);

    // Observe for new posts with minimal debounce for faster response.
    const viewCountObserver = new MutationObserver((mutations) => {
      // Check if any new articles were added.
      let hasNewArticles = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            // Element node
            if (node.tagName === "ARTICLE" || node.querySelector("article")) {
              hasNewArticles = true;
              break;
            }
          }
        }
        if (hasNewArticles) break;
      }

      // Process immediately if new articles detected, otherwise use minimal debounce.
      if (hasNewArticles) {
        processViewCounts(currentUserHandle);
      } else {
        // Use requestAnimationFrame for immediate processing without blocking.
        requestAnimationFrame(() => {
          processViewCounts(currentUserHandle);
        });
      }
    });
    viewCountObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Inject CSS to hide view counts immediately while JavaScript processes them.
   */
  function injectViewCountHidingCSS() {
    if (document.querySelector("[data-xviewless-viewcount-css]")) return;

    const style = document.createElement("style");
    style.setAttribute("data-xviewless-viewcount-css", "true");
    style.textContent = `
      /* Hide view counts immediately for own posts while processing. */
      article[data-xviewless-viewcount-processed="true"] [data-xviewless-viewcount-processed="true"],
      article[data-xviewless-viewcount-processed="true"] [data-xviewless-hidden="true"] {
        display: none !important;
        visibility: hidden !important;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Get the current user's handle from the page.
   */
  function getCurrentUserHandle() {
    // Method 1: Look for the profile link in the sidebar/navigation.
    const profileLink =
      document.querySelector('a[data-testid="AppTabBar_Profile_Link"]') ||
      document.querySelector(
        '[data-testid="SideNav_AccountSwitcher_Button"]'
      ) ||
      document.querySelector('a[href*="/"][aria-label*="Profile"]');

    if (profileLink) {
      const href = profileLink.getAttribute("href");
      if (href) {
        const match = href.match(/^\/([^\/\?]+)/);
        if (match && match[1] && !match[1].includes("-")) {
          return "@" + match[1];
        }
      }
    }

    // Method 2: Look for any link in the sidebar that goes to a user profile.
    const sidebarLinks = document.querySelectorAll(
      'nav a[href^="/"], [data-testid="SideNav"] a[href^="/"]'
    );
    for (const link of sidebarLinks) {
      const href = link.getAttribute("href");
      if (href && href.startsWith("/")) {
        const parts = href.split("/").filter((p) => p);
        if (parts.length === 1 && parts[0] && !parts[0].includes("-")) {
          // Check if it's not a known route.
          const route = parts[0].toLowerCase();
          if (
            route !== "home" &&
            route !== "explore" &&
            route !== "notifications" &&
            route !== "messages" &&
            route !== "i" &&
            route !== "compose" &&
            route !== "bookmarks" &&
            route !== "communities" &&
            route !== "verified"
          ) {
            // Likely a username.
            return "@" + parts[0];
          }
        }
      }
    }

    // Method 3: Find from posts that have the "More" menu (own posts).
    const articles = document.querySelectorAll("article");
    for (const article of articles) {
      // Check if this article has a "More" menu button (typically only on own posts).
      const moreMenu =
        article.querySelector('[data-testid="caret"]') ||
        article.querySelector('button[aria-label*="More"]') ||
        article.querySelector('[aria-label*="More options"]');

      if (moreMenu) {
        // This is likely the user's own post, get the author handle.
        const userLink =
          article.querySelector('a[href^="/"][tabindex="-1"]') ||
          article.querySelector('[data-testid="User-Name"] a[href*="/"]');
        if (userLink) {
          const href = userLink.getAttribute("href");
          if (href) {
            const match = href.match(/^\/([^\/\?]+)/);
            if (match && match[1]) {
              return "@" + match[1];
            }
          }
        }
      }
    }

    // Method 4: Try to get from the page URL if on profile page.
    const urlMatch = window.location.pathname.match(/^\/([^\/\?]+)$/);
    if (urlMatch && urlMatch[1] && !urlMatch[1].includes("-")) {
      const route = urlMatch[1].toLowerCase();
      if (
        route !== "home" &&
        route !== "explore" &&
        route !== "notifications" &&
        route !== "messages" &&
        route !== "i" &&
        route !== "compose"
      ) {
        return "@" + urlMatch[1];
      }
    }

    return null;
  }

  /**
   * Process view counts on all posts, hiding them for own posts.
   */
  function processViewCounts(currentUserHandle) {
    const articles = document.querySelectorAll("article");

    articles.forEach((article) => {
      // Check if this is the user's own post.
      const userLink =
        article.querySelector('a[href^="/"][tabindex="-1"]') ||
        article.querySelector('[data-testid="User-Name"] a[href*="/"]');

      if (!userLink) return;

      const href = userLink.getAttribute("href");
      if (!href) return;

      const match = href.match(/^\/([^\/\?]+)/);
      if (!match || !match[1]) return;

      const postAuthorHandle = "@" + match[1];

      // Only process if it's the current user's post.
      if (postAuthorHandle.toLowerCase() !== currentUserHandle.toLowerCase())
        return;

      // Find ALL view count elements (both timeline and detail view).
      const viewCountElements = findAllViewCountElements(article);
      console.log(
        "[X ViewLess] Found",
        viewCountElements.length,
        "view count elements in article"
      );
      if (viewCountElements.length === 0) {
        console.log(
          "[X ViewLess] No view count elements found, marking as pending"
        );
        // If no view counts found but article not processed, mark it to retry later.
        if (!article.hasAttribute("data-xviewless-viewcount-processed")) {
          article.setAttribute("data-xviewless-viewcount-processed", "pending");
        }
        return;
      }

      // Process each view count element.
      let hasNewElements = false;
      viewCountElements.forEach((viewCountElement, index) => {
        // Skip if already processed.
        if (viewCountElement.hasAttribute("data-xviewless-viewcount-processed"))
          return;

        hasNewElements = true;

        // Capture the view count text BEFORE hiding (while it's still visible).
        let viewCountText = "";

        // Method 1: Get text directly from the element.
        viewCountText = viewCountElement.textContent.trim();

        // Method 2: If empty, try to get from child elements.
        if (!viewCountText) {
          const children = viewCountElement.querySelectorAll("span, div");
          for (const child of children) {
            const childText = child.textContent.trim();
            if (
              childText.match(/\d+[\d.,KMB]*\s*views?/i) ||
              childText.match(/^\d+[\d.,KMB]*$/)
            ) {
              viewCountText = childText;
              break;
            }
          }
        }

        // Method 3: Try to get it from parent element.
        if (!viewCountText) {
          const parent = viewCountElement.parentElement;
          if (parent) {
            const parentText = parent.textContent.trim();
            // Extract just the number and "views" part.
            const match = parentText.match(/(\d+[\d.,KMB]*\s*views?)/i);
            if (match) {
              viewCountText = match[1];
            } else {
              // Try just the number if it's a timeline view count.
              const numMatch = parentText.match(/^(\d+[\d.,KMB]*)$/);
              if (numMatch) {
                viewCountText = numMatch[1];
              }
            }
          }
        }

        // Method 4: Try getting from aria-label.
        if (!viewCountText) {
          const ariaLabel = viewCountElement.getAttribute("aria-label") || "";
          const match = ariaLabel.match(/(\d+[\d.,KMB]*\s*views?)/i);
          if (match) {
            viewCountText = match[1];
          }
        }

        // Method 5: Try getting from the entire article's engagement row.
        if (!viewCountText) {
          const engagementRow = viewCountElement.closest('[role="group"]');
          if (engagementRow) {
            // Get the last metric's text (view count is usually last).
            const metrics = Array.from(engagementRow.children);
            if (metrics.length > 0) {
              const lastMetric = metrics[metrics.length - 1];
              const lastText = lastMetric.textContent.trim();
              if (lastText.match(/\d+[\d.,KMB]*/)) {
                viewCountText =
                  lastText.match(/(\d+[\d.,KMB]*\s*views?)/i)?.[1] ||
                  lastText.match(/(\d+[\d.,KMB]*)/)?.[1] ||
                  "";
              }
            }
          }
        }

        // Method 6: For detail view (next to timestamp), check if element is near time element.
        if (!viewCountText) {
          const timeElement = viewCountElement
            .closest("article")
            ?.querySelector("time, [datetime]");
          if (timeElement) {
            console.log(
              "[X ViewLess] Found time element nearby, checking for view count text"
            );
            // Check if view count is a sibling of time or nearby.
            const timeParent = timeElement.parentElement;
            if (timeParent) {
              // Get all text from the parent that contains both time and view count.
              const parentText = timeParent.textContent || "";
              console.log("[X ViewLess] Time parent text:", parentText);
              const viewMatch = parentText.match(/(\d+[\d.,KMB]*\s*views?)/i);
              if (viewMatch) {
                viewCountText = viewMatch[1];
                console.log(
                  "[X ViewLess] Extracted view count from time parent:",
                  viewCountText
                );
              } else {
                // Try to find the view count element that's a sibling of time.
                const siblings = Array.from(timeParent.children);
                for (const sibling of siblings) {
                  if (sibling === timeElement) continue;
                  const siblingText = sibling.textContent.trim();
                  console.log(
                    "[X ViewLess] Checking time sibling:",
                    sibling.tagName,
                    siblingText
                  );
                  const match = siblingText.match(/(\d+[\d.,KMB]*\s*views?)/i);
                  if (match) {
                    viewCountText = match[1];
                    console.log(
                      "[X ViewLess] Found view count in time sibling:",
                      viewCountText
                    );
                    break;
                  }
                }
              }
            }

            // Also check the entire container around the time element.
            if (!viewCountText) {
              let container = timeElement.parentElement;
              for (let i = 0; i < 3 && container; i++) {
                const containerText = container.textContent || "";
                const match = containerText.match(/(\d+[\d.,KMB]*\s*views?)/i);
                if (match) {
                  // Make sure this match is after the time element (not before).
                  const timeIndex = containerText.indexOf(
                    timeElement.textContent
                  );
                  const viewIndex = containerText.indexOf(match[1]);
                  if (viewIndex > timeIndex) {
                    viewCountText = match[1];
                    console.log(
                      "[X ViewLess] Found view count in time container:",
                      viewCountText
                    );
                    break;
                  }
                }
                container = container.parentElement;
              }
            }
          }
        }

        // Clean up the text - remove extra whitespace.
        viewCountText = viewCountText.trim();

        // Fallback to a default if still empty.
        if (!viewCountText) {
          viewCountText = "Views";
        }

        console.log("[X ViewLess] View count element:", viewCountElement);
        console.log("[X ViewLess] Element tagName:", viewCountElement.tagName);
        console.log(
          "[X ViewLess] Element className:",
          viewCountElement.className
        );
        console.log(
          "[X ViewLess] Element textContent:",
          viewCountElement.textContent
        );
        console.log(
          "[X ViewLess] Element innerHTML:",
          viewCountElement.innerHTML
        );
        console.log(
          "[X ViewLess] Element aria-label:",
          viewCountElement.getAttribute("aria-label")
        );
        console.log(
          "[X ViewLess] Parent textContent:",
          viewCountElement.parentElement?.textContent
        );
        console.log("[X ViewLess] Captured view count text:", viewCountText);

        // Store the view count text BEFORE hiding.
        viewCountElement.setAttribute(
          "data-xviewless-viewcount-text",
          viewCountText
        );

        // Hide immediately after capturing text.
        viewCountElement.style.display = "none";
        viewCountElement.setAttribute("data-xviewless-hidden", "true");

        // Mark as processed.
        viewCountElement.setAttribute(
          "data-xviewless-viewcount-processed",
          "true"
        );

        // Store original display state.
        const originalDisplay =
          window.getComputedStyle(viewCountElement).display || "inline";
        viewCountElement.setAttribute(
          "data-xviewless-original-display",
          originalDisplay
        );

        // Add toggle button (only one per article, or one per view count location).
        if (
          index === 0 ||
          viewCountElement.closest('[role="group"]') !==
            viewCountElements[0]?.closest('[role="group"]')
        ) {
          // Add toggle button immediately.
          addViewCountToggle(article, viewCountElement, index);
        }
      });

      // Mark article as processed (or update from pending).
      if (
        hasNewElements ||
        article.getAttribute("data-xviewless-viewcount-processed") === "pending"
      ) {
        article.setAttribute("data-xviewless-viewcount-processed", "true");
      }
    });
  }

  /**
   * Find ALL view count elements in an article (both timeline and detail view).
   */
  function findAllViewCountElements(article) {
    const viewCountElements = [];
    const processed = new Set();

    // Exclude our own toggle buttons from being detected as view counts.
    const isOurToggleButton = (el) => {
      return (
        el.classList.contains("xviewless-viewcount-toggle") ||
        el.closest(".xviewless-viewcount-toggle") !== null
      );
    };

    // Method 1: Look for elements with aria-label containing "view".
    const viewCountByAria = article.querySelectorAll('[aria-label*="view" i]');
    viewCountByAria.forEach((el) => {
      // Skip our toggle buttons.
      if (isOurToggleButton(el)) return;

      const text = el.textContent.trim();
      if (text.match(/^\d+[\d.,KMB]*\s*views?$/i) || text.match(/views?$/i)) {
        if (!processed.has(el)) {
          viewCountElements.push(el);
          processed.add(el);
        }
      }
    });

    // Method 2: Look in the engagement row (timeline view - just numbers like "27", "496").
    const engagementRows = article.querySelectorAll('[role="group"]');
    engagementRows.forEach((engagementRow) => {
      // Get all direct children of the engagement row (each engagement metric).
      const metrics = Array.from(engagementRow.children);

      // Look for spans or links that contain view counts.
      const candidates = engagementRow.querySelectorAll("span, a, div");
      for (const el of candidates) {
        if (processed.has(el)) continue;
        // Skip our toggle buttons.
        if (isOurToggleButton(el)) continue;

        const text = el.textContent.trim();
        // Match "X Views" (detail view) or just numbers (timeline view counts).
        if (text.match(/^\d+[\d.,KMB]*\s*views?$/i)) {
          // This is a view count with "views" text.
          viewCountElements.push(el);
          processed.add(el);
        } else if (text.match(/^\d+[\d.,KMB]*$/)) {
          // This might be a timeline view count (just a number).
          // View counts are typically the last engagement metric.
          const metricContainer =
            el.closest('[role="group"] > *') || el.parentElement;
          if (!metricContainer) continue;

          const metricIndex = metrics.indexOf(metricContainer);
          const isLastMetric = metricIndex === metrics.length - 1;
          const isSecondToLast = metricIndex === metrics.length - 2;

          // Check if it's in a link (view counts are usually clickable).
          const isLink = el.tagName === "A" || el.closest("a");

          // Check for bar chart icon (view count indicator).
          const hasBarChartIcon =
            metricContainer.querySelector("svg") ||
            el.parentElement?.querySelector("svg");

          // Check if it's positioned after likes/retweets/replies.
          // View counts are almost always the last metric in the row.
          if ((isLastMetric || isSecondToLast) && (isLink || hasBarChartIcon)) {
            // Verify it's not a like/retweet/reply count.
            const containerText = metricContainer.textContent || "";
            const isNotOtherMetric = !containerText.match(
              /like|retweet|reply|comment/i
            );

            if (isNotOtherMetric) {
              viewCountElements.push(el);
              processed.add(el);
            }
          }
        }
      }
    });

    // Method 3: Look for view counts next to timestamp (detail view - "496 Views").
    // These are typically near the time element.
    const timeElements = article.querySelectorAll("time, [datetime]");
    timeElements.forEach((timeEl) => {
      console.log("[X ViewLess] Found time element:", timeEl);

      // Look for siblings or nearby elements containing "Views".
      // First, check siblings of the time element.
      const timeParent = timeEl.parentElement;
      if (timeParent) {
        // Check all siblings of the time element.
        const siblings = Array.from(timeParent.children);
        console.log("[X ViewLess] Time element siblings:", siblings.length);

        for (const sibling of siblings) {
          if (processed.has(sibling)) continue;

          const siblingText = sibling.textContent.trim();
          console.log(
            "[X ViewLess] Checking sibling:",
            sibling.tagName,
            siblingText
          );

          // Check if sibling contains view count pattern.
          if (siblingText.match(/\d+[\d.,KMB]*\s*views?/i)) {
            // This sibling might be the view count or contain it.
            const viewMatch = siblingText.match(/(\d+[\d.,KMB]*\s*views?)/i);
            if (viewMatch) {
              // Check if this element itself matches.
              if (siblingText.match(/^\d+[\d.,KMB]*\s*views?$/i)) {
                viewCountElements.push(sibling);
                processed.add(sibling);
                console.log(
                  "[X ViewLess] Found view count in sibling:",
                  sibling
                );
              } else {
                // Look for child elements.
                const childCandidates =
                  sibling.querySelectorAll("span, div, a");
                for (const child of childCandidates) {
                  if (processed.has(child)) continue;
                  const childText = child.textContent.trim();
                  if (childText.match(/^\d+[\d.,KMB]*\s*views?$/i)) {
                    viewCountElements.push(child);
                    processed.add(child);
                    console.log(
                      "[X ViewLess] Found view count in sibling child:",
                      child
                    );
                    break;
                  }
                }
              }
            }
          }
        }
      }

      // Also check parent and nearby elements.
      let current = timeEl.parentElement;
      for (let i = 0; i < 5 && current; i++) {
        const viewText = current.textContent || "";
        if (viewText.match(/\d+[\d.,KMB]*\s*views?/i)) {
          // Find the specific element containing the view count.
          const candidates = current.querySelectorAll("span, div, a");
          for (const el of candidates) {
            if (processed.has(el)) continue;
            const text = el.textContent.trim();
            console.log(
              "[X ViewLess] Checking candidate near time:",
              el.tagName,
              text
            );
            if (text.match(/^\d+[\d.,KMB]*\s*views?$/i)) {
              viewCountElements.push(el);
              processed.add(el);
              console.log("[X ViewLess] Found view count near timestamp:", el);
              break;
            }
          }
          break;
        }
        current = current.parentElement;
      }
    });

    // Method 4: Search all interactive elements for view count patterns.
    const allInteractive = article.querySelectorAll(
      'a[href*="analytics"], button, [role="button"]'
    );
    for (const el of allInteractive) {
      if (processed.has(el)) continue;
      // Skip our toggle buttons.
      if (isOurToggleButton(el)) continue;

      const text = el.textContent.trim();
      if (text.match(/^\d+[\d.,KMB]*\s*views?$/i)) {
        viewCountElements.push(el);
        processed.add(el);
      }
    }

    // Method 5: Specifically look for the last engagement metric (usually view count in timeline).
    engagementRows.forEach((engagementRow) => {
      const metrics = Array.from(engagementRow.children);
      if (metrics.length > 0) {
        // The last metric is often the view count.
        const lastMetric = metrics[metrics.length - 1];
        const lastMetricText = lastMetric.textContent?.trim() || "";

        // If it's just a number and not already identified, it might be a view count.
        if (
          lastMetricText.match(/^\d+[\d.,KMB]*$/) &&
          !processed.has(lastMetric)
        ) {
          // Check if it's clickable (view counts are usually links).
          const isClickable =
            lastMetric.querySelector("a") || lastMetric.closest("a");
          if (isClickable) {
            const viewCountEl =
              lastMetric.querySelector("span, a, div") || lastMetric;
            if (!processed.has(viewCountEl)) {
              viewCountElements.push(viewCountEl);
              processed.add(viewCountEl);
            }
          }
        }
      }
    });

    // Method 6: Fallback - search all text elements for view count patterns.
    const allElements = article.querySelectorAll("span, div, a");
    for (const el of allElements) {
      if (processed.has(el)) continue;
      // Skip our toggle buttons.
      if (isOurToggleButton(el)) continue;

      const text = el.textContent.trim();
      // Match "X Views" pattern.
      const viewMatch = text.match(/^(\d+[\d.,KMB]*)\s*(views?)$/i);
      if (viewMatch) {
        // Make sure it's not part of a larger text block.
        const parentText = el.parentElement?.textContent?.trim() || "";
        if (
          parentText === text ||
          parentText.match(/^\d+[\d.,KMB]*\s*views?$/i)
        ) {
          viewCountElements.push(el);
          processed.add(el);
        }
      }
    }

    return viewCountElements;
  }

  /**
   * Add a toggle button to show/hide view count.
   */
  function addViewCountToggle(article, viewCountElement, index) {
    // Create a unique identifier for this toggle.
    const toggleId = `xviewless-toggle-${index}`;

    // Check if button already exists for this location.
    if (
      article.querySelector(
        `.xviewless-viewcount-toggle[data-toggle-id="${toggleId}"]`
      )
    )
      return;

    // Find where to place the button (near the view count's original location).
    const engagementRow = viewCountElement.closest('[role="group"]');
    const timeElement =
      viewCountElement.closest("time")?.parentElement ||
      article.querySelector("time")?.parentElement;

    // Create toggle button.
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "xviewless-viewcount-toggle";
    toggleBtn.setAttribute("data-toggle-id", toggleId);
    toggleBtn.setAttribute("aria-label", "Show view count");
    toggleBtn.innerHTML = "👁️";
    toggleBtn.title = "Click to show view count";

    // Find all view count elements in this article to toggle them together.
    const allViewCounts = Array.from(
      article.querySelectorAll('[data-xviewless-viewcount-processed="true"]')
    );

    // Get the view count text from the first view count element (stored attribute).
    let viewCountText = viewCountElement.getAttribute(
      "data-xviewless-viewcount-text"
    );
    console.log(
      "[X ViewLess] Toggle button - initial stored text:",
      viewCountText
    );

    // If not stored, try to get it from the element's text (might be empty if already hidden).
    if (!viewCountText) {
      viewCountText = viewCountElement.textContent.trim();
      console.log(
        "[X ViewLess] Toggle button - text from element:",
        viewCountText
      );
    }

    // If still empty, try to get from any view count element.
    if (!viewCountText && allViewCounts.length > 0) {
      console.log(
        "[X ViewLess] Toggle button - checking all view counts:",
        allViewCounts.length
      );
      for (const vc of allViewCounts) {
        const stored = vc.getAttribute("data-xviewless-viewcount-text");
        console.log(
          "[X ViewLess] Toggle button - checking view count:",
          vc,
          "stored text:",
          stored
        );
        if (stored) {
          viewCountText = stored;
          break;
        }
      }
    }

    // Fallback.
    if (!viewCountText) {
      viewCountText = "Views";
      console.log("[X ViewLess] Toggle button - using fallback text");
    }

    console.log(
      "[X ViewLess] Toggle button - final view count text:",
      viewCountText
    );

    let isVisible = false;

    toggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      console.log(
        "[X ViewLess] Toggle button clicked, current state:",
        isVisible
      );
      console.log("[X ViewLess] All view counts:", allViewCounts.length);

      isVisible = !isVisible;

      // Toggle all view counts in this article.
      allViewCounts.forEach((vc, idx) => {
        console.log("[X ViewLess] Toggling view count", idx, ":", vc);
        if (isVisible) {
          let displayValue =
            vc.getAttribute("data-xviewless-original-display") || "inline";
          // If original display was "none", use a visible value instead.
          if (displayValue === "none") {
            // Try to determine the best display value based on element type.
            if (vc.tagName === "SPAN" || vc.tagName === "A") {
              displayValue = "inline";
            } else if (vc.tagName === "DIV") {
              displayValue = "block";
            } else {
              displayValue = "inline";
            }
          }
          console.log(
            "[X ViewLess] Showing view count, display:",
            displayValue
          );
          vc.style.display = displayValue;
          vc.removeAttribute("data-xviewless-hidden");
          console.log(
            "[X ViewLess] View count now visible, textContent:",
            vc.textContent
          );
        } else {
          console.log("[X ViewLess] Hiding view count");
          vc.style.display = "none";
          vc.setAttribute("data-xviewless-hidden", "true");
        }
      });

      // Get the current view count text.
      let currentViewCountText = viewCountText;
      console.log("[X ViewLess] Base view count text:", currentViewCountText);

      // Function to extract and update view count text.
      const updateButtonText = () => {
        if (!isVisible || allViewCounts.length === 0) return;

        // Try to get the text from the first visible view count element.
        const visibleCount =
          allViewCounts.find((vc) => {
            const display = window.getComputedStyle(vc).display;
            return display !== "none";
          }) || allViewCounts[0];

        console.log("[X ViewLess] Visible count element:", visibleCount);

        if (visibleCount) {
          let extractedText = "";

          // Try to read the current text.
          let currentText = visibleCount.textContent.trim();
          console.log(
            "[X ViewLess] Current text from visible element:",
            currentText
          );

          // If empty, try getting from child elements.
          if (!currentText) {
            const children = visibleCount.querySelectorAll("span, div, a");
            for (const child of children) {
              const childText = child.textContent.trim();
              if (childText.match(/\d+[\d.,KMB]*/)) {
                currentText = childText;
                console.log("[X ViewLess] Found text in child:", currentText);
                break;
              }
            }
          }

          if (currentText) {
            // Extract just the view count part if there's extra text.
            const match =
              currentText.match(/(\d+[\d.,KMB]*\s*views?)/i) ||
              currentText.match(/(\d+[\d.,KMB]*)/);
            if (match) {
              extractedText = match[1];
            } else {
              extractedText = currentText;
            }
            console.log("[X ViewLess] Using extracted text:", extractedText);
          }

          // If still empty, try getting from parent or siblings (for detail view).
          if (!extractedText || extractedText === "Views") {
            const parent = visibleCount.parentElement;
            if (parent) {
              const parentText = parent.textContent.trim();
              console.log("[X ViewLess] Parent text:", parentText);
              if (parentText) {
                const match =
                  parentText.match(/(\d+[\d.,KMB]*\s*views?)/i) ||
                  parentText.match(/(\d+[\d.,KMB]*)/);
                if (match) {
                  extractedText = match[1];
                  console.log(
                    "[X ViewLess] Extracted from parent:",
                    extractedText
                  );
                }
              }

              // Also check siblings (for detail view next to timestamp).
              if (!extractedText || extractedText === "Views") {
                const siblings = Array.from(parent.children);
                for (const sibling of siblings) {
                  if (sibling === visibleCount) continue;
                  const siblingText = sibling.textContent.trim();
                  const match = siblingText.match(/(\d+[\d.,KMB]*\s*views?)/i);
                  if (match) {
                    extractedText = match[1];
                    console.log(
                      "[X ViewLess] Found in sibling:",
                      extractedText
                    );
                    break;
                  }
                }
              }
            }
          }

          // Fall back to stored text if still empty.
          if (!extractedText || extractedText === "Views") {
            const stored = visibleCount.getAttribute(
              "data-xviewless-viewcount-text"
            );
            console.log("[X ViewLess] Stored text from attribute:", stored);
            if (stored && stored !== "Views") {
              extractedText = stored;
            }
          }

          // Update the button with the found text.
          const allToggles = article.querySelectorAll(
            ".xviewless-viewcount-toggle"
          );
          const textToShow = extractedText || viewCountText || "Views";
          console.log("[X ViewLess] Updating button text to:", textToShow);
          allToggles.forEach((btn) => {
            btn.innerHTML = textToShow;
            btn.title = "Click to hide view count";
            btn.setAttribute("aria-label", "Hide view count");
          });
        }
      };

      // Update immediately, then again after a short delay to catch any late-loading text.
      if (isVisible && allViewCounts.length > 0) {
        updateButtonText();
        setTimeout(updateButtonText, 100);
        setTimeout(updateButtonText, 300);
      }

      console.log(
        "[X ViewLess] Final text to display:",
        currentViewCountText || viewCountText || "Views"
      );

      // Update all toggle buttons in this article.
      const allToggles = article.querySelectorAll(
        ".xviewless-viewcount-toggle"
      );
      console.log("[X ViewLess] Updating", allToggles.length, "toggle buttons");
      allToggles.forEach((btn, idx) => {
        console.log("[X ViewLess] Updating toggle button", idx);
        if (isVisible) {
          // Show the actual view count text instead of monkey emoji.
          const textToShow = currentViewCountText || viewCountText || "Views";
          console.log("[X ViewLess] Setting button text to:", textToShow);
          btn.innerHTML = textToShow;
          btn.title = "Click to hide view count";
          btn.setAttribute("aria-label", "Hide view count");
        } else {
          console.log("[X ViewLess] Setting button back to eye icon");
          btn.innerHTML = "👁️";
          btn.title = "Click to show view count";
          btn.setAttribute("aria-label", "Show view count");
        }
      });
    });

    // Insert the button near the view count's position.
    if (engagementRow) {
      // For timeline view counts, insert in engagement row.
      const viewCountParent = viewCountElement.parentElement;
      if (viewCountParent && viewCountParent.parentElement === engagementRow) {
        viewCountParent.insertAdjacentElement("afterend", toggleBtn);
      } else {
        // Find the last engagement metric and insert after it.
        const lastMetric = engagementRow.lastElementChild;
        if (lastMetric) {
          lastMetric.insertAdjacentElement("afterend", toggleBtn);
        } else {
          engagementRow.appendChild(toggleBtn);
        }
      }
    } else if (timeElement) {
      // For detail view counts (next to timestamp), insert near the time element.
      timeElement.insertAdjacentElement("afterend", toggleBtn);
    } else {
      // Fallback: insert near the view count element.
      viewCountElement.parentElement?.insertAdjacentElement(
        "afterend",
        toggleBtn
      );
    }
  }

  /**
   * Initialize follower count hiding.
   */
  async function initFollowerCountHiding() {
    // Check if any follower hiding feature is enabled.
    const settings = await chrome.storage.sync.get({
      hideMyFollowers: false,
      hideOtherFollowers: false,
    });
    if (!settings.hideMyFollowers && !settings.hideOtherFollowers) return;

    // Get current user's handle.
    const currentUserHandle = getCurrentUserHandle();
    if (!currentUserHandle) {
      // Retry if user handle not found yet.
      setTimeout(initFollowerCountHiding, 500);
      setTimeout(initFollowerCountHiding, 1000);
      setTimeout(initFollowerCountHiding, 2000);
      return;
    }

    console.log("[X ViewLess] Initializing follower count hiding");

    // Process existing follower counts immediately.
    processFollowerCounts(currentUserHandle, settings);

    // Process again after short delays to catch late-loading content.
    setTimeout(() => processFollowerCounts(currentUserHandle, settings), 100);
    setTimeout(() => processFollowerCounts(currentUserHandle, settings), 300);
    setTimeout(() => processFollowerCounts(currentUserHandle, settings), 500);
    setTimeout(() => processFollowerCounts(currentUserHandle, settings), 1000);

    // Observe for changes (profile page navigation, dynamic loading).
    const followerCountObserver = new MutationObserver(
      debounce(() => {
        processFollowerCounts(currentUserHandle, settings);
      }, 200)
    );
    followerCountObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Process follower counts on profile pages.
   */
  function processFollowerCounts(currentUserHandle, settings) {
    // Check if we're on a profile page (could be /username or /username/followers, etc.).
    const pathMatch = window.location.pathname.match(/^\/([^\/\?]+)/);
    if (!pathMatch) return;

    const username = pathMatch[1];

    // Skip known routes that aren't profile pages.
    const knownRoutes = [
      "home",
      "explore",
      "notifications",
      "messages",
      "i",
      "compose",
      "bookmarks",
      "communities",
      "verified",
    ];
    if (knownRoutes.includes(username.toLowerCase())) return;

    // Get the profile handle from URL.
    const profileHandle = "@" + username;
    const isOwnProfile =
      profileHandle.toLowerCase() === currentUserHandle.toLowerCase();

    // Determine if we should hide based on settings.
    const shouldHide =
      (isOwnProfile && settings.hideMyFollowers) ||
      (!isOwnProfile && settings.hideOtherFollowers);

    if (!shouldHide) return;

    // Find follower count elements.
    const followerCountElements = findAllFollowerCountElements();

    followerCountElements.forEach((element) => {
      // Skip if already processed.
      if (element.hasAttribute("data-xviewless-follower-processed")) return;

      // Hide the element.
      element.style.display = "none";
      element.setAttribute("data-xviewless-follower-processed", "true");
      element.setAttribute("data-xviewless-follower-hidden", "true");
    });
  }

  /**
   * Find all follower count elements on the page.
   */
  function findAllFollowerCountElements() {
    const elements = [];
    const processed = new Set();

    // Method 1: Look for links/buttons containing "Followers" text.
    const allLinks = document.querySelectorAll(
      'a[href*="/followers"], a[href*="/following"]'
    );
    allLinks.forEach((link) => {
      if (processed.has(link)) return;

      const text = link.textContent.trim();
      // Match patterns like "1,864 Followers", "487 Following", etc.
      if (text.match(/\d+[\d.,KMB]*\s*(Followers?|Following)/i)) {
        // Check if this is the follower count (not following count).
        if (text.match(/Followers?/i) && !text.match(/Following/i)) {
          elements.push(link);
          processed.add(link);
        }
      }
    });

    // Method 2: Look for elements with aria-label containing "Followers".
    const ariaElements = document.querySelectorAll(
      '[aria-label*="Followers" i]'
    );
    ariaElements.forEach((el) => {
      if (processed.has(el)) return;

      const ariaLabel = el.getAttribute("aria-label") || "";
      const text = el.textContent.trim();

      // Check if it's a follower count (not following).
      if (
        ariaLabel.match(/Followers?/i) &&
        !ariaLabel.match(/Following/i) &&
        text.match(/\d+[\d.,KMB]*/)
      ) {
        elements.push(el);
        processed.add(el);
      }
    });

    // Method 3: Look for spans/divs with follower count pattern in profile stats section.
    const profileStats = document.querySelectorAll(
      '[data-testid="UserProfileStats"], [role="group"]'
    );
    profileStats.forEach((statsContainer) => {
      const statsLinks = statsContainer.querySelectorAll("a, span, div");
      statsLinks.forEach((el) => {
        if (processed.has(el)) return;

        const text = el.textContent.trim();
        // Match "X Followers" pattern.
        const match = text.match(/^(\d+[\d.,KMB]*)\s*(Followers?)$/i);
        if (match) {
          elements.push(el);
          processed.add(el);
        }
      });
    });

    // Method 4: Look for specific test IDs or classes that might contain follower counts.
    const testIdElements = document.querySelectorAll(
      '[data-testid*="follower"], [data-testid*="Follower"]'
    );
    testIdElements.forEach((el) => {
      if (processed.has(el)) return;

      const text = el.textContent.trim();
      if (text.match(/\d+[\d.,KMB]*\s*Followers?/i)) {
        elements.push(el);
        processed.add(el);
      }
    });

    // Method 5: Search for text patterns in the profile header area.
    const profileHeader =
      document.querySelector('[data-testid="UserProfileHeader"]') ||
      document.querySelector('div[role="main"]') ||
      document.body;

    if (profileHeader) {
      const allTextElements = profileHeader.querySelectorAll("span, div, a");
      allTextElements.forEach((el) => {
        if (processed.has(el)) return;

        const text = el.textContent.trim();
        // Match exact "X Followers" pattern (not "Following").
        const match = text.match(/^(\d+[\d.,KMB]*)\s*(Followers?)$/i);
        if (match && !text.match(/Following/i)) {
          // Make sure it's not part of a larger text block.
          const parentText = el.parentElement?.textContent?.trim() || "";
          if (
            parentText === text ||
            parentText.match(/^\d+[\d.,KMB]*\s*Followers?$/i)
          ) {
            elements.push(el);
            processed.add(el);
          }
        }
      });
    }

    return elements;
  }
})();
