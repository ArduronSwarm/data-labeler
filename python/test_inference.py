import zmq
import json
import sys
import os

def test_inference():
    print("Testing YOLO Inference Request...", flush=True)
    
    # Check if test image exists
    if not os.path.exists("test_image.jpg"):
        print("❌ Error: test_image.jpg not found. Please download it first.")
        return False

    context = zmq.Context()
    socket = context.socket(zmq.REQ)
    socket.connect("tcp://localhost:5555")
    socket.setsockopt(zmq.RCVTIMEO, 10000) # 10s timeout for model loading

    req = {
        'command': 'PREDICT',
        'modelType': 'yolo',
        'imagePath': os.path.abspath("test_image.jpg")
    }
    
    try:
        print(f"Sending request: {req}...", flush=True)
        socket.send_json(req)
        
        reply = socket.recv_json()
        print(f"Received reply: {json.dumps(reply, indent=2)}")
        
        if reply.get('status') == 'OK' and 'result' in reply:
            print("✅ Inference SUCCESS")
            return True
        else:
            print("❌ Inference FAILED")
            return False
            
    except Exception as e:
        print(f"❌ Error during test: {e}")
        return False

if __name__ == "__main__":
    test_inference()
