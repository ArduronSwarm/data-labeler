# Arduron Data Labeling - Implementation Status & Roadmap

**Last Updated:** December 24, 2025

## Architecture Decision: Electron → Tauri Migration

**Original Plan:** Electron + Python sidecar with ZeroMQ communication  
**Current Reality:** Tauri 2.x (Rust backend) + Python sidecar with ZeroMQ  
**Reason for Change:** Electron macOS compatibility issues; Tauri offers smaller bundles, better performance, and native Rust integration

---

## Phase 1: Foundation & Scaffolding

### [DONE] Task 1.1: Repository Initialization
**Status:** COMPLETE (with Tauri instead of Electron)
- [DONE] Project structure: `src/` (React frontend), `src-tauri/src/` (Rust backend), `python/` (ML engine)
- [DONE] Python environment: `requirements.txt` with torch, ultralytics, opencv-python-headless, pyzmq
- [DONE] Vite + React + TypeScript frontend setup
- **Implementation:** Tauri project with proper plugin configuration

### [DONE] Task 1.2: IPC Bridge (ZeroMQ)
**Status:** PARTIALLY COMPLETE
- [DONE] Python ZeroMQ server implemented (`python/main.py`) listening on port 5555
- [DONE] PING/PONG heartbeat mechanism implemented
- [DONE] PREDICT command structure defined
- [PARTIAL] **MISSING:** Rust-side process spawning (`start_python_server` command is stubbed)
- [PARTIAL] **MISSING:** Lifecycle management (SHUTDOWN signal on app quit)
- [PARTIAL] **MISSING:** Heartbeat monitor auto-termination (mentioned but not verified)

**Next Steps:**
1. Implement Rust command to spawn Python process using `tauri_plugin_shell`
2. Add app shutdown hook to send SHUTDOWN signal to Python
3. Test zombie process prevention on app crash

### [DONE] Task 1.3: Database Schema
**Status:** COMPLETE
- [DONE] SQLite with WAL mode enabled (`PRAGMA journal_mode=WAL`)
- [DONE] `projects` table with ontology JSON
- [DONE] `images` table with status (UNLABELED/LABELED/VERIFIED) and split_set
- [DONE] `annotations` table with geometry_type, coordinates JSON, source (manual/model)
- [DONE] Full CRUD operations implemented in `database.rs`
- **Location:** `~/Library/Application Support/com.arduron.data-labeling/arduron.db` (macOS)

---

## Phase 2: The Annotation Canvas

### [DONE] Task 2.1: Canvas Architecture
**Status:** COMPLETE
- [DONE] `CanvasStage` component using react-konva
- [DONE] Layer architecture implemented:
  - `BackgroundLayer`: Renders source image using `use-image` hook
  - `ActiveLayer`: Displays annotations and current drawing
- [PARTIAL] **MISSING:** AI Layer for provisional SAM masks (not implemented)

**Next Steps:**
1. Add `AILayer` component for displaying semi-transparent model predictions
2. Implement annotation selection/editing (currently can only draw, not edit)
3. Add polygon drawing mode (currently only boxes)

### [DONE] Task 2.2: Coordinate & Zoom Logic
**Status:** COMPLETE
- [DONE] Zoom engine with transformation matrices (mousewheel zoom to cursor)
- [DONE] Coordinate transformation: Screen → Image space using `getRelativePointerPosition`
- [DONE] Invariant stroke width: `strokeWidth = 2 / scale`
- [DONE] Pan support (stage draggable when not drawing)

**Working Implementation:**
```typescript
const getRelativePointerPosition = (node: Konva.Node) => {
  const transform = node.getAbsoluteTransform().copy();
  transform.invert();
  return transform.point(node.getStage()?.getPointerPosition());
};
```

---

## Phase 3: Intelligence Integration (SAM/YOLO)

### [PARTIAL] Task 3.1: Model Manager & Initialization
**Status:** PARTIALLY COMPLETE
- [DONE] `ModelManager` class in Python with device detection (CUDA > MPS > CPU)
- [DONE] YOLO and SAM model loading support
- [DONE] Model registry to prevent duplicate loading
- [PARTIAL] **MISSING:** Embedding cache for SAM (mentioned in `active_embeddings` dict but not implemented)
- [PARTIAL] **MISSING:** float16 quantization for low-VRAM GPUs
- [PARTIAL] **MISSING:** Sub-50ms inference target not verified

**Next Steps:**
1. Implement SAM image encoder caching (`set_image()` method)
2. Add memory profiling and VRAM detection
3. Implement dynamic quantization based on available VRAM
4. Benchmark inference times

### [PARTIAL] Task 3.2: Inference Pipeline
**Status:** FOUNDATION ONLY
- [DONE] ZeroMQ request/reply cycle structure
- [DONE] YOLO detection pipeline (boxes + confidence)
- [DONE] SAM inference with optional bbox prompts
- [PARTIAL] **MISSING:** Text prompt support for SAM (requires CLIP integration)
- [PARTIAL] **MISSING:** YOLO → SAM chaining (detect boxes, then segment)
- [PARTIAL] **MISSING:** Post-processing: `cv2.findContours` and Ramer-Douglas-Peucker simplification
- [PARTIAL] **MISSING:** Frontend integration (UI calls to Python backend)

**Next Steps:**
1. Implement Rust → Python communication from Tauri commands
2. Add frontend UI for triggering auto-annotation
3. Chain YOLO detection → SAM segmentation workflow
4. Optimize polygon simplification for export

---

## Phase 4: Workflow, Persistence & Export

### [DONE] Task 4.1: Resume Capability
**Status:** COMPLETE
- [DONE] App initializes with last project (or creates default)
- [DONE] Loads first image and existing annotations
- [DONE] State restoration on launch

**Enhancement Needed:**
- Remember last active image (currently loads first image)
- Remember canvas zoom/pan position

### [PARTIAL] Task 4.2: Stratified Auto-Splitting
**Status:** BASIC IMPLEMENTATION
- [DONE] `auto_split_dataset` command implemented
- [DONE] Train/Val/Test split by percentage
- [PARTIAL] **MISSING:** Class distribution balancing (stratification)
- [PARTIAL] **MISSING:** Group awareness for video frames (prefix grouping)
- [PARTIAL] **MISSING:** Random shuffle before split

**Current Behavior:** Sequential split (first N → train, next M → val, rest → test)

**Next Steps:**
1. Implement stratified sampling by class distribution
2. Add filename prefix detection (e.g., `video_01_frame_*`)
3. Ensure frame sequences stay within same split
4. Add random seed for reproducible splits

### [DONE] Task 4.3: Physical Export
**Status:** COMPLETE
- [DONE] YOLO format export (train/val/test directories)
- [DONE] Image copying to split directories
- [DONE] Label files with coordinates
- [DONE] `data.yaml` generation
- [PARTIAL] **ISSUE:** Coordinates stored as JSON, not normalized YOLO format (0..1)

**Next Steps:**
1. Convert absolute coordinates → normalized format during export
2. Add image dimensions to annotation for proper normalization
3. Support multiple classes in `data.yaml`
4. Add COCO format export option

---

## Phase 5: Packaging (Future)

### [TODO] Task 5.1: Executable Freezing
**Status:** NOT STARTED
- [TODO] PyInstaller for Python backend
- [TODO] Tauri bundling configuration for DMG/EXE
- [TODO] Sidecar executable integration

**Tauri-Specific Notes:**
- Use Tauri's sidecar feature instead of manual process spawning
- Configure in `tauri.conf.json` under `bundle.externalBin`
- See: https://tauri.app/v1/guides/building/sidecar/

---

## Missing Features (Not in Original Plan)

### High Priority
1. **Ontology Management UI**
   - Currently hardcoded `'{}'` - need UI to define classes with colors
   - Class selector in toolbar during annotation
   - Color-coded bounding boxes per class

2. **Image Navigation**
   - Thumbnail sidebar
   - Previous/Next image hotkeys
   - Image status indicators (unlabeled/labeled/verified)

3. **Annotation Editing**
   - Select and modify existing boxes
   - Delete annotations
   - Keyboard shortcuts (Del, Esc, etc.)

4. **File Import Dialog**
   - Use Tauri file dialog plugin (already installed)
   - Bulk import from folder
   - Progress indicator for large imports

5. **Validation & QA**
   - Annotation overlap detection
   - Empty annotation warnings
   - Image dimension validation

### Medium Priority
6. **Polygon Tool**
   - Point-by-point polygon drawing
   - Freehand polygon mode
   - Polygon editing (drag vertices)

7. **SAM Integration UI**
   - "Auto-segment" button
   - Click-to-segment mode
   - Prompt refinement tools

8. **Export Enhancements**
   - Export progress bar
   - Multiple format support (COCO, Pascal VOC)
   - Export validation report

9. **Settings Panel**
   - Python server configuration
   - Model selection (YOLO variants)
   - Export preferences

### Low Priority
10. **Keyboard Shortcuts**
    - Comprehensive hotkey system
    - Customizable keybindings
    - Shortcut reference panel

11. **Undo/Redo**
    - Annotation history stack
    - Multi-step undo support

12. **Performance Optimizations**
    - Virtual scrolling for large image lists
    - Lazy loading annotations
    - Canvas rendering optimizations

---

## Technical Debt

1. **Coordinate Format Inconsistency**
   - Frontend stores boxes as `{x, y, width, height}`
   - Database stores as JSON string
   - Export needs normalized YOLO format
   - **Fix:** Standardize to YOLO normalized format everywhere

2. **Type Safety Gaps**
   - `annotations: any[]` in TypeScript (should be proper interface)
   - Loose typing in Rust-TypeScript boundary

3. **Error Handling**
   - Limited user-facing error messages
   - No retry logic for Python server connection
   - Database errors not gracefully handled in UI

4. **Testing**
   - No unit tests
   - No integration tests
   - Manual testing only

5. **Documentation**
   - API documentation missing
   - Component props not documented
   - Database schema not versioned

---

## Immediate Next Steps (Priority Order)

### Sprint 1: Core Stability
1. [DONE] Fix coordinate normalization in export
2. [DONE] Complete Python server lifecycle management
3. [DONE] Add image dimension extraction on import
4. [DONE] Implement basic ontology UI (class selector)

### Sprint 2: Usability
5. [DONE] Add file import dialog using Tauri
6. [DONE] Implement image navigation (prev/next)
7. [DONE] Add annotation selection/deletion
8. [DONE] Keyboard shortcuts for common actions

### Sprint 3: AI Integration
9. [DONE] Wire up YOLO auto-detection
10. [DONE] Implement embedding cache for SAM
11. [DONE] Add "Auto-segment" UI button
12. [DONE] Test YOLO → SAM chaining workflow

### Sprint 4: Polish & Package
13. [DONE] Add stratified dataset splitting
14. [DONE] Implement validation checks
15. [DONE] Create production build with Tauri
16. [DONE] Test cross-platform (macOS, Windows, Linux)

---

## Testing Strategy

### Manual Testing Checklist
- [ ] Import folder of images
- [ ] Draw bounding boxes on multiple images
- [ ] Save and reload project
- [ ] Export to YOLO format
- [ ] Verify exported coordinates in training
- [ ] Test zoom/pan at extreme scales
- [ ] Test with large images (>10MB)

### Integration Testing Needed
- [ ] Python server spawn/shutdown
- [ ] YOLO inference end-to-end
- [ ] SAM inference with prompts
- [ ] Database concurrent access (multiple annotation saves)
- [ ] Export with all three splits populated

### Performance Testing
- [ ] 1000+ images in project
- [ ] 100+ annotations per image
- [ ] Canvas rendering at 1-10x zoom
- [ ] Model inference latency
- [ ] Database query performance

---

## Questions for Stakeholders

1. **Class Ontology:** Should we support hierarchical classes (e.g., Vehicle > Car, Truck)?
2. **Annotation Types:** Priority order - Polygon, Segmentation Mask, Keypoints, 3D boxes?
3. **Collaboration:** Multi-user support? Cloud sync? Or remain local-only?
4. **Model Training:** Should we integrate training pipeline, or just export for external training?
5. **Video Support:** Frame extraction and sequence annotation needed?

---

## Resources

- **Tauri Docs:** https://tauri.app/v1/guides/
- **react-konva:** https://konvajs.org/docs/react/
- **Ultralytics YOLO:** https://docs.ultralytics.com/
- **SQLite WAL Mode:** https://www.sqlite.org/wal.html
- **YOLO Format Spec:** https://roboflow.com/formats/yolov8-pytorch-txt

---

**Status Legend:**
- [DONE] Complete and working
- [PARTIAL] Partially implemented or has issues
- [TODO] Not started
