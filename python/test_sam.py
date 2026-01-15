import zmq
import json
import sys
import os

def test_sam():
    print("Testing SAM Inference Request...", flush=True)
    
    if not os.path.exists("test_image.jpg"):
        print("❌ Error: test_image.jpg not found.")
        return False

    context = zmq.Context()
    socket = context.socket(zmq.REQ)
    socket.connect("tcp://localhost:5555")
    socket.setsockopt(zmq.RCVTIMEO, 30000) # 30s timeout for SAM loading (heavier model)

    # Use a dummy bbox (approximate cat location from previous test)
    # [639, 807, 1270, 1535]
    dummy_bbox = [639, 807, 1270, 1535]

    req = {
        'command': 'PREDICT',
        'modelType': 'sam',
        'imagePath': os.path.abspath("test_image.jpg"),
        'bboxes': [dummy_bbox]
    }
    
    try:
        print(f"Sending request: {req}...", flush=True)
        socket.send_json(req)
        
        reply = socket.recv_json()
        
        if reply.get('status') == 'OK' and 'result' in reply:
            polygons = reply['result'].get('polygons', [])
            print(f"Received {len(polygons)} polygons.")
            if len(polygons) > 0:
                # Print first few points of first polygon to verify
                print(f"First polygon has {len(polygons[0]['points'])} points.")
                print("✅ SAM Inference SUCCESS")
                return True
        
        print(f"❌ SAM Inference FAILED: {reply}")
        return False
            
    except Exception as e:
        print(f"❌ Error during test: {e}")
        return False

if __name__ == "__main__":
    test_sam()
