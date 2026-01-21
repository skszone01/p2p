from flask import Flask, request
from flask_socketio import SocketIO, join_room, leave_room, emit
import os

app = Flask(__name__)
# Allow CORS for development and GitHub Pages
socketio = SocketIO(app, cors_allowed_origins="*")

# Store connected peers: { peer_id: { sid, room } }
peers = {}

@app.route('/')
def index():
    return "Signaling Server Running"

@socketio.on('join')
def on_join(data):
    peer_id = data.get('peer_id')
    # Get client's real public IP (handling proxies like Render/Cloudflare)
    ip_address = request.headers.get('X-Forwarded-For', request.remote_addr).split(',')[0].strip()
    
    if not peer_id:
        return

    room = f"room_{ip_address}"
    join_room(room)
    
    # Store peer info
    peers[peer_id] = {
        'sid': request.sid,
        'room': room,
        'name': data.get('name', 'Anonymous')
    }
    
    # Notify others in the room about the new peer
    emit('peer_joined', {
        'peer_id': peer_id,
        'name': data.get('name', 'Anonymous')
    }, room=room, include_self=False)
    
    # Send existing peers in this room back to the new peer
    existing_peers = [
        {'peer_id': pid, 'name': info['name']} 
        for pid, info in peers.items() 
        if info['room'] == room and pid != peer_id
    ]
    emit('existing_peers', existing_peers)
    
    print(f"Peer {peer_id} ({data.get('name')}) joined room {room}")

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
        print(f"Peer {peer_id_to_remove} disconnected")

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port)
