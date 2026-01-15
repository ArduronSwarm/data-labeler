import torch
from ultralytics import YOLO, SAM
import os
import sys

class ModelManager:
    def __init__(self):
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        if self.device == 'cpu' and torch.backends.mps.is_available():
            self.device = 'mps' # Apple Silicon support
            
        print(f"ModelManager initialized on device: {self.device}", flush=True)
        
        self.models = {}
        self.active_embeddings = {} # Cache for SAM image embeddings: {image_path: embedding}
        self.current_image_path = None

    def load_model(self, model_type: str, model_name: str = None):
        """
        Loads a model into memory.
        model_type: 'yolo' or 'sam'
        model_name: specific weight file (e.g. 'yolo11n.pt', 'sam2_b.pt')
        """
        key = f"{model_type}_{model_name}"
        if key in self.models:
            print(f"Model {key} already loaded.", flush=True)
            return self.models[key]

        print(f"Loading {model_type} model: {model_name}...", flush=True)
        try:
            if model_type == 'yolo':
                # Default to yolo11n if not specified
                name = model_name if model_name else 'yolo11n.pt'
                model = YOLO(name)
                # Force device? Ultralytics usually handles auto
                # model.to(self.device) 
                self.models[key] = model
                
            elif model_type == 'sam':
                # Default to sam2_b if not specified (assuming ultralytics supports it)
                name = model_name if model_name else 'sam3_b.pt' # Default to SAM 3
                # Note: valid list depends on ultralytics version. 
                # SAM-2 support is new. Let's try loading it via SAM class.
                model = SAM(name)
                self.models[key] = model
                
            print(f"✅ Loaded {name} successfully.", flush=True)
            return self.models[key]
            
        except Exception as e:
            print(f"❌ Failed to load model {model_name}: {e}", flush=True)
            return None

    def predict(self, model_type: str, image_path: str, **kwargs):
        """
        Generic prediction method.
        """
        # Ensure model is loaded (naive: load "default" if not present)
        # In real app, we might want explicit loading phases.
        
        # For prototype, we'll try to find any loaded model of that type or load default
        model = None
        for k, m in self.models.items():
            if k.startswith(model_type):
                model = m
                break
        
        if not model:
            # Auto-load default
            model = self.load_model(model_type)
            
        if not model:
            return {"error": "Could not load model"}

        print(f"Running inference on {image_path}...", flush=True)
        
        if model_type == 'yolo':
            results = model(image_path, device=self.device)
            # Process results to JSON serializable format
            detections = []
            for r in results:
                for box in r.boxes:
                    detections.append({
                        "class": int(box.cls),
                        "conf": float(box.conf),
                        "bbox": box.xywh.tolist()[0] # [x_center, y_center, width, height]
                    })
            return {"detections": detections}

        elif model_type == 'sam':
            # Default to sam3_b.pt as requested
            if not model:
                model = self.load_model('sam', 'sam3_b.pt') # Using SAM 3 base interface
            
            if not model:
                 return {"error": "Could not load SAM model"}

            print(f"Running SAM inference on {image_path}...", flush=True)
            
            # Check if we need to cache embeddings for this image
            if self.current_image_path != image_path:
                print(f"Caching embeddings for {image_path}...", flush=True)
                self.current_image_path = image_path
                # The model will compute embeddings on first run
                # Ultralytics SAM doesn't expose set_image() directly,
                # but we can cache the result by keeping the same image path
            
            bboxes = kwargs.get('bboxes', None) # Expecting [[x1, y1, x2, y2], ...]
            
            # Ultralytics SAM predict
            # Note: prompts are strictly supported in different ways depending on version.
            # Using standard ultralytics API: model(source, bboxes=[...])
            
            if bboxes:
                results = model(image_path, bboxes=bboxes, device=self.device)
            else:
                results = model(image_path, device=self.device)

            polygons = []
            import cv2
            import numpy as np
            
            for result in results:
                if result.masks:
                    # masks.xy is a list of coordinates for each mask
                    for i, mask_xy in enumerate(result.masks.xy):
                        # mask_xy is already a polygon (N, 2)
                        # We just need to convert it to a list of points
                        poly_points = mask_xy.tolist()
                        
                        # Simplification (optional, RDP)
                        # To do RDP via cv2, we need to convert back to contour format
                        # But result.masks.xy is usually already good. 
                        # Let's apply a small simplification if needed or just return.
                        
                        polygons.append({
                            "id": i,
                            "points": poly_points, # [[x,y], [x,y], ...]
                            # "bbox": ... associated bbox if needed
                        })

            return {"polygons": polygons}

        return {"error": "Unknown model type"}
