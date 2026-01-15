import zmq
import json
import time
import sys

def verify_connection():
    print("Attempting to connect to Python Sidecar at tcp://localhost:5555...")
    context = zmq.Context()
    socket = context.socket(zmq.REQ)
    socket.connect("tcp://localhost:5555")
    
    # Configure timeout (2500ms)
    socket.setsockopt(zmq.RCVTIMEO, 2500)
    socket.setsockopt(zmq.LINGER, 0)
    
    try:
        print("Sending PING...")
        socket.send_json({'command': 'PING'})
        
        reply = socket.recv_json()
        print(f"Received reply: {reply}")
        
        if reply.get('status') == 'PONG':
            print("✅ SUCCESS: Python backend is responsive.")
            return True
        else:
            print(f"❌ FAILURE: Unexpected response: {reply}")
            return False
            
    except zmq.error.Again:
        print("❌ TIMEOUT: No response from Python backend. Is the Electron app running?")
        print("Note: The Python backend is spawned by Electron. You must run 'npm run dev' first.")
        return False
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False
    finally:
        socket.close()
        context.term()

if __name__ == "__main__":
    if verify_connection():
        sys.exit(0)
    else:
        sys.exit(1)
