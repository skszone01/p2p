import eventlet
eventlet.monkey_patch()

from flask import Flask, request
from flask_socketio import SocketIO, join_room, leave_room, emit
import os

app = Flask(__name__)
# อนุญาต CORS สำหรับ GitHub Pages
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# เก็บข้อมูล Peers: { peer_id: { sid, room, name } }
peers = {}

@app.route('/')
def index():
    return "Signaling Server Running"

@socketio.on('join')
def on_join(data):
    peer_id = data.get('peer_id')
    # ดึง IP เพื่อจัดกลุ่มคนในเน็ตเวิร์กเดียวกัน
    ip_address = request.headers.get('X-Forwarded-For', request.remote_addr).split(',')[0].strip()
    
    if not peer_id:
        return

    room = f"room_{ip_address}"
    join_room(room)
    
    peers[peer_id] = {
        'sid': request.sid,
        'room': room,
        'name': data.get('name', 'Anonymous')
    }
    
    emit('peer_joined', {
        'peer_id': peer_id,
        'name': data.get('name', 'Anonymous')
    }, room=room, include_self=False)
    
    existing_peers = [
        {'peer_id': pid, 'name': info['name']} 
        for pid, info in peers.items() 
        if info['room'] == room and pid != peer_id
    ]
    emit('existing_peers', existing_peers)

@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    peer_id_to_remove = None
    
    for pid, info in peers.items():
        if info['sid'] == sid:
            peer_id_to_remove = pid
            room = info['room']
            emit('peer_left', {'peer_id': pid}, room=room)
            break
            
    if peer_id_to_remove:
        del peers[peer_id_to_remove]

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port)
