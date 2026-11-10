<div align="center">

# ⚡ RellySSH

### **The Modern, Free & Open-Source SSH Client You Actually Own.**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/rellyssh/RellySSH?style=flat-square&color=yellow)](https://github.com/rellyssh/RellySSH/stargazers)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-Desktop-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Support on Cafecito](https://img.shields.io/badge/Support%20on-Cafecito-orange?style=flat-square&logo=coffeescript)](https://cafecito.app/rellyssh)

<p align="center">
  <b>Tired of paid subscriptions, bloated cloud locks, and clunky terminals?</b><br>
  RellySSH combines lightning-fast local and remote terminal management with military-grade, portable <code>.vault</code> encryption.
</p>

[**Features**](#-features) •
[**Why Not Termius or XPipe?**](#-why-rellyssh-over-the-alternatives) •
[**Security Architecture**](#-vault-security--zero-knowledge) •
[**Quick Start**](#-quick-start) •
[**Support & Cafecito**](#-support-the-project)

---

</div>

## 💡 Why RellySSH Over the Alternatives?

Are you fed up with the current state of SSH clients? So were we.

| Feature / Aspect | **RellySSH** | **Termius** | **XPipe** |
| :--- | :---: | :---: | :---: |
| **Pricing** | **100% Free Forever (GPLv3)** | Expensive Monthly Subscriptions (~$10+/mo) | Tiered / Paid Editions |
| **Source Code** | **Fully Open Source** | Proprietary & Closed Source | Source-available / Dual License |
| **Cloud Dependency** | **Zero Cloud Lock-in (Local-First)** | Mandatory Cloud Accounts for sync | Complex desktop daemon dependencies |
| **Credential Storage** | **Hardware-hardened Argon2id + AES-256-GCM** | Third-party cloud servers | Local config / varying security |
| **Performance & Weight** | **Clean, minimal, fast start** | Heavy background services & telemetry | Java/JavaFX overhead & complex install |
| **Sync Freedom** | **Sync `.vault` files anywhere (Git, Drive, Nextcloud)** | Locked to Termius cloud | Custom sync schemes |
| **Telemetry & Trackers** | **0% Trackers, 100% Privacy** | Invasive tracking & analytics | Community concerns regarding telemetry |

> *"Stop paying \$120 a year just to SSH into your own VPS. RellySSH gives you ultimate power, sleek design, and total sovereignty over your server keys."*

---

## ✨ Features

- 🔐 **Zero-Knowledge Encrypted Vault (`.vault`)**:
  - Secure your hosts, SSH private keys (RSA, Ed25519), passwords, and passphrases in a standalone, portable file.
  - Powered by **Argon2id (RFC 9106)** and **AES-256-GCM** with a Two-Tier KEK/DEK architecture.
  - Safe to commit to a private GitHub repo, Dropbox, or Syncthing.
- ⚡ **Native-Grade Terminal Experience**:
  - Powered by `xterm.js` with full 256-color support, clipboard integration, and dynamic window resizing.
  - Seamlessly switch between remote **SSH sessions** and **Local terminals** (bash, zsh, PowerShell).
- 🎨 **Minimal & Modern Aesthetic**:
  - Built with **Radix UI Themes** and **Lucide Icons** — clean typography, sleek dark mode, and zero clutter.
- 🔄 **Non-Destructive Vault Migrations**:
  - Seamlessly opens older format vaults (V1 PBKDF2) and upgrades them safely to V2 (Argon2id) with atomic backups and validation before write.
- 🛡️ **Tunable Security Profiles**:
  - Choose between **Standard** (2s calibration), **Strong** (5s), and **Maximum Brute-Force Resistance** (10s target derivational complexity).
- 🌐 **True Cross-Platform**:
  - Runs natively on **Linux**, **macOS**, and **Windows**.

---

## 🔒 Vault Security & Zero-Knowledge

RellySSH does not have backend servers, databases, or cloud accounts. **Your keys belong to you.**

```
Master Password ──> Argon2id (RFC 9106, 64-256 MiB RAM) ──> KEK (Key Encryption Key)
                                                                │
                                    ┌───────────────────────────┴──────────────────────────┐
                                    ▼                                                      ▼
                       [Wrapped DEK in AES-256-GCM]                       [Encrypted Payload: Servers & Keys]
```

- **Two-Tier DEK/KEK Architecture**: Change your master password in milliseconds without re-encrypting your entire database of servers and keys.
- **ASIC / GPU Resistance**: Argon2id demands physical memory (64 to 256 MiB), rendering brute-force cracking clusters economically unviable.
- **Atomic File Operations**: Upgrades and file writes are executed via staging files with integrity pre-verification. Your original vault is never corrupted.

Read our complete [Architecture & Security Specification](docs/ARCHITECTURE.md).

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (>= 18.0)
- `npm` or `pnpm`

### Installation

```bash
# Clone the repository
git clone https://github.com/rellyssh/RellySSH.git
cd RellySSH

# Install dependencies
npm install

# Run in development mode (with Hot Module Replacement)
npm run dev
```

### Production Build

```bash
# Compile TypeScript & Package Electron bundles
npm run build
```

---

## 🤝 Contributing

We welcome contributions of all kinds! Whether it's reporting an issue, proposing an SFTP browser, or adding a new theme:

1. Read our [Contributing Guide](CONTRIBUTING.md).
2. Check out our open issues or submit a pull request.
3. Help us spread the word and grow the community!

---

## ☕ Support the Project

RellySSH is independent, open-source software built for the developer community under the **GNU General Public License v3.0**.

If RellySSH saves you from paying subscription fees or makes your sysadmin life easier, please consider supporting its ongoing development:

<div align="center">

[![Support on Cafecito](https://img.shields.io/badge/Support%20on-Cafecito-orange?style=for-the-badge&logo=coffeescript)](https://cafecito.app/rellyssh)

**[👉 Buy us a coffee on Cafecito (cafecito.app/rellyssh)](https://cafecito.app/rellyssh)**

Your support funds:
- 🚀 Development of new features (SFTP file manager, port forwarding, terminal tabs).
- 🐛 Continuous bug fixes, OS platform testing & cryptographic auditing.
- 🐧 First-class Linux, Windows, and macOS packaging (.deb, .rpm, .AppImage, .exe, .dmg).

</div>

---

## ⭐ Star History

If you love what we are building, please **leave a star ⭐** on this repo! It costs nothing and directly helps RellySSH stand up against proprietary paid tools.

---

## 📄 License

RellySSH is distributed under the **GNU General Public License v3.0 or later** (GPL-3.0-or-later). See [LICENSE](LICENSE) for complete details.

*RellySSH — Your servers. One secure place.*
