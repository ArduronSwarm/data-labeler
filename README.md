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

## Integration with LocalCameraServer

Arduron Data Labeling works alongside [LocalCameraServer](../LocalCameraServer) to create a full training data pipeline for your camera AI models.

### Workflow

```
LocalCameraServer → captures frames → Arduron Data Labeling → labeled dataset → model training → LocalCameraServer
```

**Step 1 — Capture frames with LocalCameraServer**

Run the camera pipeline and let it detect persons. Screenshots are saved to `person_screenshots/` in the LocalCameraServer directory:

```bash
# In LocalCameraServer/
python -m app.pipelines.run_pipeline \
  --video-url 0 \
  --camera-id my-camera \
  --enable-server \
  --server-port 8001
```

Detected person crops and AI-annotated frames are written to `person_screenshots/` automatically.

**Step 2 — Import frames into Arduron Data Labeling**

1. Open Arduron Data Labeling (`npm run dev` in this repo)
2. Create or open a project with the correct class ontology (e.g., `person`, `face`, `license_plate`)
3. Click **Import Images** and select the `person_screenshots/` folder from LocalCameraServer
4. The images are imported with their dimensions extracted automatically

**Step 3 — Annotate**

Draw bounding boxes on each image and assign the correct class. Use the YOLO auto-detection feature (if a base model is available) to pre-label images and then correct them manually.

**Step 4 — Export YOLO dataset**

Use **Export Dataset** to generate a YOLO-format dataset:

```
export/
├── train/images/  ├── train/labels/
├── val/images/    ├── val/labels/
├── test/images/   ├── test/labels/
└── data.yaml
```

**Step 5 — Train and deploy back to LocalCameraServer**

Train a new YOLOv8 model on your exported dataset, then place the `.pt` file in both the LocalCameraServer root and the data labeling project root for use in future auto-labeling runs.

### Key Paths

| Location | Path |
|---|---|
| LocalCameraServer screenshots | `LocalCameraServer/person_screenshots/` |
| LocalCameraServer YOLO model | `LocalCameraServer/*.pt` |
| Data labeling export | `data_labeling/export/` |
| Data labeling YOLO model | `data_labeling/*.pt` |

## Documentation

See [SETUP.md](./SETUP.md) for detailed setup instructions and troubleshooting.

## Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS, Konva
- **Desktop**: Tauri 2.x (Rust)
- **Database**: SQLite (rusqlite)
- **AI Backend**: Python, PyTorch, Ultralytics
