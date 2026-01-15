# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Arduron Data Labeling is a desktop application for computer vision data annotation (similar to Roboflow). It uses Tauri 2.x (Rust backend), React frontend with react-konva for canvas rendering, and Python for ML inference (YOLO/SAM models).

**Critical**: Node.js 18 or 20 LTS required (NOT v24+). Use `nvm use 18` if available.

## Common Commands

### Development
```bash
# Start application (Tauri + Vite together)
npm run dev

# Web-only mode (no filesystem access, for UI testing)
npm run dev:web

# Run just Vite dev server
npm run dev:vite

# Lint code
npm run lint
```

### Building
```bash
# Production build (creates .app and .dmg)
npm run build

# Build just frontend
npm run build:vite
```

### Python Environment
```bash
# Setup Python environment (required for AI features)
python3 -m venv .venv
source .venv/bin/activate  # macOS/Linux
pip install -r python/requirements.txt

# Test Python backend standalone
python python/test_sam.py
python python/predict.py yolo /path/to/image.jpg
python python/verify_backend.py
```

### Testing
No automated tests currently exist. Manual testing workflow:
1. Import images via file dialog
2. Draw annotations on canvas
3. Save and reload project
4. Export to YOLO format
5. Verify exported files

## Architecture

### Tech Stack
- **Desktop Framework**: Tauri 2.x (Rust backend)
- **Frontend**: React 18 + TypeScript + Vite
- **Canvas**: react-konva (Konva.js wrapper)
- **Database**: SQLite with WAL mode
- **AI Backend**: Python 3.9+ with PyTorch, Ultralytics (YOLO/SAM)
- **Styling**: Tailwind CSS + shadcn/ui

**Note**: This project was migrated from Electron to Tauri due to macOS compatibility issues. All Electron code has been removed.

### Data Flow Pattern

**Frontend ↔ Rust ↔ Python Communication:**

1. **Frontend → Rust**: All operations use Tauri commands via `invoke()`
   ```typescript
   import { invoke } from '@tauri-apps/api/core';
   await invoke('get_project', { id: 1 });
   ```

2. **Rust → Python**: CLI wrapper pattern (not ZeroMQ)
   ```bash
   python python/predict.py yolo /path/to/image.jpg
   # Returns JSON: {"detections": [...]}
   ```

3. **Database Access**: Never access DB directly from frontend
   - Define Rust command in `src-tauri/src/commands.rs`
   - Register in `src-tauri/src/lib.rs` invoke_handler
   - Add TypeScript wrapper in `src/lib/tauri-commands.ts`

### Directory Structure
```
src-tauri/src/           # Rust backend
  ├── commands.rs        # Tauri command definitions
  ├── database.rs        # SQLite operations
  └── lib.rs             # App initialization, plugin registration

python/                  # ML inference scripts
  ├── predict.py         # CLI entrypoint for YOLO/SAM
  ├── model_manager.py   # Model loading and inference
  └── main.py            # ZeroMQ server (reference, not actively used)

src/                     # React frontend
  ├── App.tsx            # Main component
  ├── components/
  │   ├── canvas/        # Canvas rendering layer
  │   │   ├── CanvasStage.tsx      # Stage-level logic (zoom, pan)
  │   │   ├── BackgroundLayer.tsx   # Image rendering
  │   │   └── ActiveLayer.tsx       # Annotation drawing/editing
  │   └── ClassSelector.tsx         # Class/ontology management
  └── lib/
      ├── tauri-commands.ts         # Type-safe Tauri API wrappers
      └── utils.ts                  # Utilities

Model files (*.pt) are placed in project root
```

### Database Schema (SQLite)

**Location**: `~/Library/Application Support/com.arduron.data-labeling/arduron.db` (macOS)

**Tables:**
- `projects`: id, name, ontology (JSON), created_at
- `images`: id, project_id, file_path, width, height, status, split_set
- `annotations`: id, image_id, label_id, geometry_type, coordinates (JSON), source

**Status Values**: UNLABELED, LABELED, VERIFIED
**Split Sets**: TRAIN, VAL, TEST
**Source**: manual, model

### Available Tauri Commands

See `src-tauri/src/commands.rs` for full list:

**Project Management:**
- `get_project`, `get_all_projects`, `create_project`

**Image Management:**
- `get_images`, `add_image`, `add_images` (extracts dimensions)

**Annotation CRUD:**
- `get_annotations`, `save_annotation`, `delete_annotation`

**Workflow:**
- `update_image_status`, `auto_split_dataset`, `export_dataset`

**AI Features:**
- `run_yolo_detection` (spawns Python predict.py)

**Validation:**
- `validate_project` (checks dimensions, files, overlaps)

**Python Server (legacy/reference):**
- `start_python_server`, `stop_python_server`

## Canvas Coordinate System

**Critical Pattern**: All mouse events must transform screen coordinates → image coordinates.

```typescript
const getRelativePointerPosition = (node: Konva.Node) => {
  const transform = node.getAbsoluteTransform().copy();
  transform.invert();
  const pos = node.getStage()?.getPointerPosition();
  return pos ? transform.point(pos) : null;
};
```

**Layer Architecture:**
- `BackgroundLayer`: Renders source image (cached with `use-image` hook)
- `ActiveLayer`: Current drawing state and existing annotations
- Annotations stored in image coordinates (absolute pixels)
- Display uses stage transform for zoom/pan

**Zoom Invariance**: Stroke widths scale inversely to maintain visual consistency:
```typescript
strokeWidth = baseWidth / stageScale
```

**Zoom Controls:**
- Mouse wheel: zoom to cursor
- Stage draggable: pan when not drawing
- Limits: 0.1x to 20x scale

## Key Conventions

### Coordinate Storage
- **Database**: Annotations stored as JSON string in image coordinates (absolute pixels)
- **Export**: Convert to YOLO normalized format (0-1 range) using image dimensions
- **Canvas**: Transform between screen space ↔ image space using Konva transforms

### State Management
- React useState for UI state (no Redux/Zustand)
- Tauri commands for all persistence
- Canvas state lives in CanvasStage component

### Python Model Loading
**Device Priority**: CUDA > MPS (Apple Silicon) > CPU
```python
device = 'cuda' if torch.cuda.is_available() else 'cpu'
if device == 'cpu' and torch.backends.mps.is_available():
    device = 'mps'
```

**Model Files**: Place `.pt` files in project root (e.g., `mobile_sam.pt`, `yolo11n.pt`)

### Keyboard Shortcuts
- `←/→`: Navigate images
- `Delete/Backspace`: Delete selected annotation
- `Escape`: Deselect annotation
- `Ctrl/Cmd+S`: Save project (if implemented)
- `1-9`: Quick class selection

## Implemented Features

**Core Features:**
- Project management with ontology (class definitions)
- Image import via file dialog with dimension extraction
- Bounding box annotation with class assignment
- Image navigation (prev/next)
- Annotation selection and deletion
- Class management (add/edit classes with colors)
- YOLO format export with train/val/test splits

**AI Features:**
- YOLO auto-detection via Python CLI
- Python server lifecycle management (reference implementation)

**Validation:**
- Project validation (missing dimensions, files, annotation overlaps using IoU)
- Stratified dataset splitting (groups video frames by filename prefix)

## Important Patterns

### Adding Database Fields
1. Update struct in `database.rs`
2. Modify SQL schema in `Database::new()`
3. Update TypeScript interface in `tauri-commands.ts`
4. Rebuild: `cargo build` (Tauri handles migrations)

### Adding Canvas Features
- Update `CanvasStage.tsx` for stage-level logic (zoom, pan, event handling)
- Create separate layer components for new rendering modes
- Always transform coordinates to image space before saving to database

### Adding ML Models
1. Update `model_manager.py` with new model type
2. Add model file (*.pt) to project root
3. Update `python/requirements.txt` if new dependencies needed
4. Test standalone with `python/test_*.py` scripts

### Path Resolution
- **Rust**: Use `app.path().app_data_dir()` for DB location
- **Python**: Models loaded from project root (current working directory)
- **Images**: Store absolute paths in database for cross-platform support

## Known Issues

1. **Node v24 Incompatible**: Requires Node 18 or 20 LTS. Use `nvm use 18`.
2. **Python Server Lifecycle**: ZeroMQ server in `python/main.py` is reference implementation. Active integration uses CLI wrapper pattern (`predict.py`).
3. **Coordinate Normalization**: Stored as absolute pixels, must convert to normalized YOLO format (0-1) during export.

## Export Format

**YOLO Format**: One `.txt` per image with normalized coordinates:
```
<class_id> <x_center> <y_center> <width> <height>
```

All values normalized to 0-1 range based on image dimensions.

**Directory Structure**:
```
export/
├── train/
│   ├── images/
│   └── labels/
├── val/
│   ├── images/
│   └── labels/
├── test/
│   ├── images/
│   └── labels/
└── data.yaml
```

## Tauri Configuration

**Key Files:**
- `src-tauri/tauri.conf.json`: Tauri app configuration
- `src-tauri/Cargo.toml`: Rust dependencies
- `vite.config.ts`: Frontend build configuration

**Tauri Plugins Used:**
- `tauri-plugin-sql`: SQLite database
- `tauri-plugin-shell`: Process spawning for Python
- `tauri-plugin-dialog`: File/folder dialogs
- `tauri-plugin-fs`: Filesystem access

## Development Guidelines

- **Never create files unless absolutely necessary**. Always prefer editing existing files.
- **Read files before modifying**. Understand existing patterns and architecture.
- **Maintain coordinate consistency**: Transform screen → image coordinates before saving.
- **Test canvas at extreme scales** (0.1x and 20x) when modifying rendering.
- **Use absolute paths** for image storage (cross-platform compatibility).
- **Follow existing error handling patterns** in Rust commands (`.map_err(|e| e.to_string())`).
- **Type safety**: Define proper TypeScript interfaces, avoid `any[]` where possible.
- **Keep Python backend stateless**: Each inference call should be independent.
