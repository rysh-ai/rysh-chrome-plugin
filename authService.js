// authService.js — auth service for rysh-server backed Chrome plugin.
// Uses server API keys (issued from the rysh web dashboard).

import { storage } from './storage.js';

const DEFAULT_SERVER_URL = 'https://rysh.ai';

class AuthService {
  constructor() {
    this._listeners  = [];
    this._currentUser = null;
    this._initialized = false;
  }

  async initialize() {
    if (this._initialized) return this._currentUser;
    const token  = await storage.get('auth_token');
    const user   = await storage.get('auth_user');
    if (token && user) {
      this._currentUser = user;
    }
    this._initialized = true;
    return this._currentUser;
  }

  get currentUser() { return this._currentUser; }

  async isAuthenticated() {
    await this.initialize();
    return this._currentUser !== null;
  }

  // Returns the stored API key.
  async getToken() {
    return storage.get('auth_token');
  }

  async getServerURL() {
    const url = await storage.get('server_url');
    return url || DEFAULT_SERVER_URL;
  }

  async getCurrentUser() {
    await this.initialize();
    return this._currentUser;
  }

  // Mirrors firebase.auth().onAuthStateChanged(callback).
  // Returns an unsubscribe function.
  onAuthStateChanged(callback) {
    this._listeners.push(callback);
    this.getCurrentUser().then(user => callback(user));
    return () => {
      this._listeners = this._listeners.filter(l => l !== callback);
    };
  }

  async signOut() {
    await storage.remove(['auth_token', 'auth_user', 'auth_time', 'server_url']);
    this._currentUser = null;
    this._notify(null);
  }

  // Sign in with a Rysh server API key.
  // serverURL: the rysh server base URL (e.g. "https://rysh.ai")
  // apiKey: a server-issued API key (from the rysh web dashboard)
  async signInWithServerKey(serverURL, apiKey) {
    const url = (serverURL || DEFAULT_SERVER_URL).trim().replace(/\/$/, '');
    const key = (apiKey || '').trim();
    if (!key) throw new Error('API key is required');
    if (!url) throw new Error('Server URL is required');

    // Verify the key works by probing the health endpoint.
    try {
      const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
    } catch (err) {
      throw new Error(`Cannot reach server at ${url}: ${err.message}`);
    }

    const user = {
      uid:         'api-key-user',
      displayName: 'API Key User',
      email:       '',
      provider:    'api-key',
    };

    await storage.set({
      auth_token:  key,
      auth_user:   user,
      auth_time:   Date.now(),
      server_url:  url,
    });

    this._currentUser = user;
    this._notify(user);
    return user;
  }

  // Alias for backward compat — uses stored server URL or default.
  async signInWithApiKey(apiKey) {
    const serverURL = await this.getServerURL();
    return this.signInWithServerKey(serverURL, apiKey);
  }

  _notify(user) {
    this._listeners.forEach(cb => cb(user));
  }
}

export const authService = new AuthService();
export default authService;
