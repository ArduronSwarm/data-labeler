import zmq
import time
import sys
from model_manager import ModelManager

def run_server():
    context = zmq.Context()
    socket = context.socket(zmq.REP)
    socket.bind("tcp://*:5555")
    
    # Initialize AI Engine
    model_mgr = ModelManager()
    # Pre-load lightweight models if desired
    # model_mgr.load_model('yolo', 'yolo11n.pt') 
    
    print("Python ZMQ server started on port 5555", flush=True)
    
    last_heartbeat = time.time()
    
    # Heartbeat check thread (kept simple single-threaded for now to avoid GIL complexity with ZMQ)
    # The pure loop is fine as long as we don't block too long on inference.
    # For heavy inference, we might need a separate worker thread or process.

    while True:
        try:
            # Wait for next request from client
            message = socket.recv_json()
            command = message.get('command')
            
            if command == 'PING':
                last_heartbeat = time.time()
                socket.send_json({'status': 'PONG'})
            
            elif command == 'SHUTDOWN':
                socket.send_json({'status': 'OK', 'message': 'Shutting down'})
                print("Received SHUTDOWN signal, exiting...", flush=True)
                break
            
            elif command == 'PREDICT':
                model_type = message.get('modelType', 'yolo')
                image_path = message.get('imagePath')
                bboxes = message.get('bboxes') # Optional: for SAM prompts
                
                if not image_path:
                    socket.send_json({'status': 'ERROR', 'message': 'No imagePath provided'})
                    continue
                    
                result = model_mgr.predict(model_type, image_path, bboxes=bboxes)
                socket.send_json({'status': 'OK', 'result': result})
                
            else:
                socket.send_json({'status': 'ERROR', 'message': 'Unknown command'})
                
        except Exception as e:
            print(f"Error: {e}", flush=True)
            socket.send_json({'status': 'ERROR', 'message': str(e)})

if __name__ == "__main__":
    run_server()
