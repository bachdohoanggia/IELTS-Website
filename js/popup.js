(function () {
  const POPUP_STYLE_ID = 'app-popup-styles';
  const POPUP_ROOT_ID = 'app-popup-root';
  const queue = [];
  let activePopup = null;

  function ensureStyles() {
    if (document.getElementById(POPUP_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = POPUP_STYLE_ID;
    style.textContent = `
      .app-popup-backdrop {
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(15, 23, 42, 0.34);
        backdrop-filter: blur(10px);
        animation: appPopupFadeIn 150ms ease both;
      }

      .app-popup-card {
        width: min(520px, calc(100vw - 40px));
        max-width: 520px;
        box-sizing: border-box;
        overflow: hidden;
        border: 1px solid rgba(191, 219, 254, 0.95);
        border-radius: 26px;
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(248, 252, 255, 0.98));
        box-shadow: 0 28px 80px rgba(15, 23, 42, 0.22);
        color: #0f172a;
        transform-origin: center;
        animation: appPopupScaleIn 170ms ease both;
      }

      #app-popup-root .app-popup-card {
        width: min(520px, calc(100vw - 40px)) !important;
        max-width: 520px !important;
        box-sizing: border-box !important;
      }

      .app-popup-header {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 26px 30px 12px;
      }

      .app-popup-icon {
        width: 46px;
        height: 46px;
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        border-radius: 17px;
        background: linear-gradient(135deg, #2563eb, #14b8a6);
        color: #ffffff;
        font: 900 24px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 14px 28px rgba(37, 99, 235, 0.22);
      }

      .app-popup-title {
        margin: 0;
        color: #0f172a;
        font: 900 24px/1.18 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .app-popup-message {
        margin: 0;
        padding: 0 30px 14px;
        color: #475569;
        font: 800 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .app-popup-field-wrap {
        padding: 0 30px 22px;
      }

      .app-popup-input {
        width: 100%;
        height: 56px;
        padding: 0 18px;
        border: 1px solid #cbd5e1;
        border-radius: 18px;
        background: #ffffff;
        color: #0f172a;
        font: 800 17px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-sizing: border-box;
      }

      #app-popup-root .app-popup-input {
        display: block !important;
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        box-sizing: border-box !important;
      }

      .app-popup-input:focus {
        outline: none;
        border-color: #4ea5b2;
        box-shadow: 0 0 0 4px rgba(78, 165, 178, 0.14);
      }

      .app-popup-actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        padding: 0 30px 28px;
        border-top: 0 !important;
        background: transparent !important;
      }

      .app-popup-button {
        min-width: 108px;
        height: 46px !important;
        border: 1px solid #4ea5b2 !important;
        border-radius: 999px !important;
        background: #4ea5b2 !important;
        color: #ffffff !important;
        cursor: pointer;
        font: 900 15px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        box-shadow: 0 12px 24px rgba(78, 165, 178, 0.2) !important;
        transition: transform 150ms ease, background 150ms ease, box-shadow 150ms ease;
      }

      .app-popup-button:hover {
        transform: translateY(-1px) !important;
        background: #347f8c !important;
        box-shadow: 0 16px 30px rgba(78, 165, 178, 0.26) !important;
      }

      .app-popup-button-secondary {
        background: #ffffff !important;
        border-color: #cbd5e1 !important;
        color: #334155 !important;
        box-shadow: 0 10px 22px rgba(15, 23, 42, 0.06) !important;
      }

      .app-popup-button-secondary:hover {
        background: #f8fafc !important;
        border-color: #94a3b8 !important;
        color: #0f172a !important;
        box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08) !important;
      }

      .app-popup-button-confirm {
        background: #4ea5b2 !important;
        border-color: #4ea5b2 !important;
        color: #ffffff !important;
        box-shadow: 0 12px 24px rgba(78, 165, 178, 0.22) !important;
      }

      .app-popup-button-confirm:hover {
        background: #347f8c !important;
        border-color: #347f8c !important;
        color: #ffffff !important;
        box-shadow: 0 16px 30px rgba(78, 165, 178, 0.28) !important;
      }

      #app-popup-root .app-popup-button.app-popup-button-secondary {
        background: #ffffff !important;
        border: 1px solid #cbd5e1 !important;
        color: #334155 !important;
        box-shadow: 0 10px 22px rgba(15, 23, 42, 0.06) !important;
      }

      #app-popup-root .app-popup-button.app-popup-button-secondary:hover {
        background: #f8fafc !important;
        border-color: #94a3b8 !important;
        color: #0f172a !important;
        box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08) !important;
      }

      #app-popup-root .app-popup-button.app-popup-button-confirm {
        background: #4ea5b2 !important;
        border: 1px solid #4ea5b2 !important;
        color: #ffffff !important;
        box-shadow: 0 12px 24px rgba(78, 165, 178, 0.22) !important;
      }

      #app-popup-root .app-popup-button.app-popup-button-confirm:hover {
        background: #347f8c !important;
        border-color: #347f8c !important;
        color: #ffffff !important;
        box-shadow: 0 16px 30px rgba(78, 165, 178, 0.28) !important;
      }

      .app-popup-button-danger {
        background: #fff1f2;
        border-color: #fecdd3;
        color: #be123c;
        box-shadow: 0 10px 22px rgba(190, 18, 60, 0.08);
      }

      .app-popup-button-danger:hover {
        background: #ffe4e6;
        border-color: #fda4af;
        color: #9f1239;
        box-shadow: 0 14px 26px rgba(190, 18, 60, 0.12);
      }

      .app-popup-button:focus-visible {
        outline: 3px solid rgba(37, 99, 235, 0.24);
        outline-offset: 2px;
      }

      @media (max-width: 560px) {
        .app-popup-card {
          width: calc(100vw - 28px);
          max-width: calc(100vw - 28px);
          border-radius: 22px;
        }

        #app-popup-root .app-popup-card {
          width: calc(100vw - 28px) !important;
          max-width: calc(100vw - 28px) !important;
        }

        .app-popup-header {
          padding: 22px 22px 10px;
        }

        .app-popup-message,
        .app-popup-field-wrap {
          padding-left: 22px;
          padding-right: 22px;
        }

        .app-popup-actions {
          padding: 0 22px 22px;
        }
      }

      button.app-action-busy,
      .app-action-busy {
        position: relative;
        pointer-events: none !important;
        opacity: 0.72 !important;
        cursor: wait !important;
        filter: saturate(0.9);
      }

      button.app-action-busy::after {
        content: "";
        width: 12px;
        height: 12px;
        margin-left: 8px;
        display: inline-block;
        vertical-align: -1px;
        border: 2px solid currentColor;
        border-right-color: transparent;
        border-radius: 999px;
        animation: appButtonSpin 650ms linear infinite;
      }

      @keyframes appPopupFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes appPopupScaleIn {
        from { opacity: 0; transform: translateY(8px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      @keyframes appButtonSpin {
        to { transform: rotate(360deg); }
      }

      .password-toggle-wrap {
        position: relative;
        display: block;
        flex: 1 1 auto;
        min-width: 0;
        width: 100%;
      }

      .password-toggle-wrap input[type="password"],
      .password-toggle-wrap input[type="text"] {
        width: 100% !important;
        padding-right: 48px !important;
        box-sizing: border-box;
      }

      .password-toggle-wrap.incorrect input {
        border-color: #ef4444 !important;
      }

      button.password-visibility-toggle,
      .password-visibility-toggle {
        position: absolute;
        top: 50%;
        right: 10px;
        width: 34px !important;
        min-width: 34px !important;
        height: 34px !important;
        min-height: 34px !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 999px !important;
        background: transparent !important;
        color: #2e2841 !important;
        display: grid;
        place-items: center;
        transform: translateY(-50%);
        cursor: pointer;
        box-shadow: none !important;
        font: inherit !important;
        line-height: 1 !important;
        text-transform: none !important;
        transition: background 140ms ease, color 140ms ease, transform 140ms ease;
      }

      button.password-visibility-toggle:hover,
      .password-visibility-toggle:hover {
        background: rgba(37, 99, 235, 0.1) !important;
        color: #167bba !important;
        transform: translateY(-50%) scale(1.04);
        border: 0 !important;
        box-shadow: none !important;
      }

      button.password-visibility-toggle:focus-visible,
      .password-visibility-toggle:focus-visible {
        outline: 2px solid rgba(37, 99, 235, 0.42);
        outline-offset: 2px;
      }

      .password-visibility-toggle svg {
        width: 20px;
        height: 20px;
        stroke: currentColor;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureRoot() {
    let root = document.getElementById(POPUP_ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = POPUP_ROOT_ID;
      document.body.appendChild(root);
    }
    return root;
  }

  function closeActivePopup(value) {
    if (!activePopup) return;
    const { backdrop, resolve } = activePopup;
    activePopup = null;
    backdrop.remove();
    resolve(value);
    showNextPopup();
  }

  function showNextPopup() {
    if (activePopup || queue.length === 0 || !document.body) return;

    ensureStyles();
    const root = ensureRoot();
    const item = queue.shift();
    const message = item.message || '';
    const isConfirm = item.type === 'confirm';
    const isPrompt = item.type === 'prompt';
    const title = item.title || (isConfirm ? 'Please confirm' : isPrompt ? 'Enter a value' : 'Notice');

    const backdrop = document.createElement('div');
    backdrop.className = 'app-popup-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.innerHTML = `
      <div class="app-popup-card">
        <div class="app-popup-header">
          <div class="app-popup-icon" aria-hidden="true">!</div>
          <h2 class="app-popup-title"></h2>
        </div>
        <p class="app-popup-message"></p>
        ${isPrompt ? '<div class="app-popup-field-wrap"><input class="app-popup-input" type="text"></div>' : ''}
        <div class="app-popup-actions">
          ${isConfirm || isPrompt ? '<button class="app-popup-button app-popup-button-secondary" type="button" data-action="cancel">Cancel</button>' : ''}
          <button class="app-popup-button app-popup-button-confirm" type="button" data-action="ok">${isConfirm ? 'Confirm' : isPrompt ? 'Save' : 'OK'}</button>
        </div>
      </div>
    `;

    backdrop.querySelector('.app-popup-title').textContent = title;
    backdrop.querySelector('.app-popup-message').textContent = message;
    const input = backdrop.querySelector('.app-popup-input');
    if (input) input.value = item.defaultValue || '';
    const okButton = backdrop.querySelector('[data-action="ok"]');
    const cancelButton = backdrop.querySelector('[data-action="cancel"]');
    okButton.addEventListener('click', () => {
      if (isConfirm) {
        closeActivePopup(true);
      } else if (isPrompt) {
        closeActivePopup(input.value);
      } else {
        closeActivePopup();
      }
    });
    cancelButton?.addEventListener('click', () => {
      closeActivePopup(isConfirm ? false : null);
    });
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) {
        closeActivePopup(isConfirm ? false : isPrompt ? null : undefined);
      }
    });

    activePopup = { backdrop, resolve: item.resolve };
    root.appendChild(backdrop);
    (input || okButton).focus({ preventScroll: true });
  }

  document.addEventListener('keydown', (event) => {
    if (!activePopup) return;
    const isPrompt = activePopup.backdrop.querySelector('.app-popup-input');
    const isConfirm = activePopup.backdrop.querySelector('[data-action="cancel"]') && !isPrompt;
    if (event.key === 'Escape') {
      closeActivePopup(isConfirm ? false : isPrompt ? null : undefined);
    }
    if (event.key === 'Enter') {
      if (isConfirm) closeActivePopup(true);
      else if (isPrompt) closeActivePopup(isPrompt.value);
      else closeActivePopup();
    }
  });

  window.appAlert = function appAlert(message) {
    return new Promise((resolve) => {
      queue.push({ type: 'alert', message: String(message ?? ''), resolve });
      showNextPopup();
    });
  };

  window.appConfirm = function appConfirm(message, options = {}) {
    return new Promise((resolve) => {
      queue.push({
        type: 'confirm',
        message: String(message ?? ''),
        title: options.title,
        resolve
      });
      showNextPopup();
    });
  };

  window.appPrompt = function appPrompt(message, defaultValue = '', options = {}) {
    return new Promise((resolve) => {
      queue.push({
        type: 'prompt',
        message: String(message ?? ''),
        defaultValue: String(defaultValue ?? ''),
        title: options.title,
        resolve
      });
      showNextPopup();
    });
  };

  let lastActionButton = null;
  let lastActionButtonAt = 0;

  function getActionButton(trigger) {
    if (trigger?.currentTarget) return getActionButton(trigger.currentTarget);
    if (trigger?.target) return getActionButton(trigger.target);
    if (typeof trigger === 'string') return document.querySelector(trigger);
    if (trigger instanceof HTMLButtonElement) return trigger;
    if (trigger instanceof HTMLElement) return trigger.closest('button, [role="button"], input[type="submit"], input[type="button"]');
    if (lastActionButton && Date.now() - lastActionButtonAt < 1000) return lastActionButton;
    return document.activeElement instanceof HTMLElement
      ? document.activeElement.closest('button, [role="button"], input[type="submit"], input[type="button"]')
      : null;
  }

  function setActionBusy(button, busy) {
    if (!button) return;
    if (busy) {
      button.dataset.appBusy = 'true';
      button.setAttribute('aria-busy', 'true');
      button.classList.add('app-action-busy');
      if ('disabled' in button) {
        button.dataset.appWasDisabled = button.disabled ? 'true' : 'false';
        button.disabled = true;
      }
      return;
    }

    delete button.dataset.appBusy;
    button.removeAttribute('aria-busy');
    button.classList.remove('app-action-busy');
    if ('disabled' in button && button.dataset.appWasDisabled !== 'true') {
      button.disabled = false;
    }
    delete button.dataset.appWasDisabled;
  }

  window.withButtonLock = async function withButtonLock(trigger, task, options = {}) {
    const button = getActionButton(trigger);
    if (button?.dataset.appBusy === 'true') return undefined;

    setActionBusy(button, true);
    try {
      return await task();
    } finally {
      if (!options.keepDisabled) {
        setActionBusy(button, false);
      }
    }
  };

  const eyeIcon = `
    <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>`;
  const eyeOffIcon = `
    <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 3l18 18"></path>
      <path d="M10.6 10.6A2 2 0 0 0 12 14a2 2 0 0 0 1.4-.6"></path>
      <path d="M9.9 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18.2 18.2 0 0 1-3.2 4.1"></path>
      <path d="M6.6 6.6C3.6 8.6 2 12 2 12s3.5 7 10 7c1.4 0 2.7-.3 3.8-.8"></path>
    </svg>`;

  function setupPasswordVisibility() {
    ensureStyles();
    document.querySelectorAll('input[type="password"]').forEach((input) => {
      if (input.dataset.passwordToggleReady === 'true') return;
      input.dataset.passwordToggleReady = 'true';

      const wrapper = document.createElement('span');
      wrapper.className = 'password-toggle-wrap';
      input.parentNode.insertBefore(wrapper, input);
      wrapper.appendChild(input);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'password-visibility-toggle';
      toggle.setAttribute('aria-label', 'Show password');
      toggle.innerHTML = eyeIcon;
      wrapper.appendChild(toggle);

      toggle.addEventListener('click', () => {
        const shouldShow = input.type === 'password';
        input.type = shouldShow ? 'text' : 'password';
        toggle.setAttribute('aria-label', shouldShow ? 'Hide password' : 'Show password');
        toggle.innerHTML = shouldShow ? eyeOffIcon : eyeIcon;
        input.focus();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupPasswordVisibility);
  } else {
    setupPasswordVisibility();
  }

  document.addEventListener('click', (event) => {
    const button = getActionButton(event.target);
    if (!button) return;
    if (button.dataset.appBusy === 'true') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    lastActionButton = button;
    lastActionButtonAt = Date.now();
  }, true);

  document.addEventListener('submit', (event) => {
    if (event.submitter) {
      lastActionButton = event.submitter;
      lastActionButtonAt = Date.now();
    }
  }, true);

  window.alert = function alert(message) {
    window.appAlert(message);
  };
})();
