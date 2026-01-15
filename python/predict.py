#!/usr/bin/env python3
"""Simple CLI wrapper for running predictions"""
import sys
import json
from model_manager import ModelManager

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python predict.py <model_type> <image_path>"}))
        sys.exit(1)
    
    model_type = sys.argv[1]
    image_path = sys.argv[2]
    
    try:
        model_mgr = ModelManager()
        result = model_mgr.predict(model_type, image_path)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
