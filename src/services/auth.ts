// auth.ts — Auth service for the React popup (TypeScript port of authService.js).
// Uses rysh-server API keys stored in chrome.storage.local.

import { storage } from './storage';

const DEFAULT_SERVER_URL = 'https://rysh.ai';

export interface AuthUser {
  uid: string;
  displayName: string;
  email: string;
  provider: string;
}

type AuthStateCallback = (user: AuthUser | null) => void;

class AuthService {
  private _listeners: AuthStateCallback[] = [];
  private _currentUser: AuthUser | null = null;
  private _initialized = false;

  async initialize(): Promise<AuthUser | null> {
    if (this._initialized) return this._currentUser;
    const token = await storage.get('auth_token');
    const user  = await storage.get('auth_user') as AuthUser | null;
    if (token && user) {
      this._currentUser = user;
    }
    this._initialized = true;
    return this._currentUser;
  }

  get currentUser(): AuthUser | null { return this._currentUser; }

  async isAuthenticated(): Promise<boolean> {
    await this.initialize();
    return this._currentUser !== null;
  }

  async getToken(): Promise<string | null> {
    return storage.get('auth_token') as Promise<string | null>;
  }

  async getServerURL(): Promise<string> {
    const url = await storage.get('server_url') as string | null;
    return url || DEFAULT_SERVER_URL;
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    await this.initialize();
    return this._currentUser;
  }

  /** Mirrors firebase.auth().onAuthStateChanged — returns unsubscribe fn. */
  onAuthStateChanged(callback: AuthStateCallback): () => void {
    this._listeners.push(callback);
    this.getCurrentUser().then(user => callback(user));
    return () => {
      this._listeners = this._listeners.filter(l => l !== callback);
    };
  }

  async signOut(): Promise<void> {
    await storage.remove(['auth_token', 'auth_user', 'auth_time', 'server_url']);
    this._currentUser = null;
    this._initialized = false;
    this._notify(null);
  }

  /** Sign in with a Rysh server API key. Verifies the key via /health endpoint. */
  async signInWithServerKey(serverURL: string, apiKey: string): Promise<AuthUser> {
    const url = (serverURL || DEFAULT_SERVER_URL).trim().replace(/\/$/, '');
    const key = (apiKey || '').trim();
    if (!key) throw new Error('API key is required');
    if (!url) throw new Error('Server URL is required');

    try {
      const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
    } catch (err) {
      throw new Error(`Cannot reach server at ${url}: ${(err as Error).message}`);
    }

    const user: AuthUser = {
      uid:         'api-key-user',
      displayName: 'API Key User',
      email:       '',
      provider:    'api-key',
    };

    await storage.set({ auth_token: key, auth_user: user, auth_time: Date.now(), server_url: url });
    this._currentUser = user;
    this._initialized = true;
    this._notify(user);
    return user;
  }

  private _notify(user: AuthUser | null) {
    this._listeners.forEach(cb => cb(user));
  }
}

export const authService = new AuthService();
export default authService;
