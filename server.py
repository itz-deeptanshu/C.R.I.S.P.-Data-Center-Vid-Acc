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
        
        # Run Detection
        results = model.predict(frame, conf=0.25, verbose=False)
        annotated_frame = results[0].plot()

        # Logic: If we see a human body part, tell React!
        for r in results:
            if r.keypoints is not None and len(r.keypoints.data) > 0:
                # Trigger the 'survivor_detected' event in React
                socketio.emit('survivor_detected', {'probeId': 'P01'})

        # Encode for web streaming
        ret, buffer = cv2.imencode('.jpg', annotated_frame)
        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'--frame\r\n')

@app.route('/video_feed')
def video_feed():
    # This is the URL React will use to show the camera
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000)