# Arduron Data Labeling

A cross-platform data labeling application for computer vision, similar to Roboflow. Built with Tauri, React, and TypeScript.

## Quick Start

### Prerequisites

⚠️ **Important**: Requires Node.js 18 or 20 LTS (not Node 24+)

```bash
# Check your Node version
node --version

# If using nvm:
nvm install 18
nvm use 18
```

### Installation

```bash
# Install dependencies
npm install

# Create Python virtual environment (for AI features)
python3 -m venv .venv
source .venv/bin/activate
pip install -r python/requirements.txt
```

### Running

```bash
# Start development mode (Tauri + Vite)
npm run dev

# Or web-only mode (no filesystem access)
npm run dev:web
```

### Building

```bash
npm run build
```

## Features

- Project-based image management
- Import images or folders
- Bounding box annotation
- Zoom and pan canvas
- SQLite database persistence
- YOLO format export

## Documentation

See [SETUP.md](./SETUP.md) for detailed setup instructions and troubleshooting.

## Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS, Konva
- **Desktop**: Tauri 2.x (Rust)
- **Database**: SQLite (rusqlite)
- **AI Backend**: Python, PyTorch, Ultralytics
