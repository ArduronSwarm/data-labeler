# Arduron Data Labeling - Setup Guide

## Technology Stack

This project uses **Tauri 2.x** as the desktop framework, which provides:

- Small bundle size (~3-10MB vs Electron's ~150MB)
- Full filesystem access (needed for local images)
- Can spawn Python processes (for AI/ML inference)
- SQLite integration via rusqlite
- Canvas/WebGL support for image rendering
- Cross-platform (Mac, Windows, Linux)
- Better performance and lower memory usage

**Note**: Previous Electron implementation was removed due to macOS compatibility issues.

---

## Prerequisites

### 1. Node.js (IMPORTANT: Version 18 or 20 LTS)

The current system has Node.js v24 which causes compatibility issues with Electron. You need Node 18 or 20.

#### Option A: Install nvm (Recommended)

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Restart terminal, then:
nvm install 18
nvm use 18

# Verify
node --version  # Should show v18.x.x
```

#### Option B: Install Node 18 directly

Download from: https://nodejs.org/en/download/

### 2. Python 3.9+ (for AI backend)

```bash
# Check Python version
python3 --version

# Should be 3.9 or higher
```

### 3. System Dependencies (macOS)

```bash
# Install Xcode command line tools (for native modules)
xcode-select --install
```

---

## Installation

### Step 1: Clone/Navigate to Project

```bash
cd /Users/javierabdor/projects/data_labeling
```

### Step 2: Install Node.js Dependencies

```bash
# Clean install
rm -rf node_modules package-lock.json

# Install dependencies
npm install
```

### Step 3: Set Up Python Environment

```bash
# Create virtual environment
python3 -m venv .venv

# Activate it
source .venv/bin/activate  # macOS/Linux
# OR
.\.venv\Scripts\activate   # Windows

# Install Python dependencies
pip install -r python/requirements.txt
```

### Step 4: Rebuild Native Modules for Electron

```bash
# Rebuild better-sqlite3 for Electron's Node version
npm rebuild better-sqlite3
```

---

## Running the Application

### Development Mode

Start both Tauri and Vite together:

```bash
npm run dev
```

This automatically:
- Starts the Vite development server
- Compiles the Rust backend
- Launches the Tauri application window

### Web-Only Mode (Optional)

For frontend-only development without Tauri (no filesystem access):

```bash
npm run dev:web
```

Opens at http://localhost:5173 (file dialogs won't work)

### Production Build

```bash
# Build the app
npm run build

# This creates:
# - dist/           (React frontend)
# - src-tauri/target/release/  (Rust binary)
# - src-tauri/target/release/bundle/  (Packaged .app, .dmg, etc.)
```

---

## Project Structure

```
data_labeling/
├── src-tauri/            # Tauri/Rust backend
│   ├── src/
│   │   ├── main.rs      # Rust entry point
│   │   ├── lib.rs       # App setup and plugin registration
│   │   ├── commands.rs  # Tauri command definitions
│   │   └── database.rs  # SQLite operations
│   ├── Cargo.toml       # Rust dependencies
│   └── tauri.conf.json  # Tauri configuration
├── src/                 # React frontend
│   ├── App.tsx          # Main React component
│   ├── components/      # UI components
│   │   └── canvas/      # Annotation canvas
│   └── lib/
│       └── tauri-commands.ts  # Type-safe Tauri API wrappers
├── python/              # Python AI backend
│   ├── main.py          # ZeroMQ server (reference)
│   ├── predict.py       # CLI wrapper for inference
│   ├── model_manager.py # AI model handling
│   └── requirements.txt # Python dependencies
├── .venv/               # Python virtual environment
├── package.json         # Node.js dependencies
└── vite.config.ts       # Vite configuration
```

---

## Troubleshooting

### Cargo not found

**Cause**: Rust/Cargo not installed or not in PATH.

**Solution**:
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Restart terminal or source cargo
source ~/.cargo/env
```

### Build errors with Tauri

**Solution**:
```bash
# Clean build
cd src-tauri
cargo clean
cd ..

# Rebuild
npm run build
```

### Python backend not starting

**Solution**:
```bash
# Make sure venv is activated
source .venv/bin/activate

# Check if ZeroMQ is installed
pip install pyzmq

# Test Python backend
python python/main.py
```

### Tauri window not opening

1. Check if Vite is running (http://localhost:5173)
2. Check Rust console for errors
3. Verify `src-tauri/tauri.conf.json` is valid
4. Ensure Rust and cargo are properly installed

---

## Features

### Current Features
- Project management (SQLite database)
- Image import (file dialog, folder scanning)
- Bounding box annotation
- Zoom and pan controls
- Save/load annotations
- Export to YOLO format

### Planned Features
- [ ] Polygon annotation tool
- [ ] AI-assisted annotation (SAM integration)
- [ ] Class/label management
- [ ] Keyboard shortcuts
- [ ] Undo/redo
- [ ] Dataset splitting (train/val/test)

---

## API Reference

### Tauri Commands (Frontend → Rust Backend)

```typescript
import { invoke } from '@tauri-apps/api/core';

// Project management
await invoke('create_project', { name, ontology });
await invoke('get_project', { id });
await invoke('get_all_projects');

// Image management
await invoke('add_image', { projectId, filePath });
await invoke('add_images', { projectId, filePaths });
await invoke('get_images', { projectId });

// Annotations
await invoke('get_annotations', { imageId });
await invoke('save_annotation', { annotation });
await invoke('delete_annotation', { id });

// Workflow
await invoke('update_image_status', { imageId, status });
await invoke('auto_split_dataset', { projectId, ratios });
await invoke('export_dataset', { projectId, outputPath });

// AI features
await invoke('run_yolo_detection', { imagePath });

// Validation
await invoke('validate_project', { projectId });
```

See `src/lib/tauri-commands.ts` for type-safe wrappers.

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes
4. Test locally
5. Submit pull request

---

## License

Private - Arduron
