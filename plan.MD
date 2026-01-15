Agent Protocol: Arduron Data Labeling Implementation
1. Project Overview & Philosophy
Project Name: Arduron Data Labeling


Objective: Build a local-first, high-performance desktop application for AI-assisted image annotation, serving as a privacy-focused alternative to cloud tools like Roboflow. Core Philosophy: "Local Sovereignty"—The entire data lifecycle (ingestion, annotation, model training export) occurs on the user's local hardware (GPU/CPU) to ensure zero latency and absolute data privacy.


 


Architecture: "Electron + Python Sidecar".


Frontend (Renderer): React + TypeScript + Vite + React-Konva (for high-performance canvas rendering).



Main Process: Electron (Node.js) for OS integration and process orchestration.


AI Backend (Sidecar): Python 3.12 running independently to host PyTorch and SAM 3, communicating via ZeroMQ.




Persistence: SQLite (via better-sqlite3) for robust state management.


2. Phase 1: Foundation & Scaffolding
Goal: Establish the "Iron Skeleton"—the communication bridge between the UI and the AI engine.

Task 1.1: Repository Initialization

Directive: Initialize an Electron-Vite project structure with TypeScript.


Structure: Create a root directory with /electron (Main process), /src (Renderer), and /py_backend (Python engine).


Python Environment: Create a requirements.txt containing torch, ultralytics, opencv-python-headless, and pyzmq.

Task 1.2: The IPC Bridge (ZeroMQ)

Directive: Create a ChildProcessManager class in the Electron Main process.

Mechanism: Spawn the Python script using child_process.spawn. Use ZeroMQ (ZMQ) pairs for communication instead of stdin/stdout to handle high-throughput binary image data.


Lifecycle Safety: Implement a "SHUTDOWN" signal listener. When Electron quits (will-quit), it must send a termination signal to Python to prevent zombie processes.


Constraint: The Python script must implement a "heartbeat" monitor; if it fails to receive a ping from Electron for 5 seconds, it must auto-destruct.

Task 1.3: Database Schema

Directive: Initialize an SQLite database using better-sqlite3 in the Main process.


Configuration: Enable Write-Ahead Logging (PRAGMA journal_mode=WAL;) to allow concurrent reads and writes without UI freezes.


Schema: Create the following tables :

projects: Stores ontology (class names/colors) JSON.

images: Stores file paths, status (UNLABELED, VERIFIED), and split set (TRAIN, TEST).

annotations: Stores geometry (BOX, POLYGON), coordinates, and source (MANUAL, MODEL_SAM3).

3. Phase 2: The Annotation Canvas
Goal: Build the manual labeling tools with professional-grade responsiveness.

Task 2.1: Canvas Architecture

Directive: Build a CanvasStage component using react-konva.


Layering: Implement a stack of virtual layers to optimize performance:


Background Layer: Renders the source image (cached as a bitmap).


AI Layer: Displays provisional, semi-transparent masks from the model.


Active Layer: Contains the user's current interaction (drawing/editing).

Task 2.2: Coordinate & Zoom Logic

Directive: Implement the "Zoom Engine" using transformation matrices.


Mapping: Ensure all mouse events are transformed from "Screen Coordinates" to "Image Coordinates" using the inverse of the Stage matrix.


Invariant Stroke: Implement dynamic stroke width logic (strokeWidth = baseWidth / stageScale) so annotation lines remain visually thin regardless of the zoom level.

4. Phase 3: Intelligence Integration (SAM 3)
Goal: Implement "Promptable Concept Segmentation" using the Python backend.

Task 3.1: Model Manager & Initialization

Directive: Create a ModelManager class in Python to handle SAM 3 loading.

Hardware Fallback: Implement logic to detect CUDA availability. If VRAM is constrained (e.g., <12GB), force float16 quantization; if no GPU is found, fall back to CPU execution.



Embedding Cache: When an image is loaded, run the SAM 3 Image Encoder once and cache the embedding in RAM to allow sub-50ms interaction for subsequent prompts.

Task 3.2: Inference Pipeline

Directive: Implement the ZMQ request/reply cycle for inference.

Workflow:

Frontend: Sends { command: 'PREDICT', prompt: 'car', ... }.

Backend: Runs SAM 3 inference. For text prompts, use the prompt encoder directly. For common objects, chain YOLOv11 detection boxes as prompts for SAM 3.



Post-Processing: Convert binary masks to vector polygons using cv2.findContours and simplify the geometry (Ramer-Douglas-Peucker algorithm) before returning to the UI.

5. Phase 4: Workflow, Persistence & Export
Goal: Manage state and prepare datasets for ML training.

Task 4.1: Resume Capability

Directive: Implement state restoration logic.


Logic: On application launch, query the projects and images tables to restore the user's exact previous view (last active project and image), ensuring zero progress loss.

Task 4.2: Stratified Auto-Splitting

Directive: Implement "Auto-Splitting" logic for export.


Algorithm: When exporting, split data into Train/Val/Test based on class distribution.


Group Awareness: Enforce grouping by filename prefix (e.g., video_01_...) to ensure frames from the same sequence do not leak across training and test sets.

Task 4.3: Physical Export

Directive: Create a Python export script.


Format: Generate the standard directory tree and manifest files (e.g., data.yaml for YOLO), converting absolute database coordinates into normalized 0..1 coordinates.

6. Phase 5: Packaging
Goal: Distribute Arduron Data Labeling as a standalone application.

Task 5.1: Executable Freezing

Directive: Use PyInstaller to freeze the Python backend into a standalone executable.


Bundling: Configure electron-builder to include this executable in the final application bundle (DMG/EXE), ensuring the Main process can spawn it dynamically.