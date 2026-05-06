// auth.js — Auth page controller

import authService from './authService.js';

// ── DOM references ────────────────────────────────────────────────────────────
const apiKeyInput      = document.getElementById('api-key-input');
const toggleVisibility = document.getElementById('toggle-visibility');
const eyeIcon          = document.getElementById('eye-icon');
const eyeOffIcon       = document.getElementById('eye-off-icon');
const authorizeBtn     = document.getElementById('authorize-btn');
const closeBtn         = document.getElementById('close-btn');
const errorAlert       = document.getElementById('error-alert');
const errorMessage     = document.getElementById('error-message');
const formState        = document.getElementById('form-state');
const successState     = document.getElementById('success-state');

// ── Check if already authenticated ───────────────────────────────────────────
authService.onAuthStateChanged(user => {
  if (user) {
    showSuccess();
  }
});

// ── Toggle password visibility ────────────────────────────────────────────────
toggleVisibility.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  eyeIcon.style.display    = isPassword ? 'none'  : '';
  eyeOffIcon.style.display = isPassword ? ''      : 'none';
});

// ── Authorize ─────────────────────────────────────────────────────────────────
authorizeBtn.addEventListener('click', handleAuthorize);
apiKeyInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') handleAuthorize();
});

async function handleAuthorize() {
  const serverURL = 'https://rysh.ai';
  const key = apiKeyInput.value.trim();

  hideError();
  setLoading(true);

  try {
    await authService.signInWithServerKey(serverURL, key);
    showSuccess();
  } catch (err) {
    showError(err.message);
    apiKeyInput.classList.add('error');
    apiKeyInput.focus();
  } finally {
    setLoading(false);
  }
}

// ── Close tab ─────────────────────────────────────────────────────────────────
closeBtn.addEventListener('click', () => {
  window.close();
});

// ── Input error clear ─────────────────────────────────────────────────────────
apiKeyInput.addEventListener('input', () => {
  apiKeyInput.classList.remove('error');
  hideError();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function setLoading(loading) {
  authorizeBtn.disabled = loading;
  authorizeBtn.classList.toggle('loading', loading);
}

function showError(msg) {
  errorMessage.textContent = msg;
  errorAlert.classList.remove('hidden');
}

function hideError() {
  errorAlert.classList.add('hidden');
  errorMessage.textContent = '';
}

function showSuccess() {
  formState.style.display    = 'none';
  successState.classList.add('visible');
}
