import React, { useEffect, useState } from 'react';
import { authService } from './services/auth';
import { apiService }  from './services/api';
import { useStore }    from './store';
import SetupScreen     from './components/SetupScreen';
import ChatScreen      from './components/ChatScreen';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const setConnected = useStore(s => s.setConnected);
  const setPaneID    = useStore(s => s.setPaneID);
  const setErrorMessage = useStore(s => s.setErrorMessage);

  useEffect(() => {
    // Load server URL override from storage (sets the base URL before any requests).
    apiService.loadServerURL();

    const unsub = authService.onAuthStateChanged(async user => {
      if (user) {
        setIsAuthenticated(true);
        const token = await authService.getToken();
        if (token) {
          try {
            const id = await apiService.ensurePane(token);
            setPaneID(id);
            setConnected(true);
          } catch (err) {
            setErrorMessage('Could not connect to Rysh server: ' + (err as Error).message);
          }
        }
      } else {
        setIsAuthenticated(false);
        setConnected(false);
        setPaneID(null);
      }
    });

    return unsub;
  }, []);

  // Auth state not yet resolved — show a minimal spinner.
  if (isAuthenticated === null) {
    return (
      <div className="w-full h-full bg-bg flex items-center justify-center">
        <div className="flex gap-1.5">
          <div className="loading-dot" />
          <div className="loading-dot" />
          <div className="loading-dot" />
        </div>
      </div>
    );
  }

  return isAuthenticated ? <ChatScreen /> : <SetupScreen />;
}
