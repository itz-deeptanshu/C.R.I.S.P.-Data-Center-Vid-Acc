import cv2
from flask import Flask, Response
from flask_socketio import SocketIO
from ultralytics import YOLO
from flask_cors import CORS

app = Flask(__name__)
CORS(app) # Allows React to talk to Python
socketio = SocketIO(app, cors_allowed_origins="*")

# Load your YOLO pose model
model = YOLO('yolo11n-pose.pt') 

def generate_frames():
    cap = cv2.VideoCapture(0)
    while True:
        success, frame = cap.read()
        if not success:
            break
        
        # 1. Run Detection
        results = model.predict(frame, conf=0.25, verbose=False)
        
        # 2. Draw boxes/pose keypoints ON the frame
        annotated_frame = results[0].plot()

        # 3. Logic: Emit detection event via Socket
        # We only emit if keypoints are found to avoid spamming
        if results[0].keypoints is not None and len(results[0].keypoints.data) > 0:
            socketio.emit('survivor_detected', {'probeId': 'P01'})

        # 4. Encode and yield the frame
        ret, buffer = cv2.imencode('.jpg', annotated_frame)
        frame_bytes = buffer.tobytes()
        
        # Ensure the boundary '--frame' is consistent
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

@app.route('/video_feed')
def video_feed():
    # This is the URL React will use to show the camera
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000)
