# Rysh AI — Chrome Extension

A browser-integrated AI chat assistant powered by the Anthropic API. Talk to Claude directly from your browser toolbar.

## Features

- Dark, polished chat UI accessible from the browser toolbar
- Direct Anthropic API calls (no server proxy)
- Conversation history maintained for the session
- Page context injection (title, URL, selected text)
- Firebase-ready auth stub — swap one file to add Google sign-in

## Getting Started

### 1. Generate icons

```bash
cd rysh-chrome-plugin/icons
node generate-icons.js
```

### 2. Load the extension in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right)
3. Click **Load unpacked**
4. Select the `rysh-chrome-plugin/` directory

### 3. Authorize

On first install, a tab opens automatically asking for your Anthropic API key.
Get a key from [console.anthropic.com](https://console.anthropic.com/settings/keys).

## Project Structure

```
rysh-chrome-plugin/
├── manifest.json        Chrome extension manifest (MV3)
├── background.js        Service worker — install handler, message bus
├── popup.html/css/js    Chat interface (380×600px dark UI)
├── auth.html/css/js     API key authorization page
├── authService.js       Firebase-ready auth stub
├── api.js               Anthropic Messages API client
├── storage.js           chrome.storage.local wrapper
└── icons/
    ├── generate-icons.js  Node.js PNG generator (no deps)
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Auth Architecture

`authService.js` mirrors the Firebase Auth interface (`onAuthStateChanged`, `signOut`, `getToken`, `getCurrentUser`). When Firebase is ready:

1. Replace `authService.js` with a Firebase implementation
2. `popup.js` and `auth.js` require **no changes**

## Development

No build step required — the extension runs directly from source using ES modules.

For bundled production builds, add esbuild or Rollup targeting `"chrome"`.

## Privacy

- Your API key is stored only in `chrome.storage.local` on your device
- API calls go directly from your browser to `api.anthropic.com`
- No data is routed through Rysh servers

## License

MIT © Rysh
