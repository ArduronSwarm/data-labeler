# Arduron Data Labeling - AI Agent Instructions

## Project Architecture

**Desktop Framework:** Tauri 2.x (Rust backend) + Python sidecar for ML inference
- **Note:** Electron codebase exists in `/electron` but is deprecated (macOS compatibility issues)
- Python CLI scripts for ML inference (`python/predict.py`)

**Technology Stack:**
- **Frontend:** React 18 + TypeScript + Vite + react-konva (canvas)
- **Desktop:** Tauri 2.x (Rust) with SQLite, dialog, shell, fs plugins
- **AI Backend:** Python 3.9+ (PyTorch, Ultralytics YOLO/SAM)
- **Database:** SQLite with WAL mode for concurrent access
- **Styling:** Tailwind CSS + shadcn/ui components

## Critical Developer Workflows

### Running the Application
```bash
# Primary: Tauri development mode
npm run dev  # Starts Vite + Tauri together (sources cargo env automatically)

# Web-only testing (no filesystem access)
npm run dev:web

# Build production (.app and .dmg)
npm run build
```

**Note:** npm scripts automatically source `~/.cargo/env` to ensure cargo is in PATH.

### Python Environment Setup
```bash
# ALWAYS activate venv before Python operations
python3 -m venv .venv
source .venv/bin/activate  # macOS/Linux
pip install -r python/requirements.txt
```

### Node Version Requirement
**CRITICAL:** Requires Node.js 18 or 20 LTS (NOT v24+). Use nvm to switch:
```bash
nvm use 18
```

### Testing Python Backend Standalone
```bash
# Test SAM model
python python/test_sam.py

# Test YOLO inference (CLI)
python python/predict.py yolo /path/to/image.jpg

# Verify backend communication
python python/verify_backend.py
```

## Data Flow & Architecture Patterns

### Backend Communication (Tauri ↔ Rust ↔ Python)

**Frontend → Rust Commands:**
```typescript
// All DB operations go through Tauri commands
import { invoke } from '@tauri-apps/api/core';

// Available commands (see src-tauri/src/commands.rs):
// Project management
// - get_project, get_all_projects, create_project
// Image management
// - get_images, add_image, add_images (with dimension extraction)
// Annotation CRUD
// - get_annotations, save_annotation, delete_annotation
// Workflow
// - update_image_status, auto_split_dataset, export_dataset
// AI features
// - run_yolo_detection (spawns Python predict.py)
// Validation
// - validate_project (checks dimensions, files, overlaps)
// Python server
// - start_python_server, stop_python_server
```

**Rust → Python (CLI wrapper):**
```bash
# YOLO detection via predict.py
python python/predict.py yolo /path/to/image.jpg
# Returns JSON: {"detections": [{"class_id": 0, "confidence": 0.85, "bbox": [...]}]}
```

### Database Schema (SQLite)

**Tables:**
- `projects`: id, name, ontology (JSON), created_at
- `images`: id, project_id, file_path, width, height, status, split_set
- `annotations`: id, image_id, label_id, geometry_type, coordinates (JSON), source

**Status Values:** UNLABELED, LABELED, VERIFIED  
**Split Sets:** TRAIN, VAL, TEST  
**Sources:** manual, model

### Canvas Coordinate System (react-konva)

**Critical Pattern:** All mouse events must transform screen coordinates → image coordinates:
```typescript
const getRelativePointerPosition = (node: Konva.Node) => {
  const transform = node.getAbsoluteTransform().copy();
  transform.invert();
  const pos = node.getStage()?.getPointerPosition();
  return pos ? transform.point(pos) : null;
};
```

**Layer Architecture** (see src/components/canvas/):
- `BackgroundLayer`: Renders source image (cached bitmap)
- `ActiveLayer`: User's current drawing/editing state
- Annotations stored in image coordinates, displayed with transform

**Zoom Invariance:** Stroke widths scale inversely: `strokeWidth = baseWidth / stageScale`

## Project-Specific Conventions

### File Organization
- `src-tauri/src/`: Rust backend (commands, database)
- `python/`: ML inference scripts (predict.py, model_manager.py)
- `src/components/canvas/`: Canvas rendering components
- `src/components/ClassSelector.tsx`: Class/ontology management UI
- `src/lib/tauri-commands.ts`: TypeScript type-safe API wrappers

### Database Access Pattern
**Never access DB directly from frontend.** Always:
1. Define Rust command in `src-tauri/src/commands.rs`
2. Register in `src-tauri/src/lib.rs` invoke_handler
3. Add TypeScript wrapper in `src/lib/tauri-commands.ts`

### Python Model Loading
**Device Priority:** CUDA > MPS (Apple Silicon) > CPU
```python
device = 'cuda' if torch.cuda.is_available() else 'cpu'
if device == 'cpu' and torch.backends.mps.is_available():
    device = 'mps'
```

**Model Files:** Place in project root (mobile_sam.pt, yolo11n.pt)

### State Management Pattern
- React useState for UI state
- Tauri commands for persistence
- No global state library (Redux/Zustand) - keep simple
- Canvas state lives in CanvasStage component

## Implemented Features

### Core Features ✅
- **Project Management:** Create, load, save projects with ontology
- **Image Import:** File picker dialog, dimension extraction
- **Annotation Drawing:** Bounding boxes with class assignment
- **Image Navigation:** Prev/Next with arrow keys, navigation bar
- **Annotation Management:** Select, delete, keyboard shortcuts
- **Class Management:** Add/edit classes with colors
- **YOLO Export:** Normalized coordinates, train/val/test splits

### AI Features ✅
- **Auto-Detect:** YOLO inference via Python CLI
- **Python Server:** Start/stop lifecycle management

### Validation & QA ✅
- **Project Validation:** Missing dimensions, files, overlapping annotations (IoU)
- **Stratified Splitting:** Groups video frames by filename prefix

### Keyboard Shortcuts
- `←/→`: Navigate images
- `Delete/Backspace`: Delete selected annotation
- `Escape`: Deselect annotation
- `Ctrl/Cmd+S`: Save project
- `1-9`: Quick class selection

## Integration Points

### Tauri Plugins Used
```rust
// src-tauri/src/lib.rs
.plugin(tauri_plugin_sql::Builder::default().build())
.plugin(tauri_plugin_shell::init())
.plugin(tauri_plugin_dialog::init())
.plugin(tauri_plugin_fs::init())
```

### Python Dependencies
- `torch`: Core ML framework
- `ultralytics`: YOLO and SAM models
- `opencv-python-headless`: Image processing
- `pyzmq`: Inter-process communication

### Export Format
**YOLO Format:** One `.txt` per image with normalized coordinates:
```
<class_id> <x_center> <y_center> <width> <height>
```

## Known Issues & Workarounds

1. **Electron Build Broken on macOS:** Use Tauri (`npm run dev`) instead
2. **Node v24 Incompatible:** Downgrade to Node 18/20
3. **Python Server Lifecycle:** Must send SHUTDOWN signal on app quit to prevent zombie processes
4. **Heartbeat Monitor:** Python server auto-terminates if no PING for 5 seconds

## Development Guidelines

### When Adding Canvas Features
- Update `CanvasStage.tsx` for stage-level logic (zoom, pan)
- Create separate layer components for rendering modes
- Always transform coordinates to image space before saving

### When Adding Database Fields
1. Update `database.rs` struct
2. Modify SQL schema in `Database::new()`
3. Update TypeScript interface in `tauri-commands.ts`
4. Rebuild: `cargo build` (Tauri handles auto-migration)

### When Adding ML Models
1. Update `model_manager.py` with new model type
2. Add model file to project root
3. Update Python requirements if needed
4. Test standalone with test_*.py scripts

### Path Resolution
- **Rust:** Use `app.path().app_data_dir()` for DB location
- **Python:** Models loaded from project root (pwd)
- **Images:** Store absolute paths in DB for cross-platform support

## Quick Reference

**Project Root DB:** `~/Library/Application Support/com.arduron.data-labeling/arduron.db` (macOS)  
**Python Server Port:** 5555  
**Vite Dev Server:** http://localhost:5173  
**Key Config:** `src-tauri/tauri.conf.json`, `vite.config.ts`
