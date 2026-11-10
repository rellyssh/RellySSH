# Contributing to RellySSH 🤝

Thank you for your interest in contributing to **RellySSH**! We are committed to building the best open-source, lightweight, and truly private SSH client in the world.

Whether you're fixing bugs, adding new features, improving documentation, or designing UI themes, your contributions are warmly welcome.

---

## 🧭 Code of Conduct

RellySSH is an open, welcoming, and inclusive community. Please treat all contributors and users with respect, patience, and kindness.

---

## 🛠️ Development Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18 or newer recommended)
- `npm`, `pnpm`, or `yarn`
- A C/C++ compiler toolchain (required by `node-pty` and native `argon2` modules during install):
  - **Linux**: `build-essential`, `python3`
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio C++ Build Tools or `windows-build-tools`

### Installation Steps

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/<your-username>/RellySSH.git
   cd RellySSH
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```
   This will launch Vite with HMR along with the Electron main window.

---

## 📐 Project Structure

```
RellySSH/
├── electron/              # Electron Main Process & Native Modules
│   ├── main.ts            # Application lifecycle & IPC registration
│   ├── preload.ts         # Secure ContextBridge isolation layer
│   ├── crypto.ts          # Argon2id + AES-256-GCM vault implementation
│   ├── ssh.ts             # Remote SSH terminal session driver (ssh2)
│   └── localTerminal.ts   # Local shell emulator backend (node-pty)
├── src/                   # React Frontend (Renderer Process)
│   ├── components/        # Radix UI components (Unlock, Modals, Terminal)
│   ├── App.tsx            # Main workspace & layout container
│   ├── types.ts           # Shared TypeScript interfaces
│   └── index.css          # Global styling & terminal theme adjustments
├── docs/                  # Architecture & Security Documentation
└── package.json
```

---

## 🔒 Security Guidelines

Because RellySSH handles private cryptographic keys, master passwords, and server credentials, please follow these core tenets:

1. **Never send telemetry or credentials outside the local machine.**
2. **Never log secrets or private keys** to standard output or the browser console.
3. **Preserve Vault backward compatibility**: Never break the ability to open previous vault revisions.
4. **Context Isolation**: Never enable `nodeIntegration` in renderer windows. All native functionality must pass through sanitized IPC channels in `electron/preload.ts`.

---

## 📝 Submitting Pull Requests

1. **Create a branch** for your feature or fix:
   ```bash
   git checkout -b feature/my-cool-feature
   ```
2. **Commit your changes**:
   Write clear and descriptive commit messages following Conventional Commits (e.g., `feat: add quick search bar`, `fix: handle terminal resize on split view`).
3. **Verify compilation**:
   ```bash
   npm run build
   ```
4. **Push and open a PR** against the `main` branch. Provide a concise description of the changes and any screenshots if UI modifications were made.

---

## ⭐ Star the Repo!
If you like what we're building, giving the repository a star on GitHub helps the project reach more developers looking for a free, transparent alternative!
