// --- Configuration ---
const SIGNALING_SERVER = "https://p2p-zbxm.onrender.com"; // Change this to your Render URL later
const PEERJS_CONFIG = {
    host: '0.peerjs.com',
    port: 443,
    secure: true,
    debug: 1
};

// --- State ---
let socket;
let peer;
let myPeerId;
let myName = generateRandomName();
let connectedPeers = new Map(); // peerId -> {name, node}
let selectedPeerId = null;

// --- DOM Elements ---
const sleepNotif = document.getElementById('sleep-notif');
const othersContainer = document.getElementById('others-container');
const listContainer = document.getElementById('list-container');
const fileInput = document.getElementById('file-input');
const modalContainer = document.getElementById('modal-container');
const modalContent = document.getElementById('modal-content');
const statusText = document.getElementById('connection-status');

// --- Initialization ---
init();

async function init() {
    // 1. Show sleep notification after 2 seconds if not connected
    const sleepTimeout = setTimeout(() => {
        if (!socket || !socket.connected) {
            sleepNotif.classList.remove('hidden');
        }
    }, 2000);

    // 2. Setup Socket.IO for signaling/discovery
    socket = io(SIGNALING_SERVER);

    socket.on('connect', () => {
        clearTimeout(sleepTimeout);
        sleepNotif.classList.add('hidden');
        statusText.innerText = "เชื่อมต่อแล้ว - " + myName;
        console.log("Connected to signaling server");

        // Initialize PeerJS after socket is ready
        initPeerJS();
    });

    socket.on('connect_error', () => {
        statusText.innerText = "กำลังพยายามเชื่อมต่อ...";
    });

    socket.on('peer_joined', (data) => {
        addPeer(data.peer_id, data.name);
    });

    socket.on('existing_peers', (peers) => {
        peers.forEach(p => addPeer(p.peer_id, p.name));
    });

    socket.on('peer_left', (data) => {
        removePeer(data.peer_id);
    });
}

function initPeerJS() {
    peer = new Peer(undefined, PEERJS_CONFIG);

    peer.on('open', (id) => {
        myPeerId = id;
        socket.emit('join', { peer_id: id, name: myName });
    });

    peer.on('connection', (conn) => {
        handleIncomingConnection(conn);
    });
}

// --- Peer UI Management ---
function addPeer(peerId, name) {
    if (connectedPeers.has(peerId)) return;

    // Create Radar Node
    const node = document.createElement('div');
    node.className = 'peer-node';
    node.innerHTML = `
        <div class="peer-avatar">${name.charAt(0)}</div>
        <div class="peer-name">${name}</div>
    `;

    // Random position for radar (avoid center, but keep within bounds)
    // 0 to PI ensures it's always in the lower half (Y is positive downwards)
    const angle = Math.random() * Math.PI;
    // Reduced radius: min 120px, max 220px to avoid hitting header/edges
    const radius = 120 + Math.random() * 100;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    node.style.left = `calc(50% + ${x}px)`;
    node.style.top = `calc(50% + ${y}px)`;

    node.onclick = () => selectPeer(peerId);
    othersContainer.appendChild(node);

    // Create List Item (Mobile)
    const item = document.createElement('div');
    item.className = 'peer-item';
    item.innerHTML = `
        <div class="peer-avatar" style="width:50px; height:50px; font-size: 1.2rem;">${name.charAt(0)}</div>
        <div>
            <div style="font-weight:600;">${name}</div>
            <div style="font-size:0.8rem; color:var(--text-secondary);">พร้อมรับไฟล์</div>
        </div>
    `;
    item.onclick = () => selectPeer(peerId);
    listContainer.appendChild(item);

    connectedPeers.set(peerId, { name, node, item });
}

function removePeer(peerId) {
    const peerData = connectedPeers.get(peerId);
    if (peerData) {
        peerData.node.remove();
        peerData.item.remove();
        connectedPeers.delete(peerId);
    }
}

// --- File Handling ---
function selectPeer(peerId) {
    selectedPeerId = peerId;
    fileInput.click();
}

fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file && selectedPeerId) {
        sendFile(selectedPeerId, file);
    }
    fileInput.value = ""; // Reset
};

function sendFile(peerId, file) {
    const peerData = connectedPeers.get(peerId);
    showModal(`
        <h3>ส่งไฟล์ไปยัง ${peerData.name}</h3>
        <p style="margin: 1rem 0; color: var(--text-secondary);">คุณต้องการส่ง <b>${file.name}</b> ใช่หรือไม่?</p>
        <div class="flex-center">
            <button class="btn btn-secondary" onclick="hideModal()">ยกเลิก</button>
            <button class="btn btn-primary" id="confirm-send">ส่งไฟล์</button>
        </div>
    `);

    document.getElementById('confirm-send').onclick = () => {
        const conn = peer.connect(peerId, {
            metadata: { fileName: file.name, fileSize: file.size, fileType: file.type },
            reliable: true
        });

        conn.on('open', () => {
            showModal(`
                <h3>รอการตอบรับ...</h3>
                <p style="text-align:center; margin-top: 1rem; color: var(--text-secondary);">รอดูว่า ${peerData.name} จะรับไฟล์หรือไม่</p>
            `);

            // Check for READY and ACK signals
            conn.on('data', (data) => {
                if (data === 'READY') {
                    startTransfer();
                } else if (data === 'ACK') {
                    // Receiver got the chunk, send next
                    if (offset < file.size) {
                        readNextChunk();
                    } else {
                        // Transfer complete
                        document.getElementById('progress-text').innerText = "เสร็จสมบูรณ์!";
                        setTimeout(hideModal, 2000);
                        setTimeout(() => conn.close(), 1000);
                    }
                }
            });
        });

        let offset = 0;
        const chunkSize = 16384; // 16KB safe chunk size
        const reader = new FileReader();

        reader.onload = (event) => {
            conn.send(event.target.result);
            offset += event.target.result.byteLength;

            // update UI based on what we sent (and was ACKed implicitly by previous step)
            const progress = (offset / file.size) * 100;
            document.getElementById('progress-bar').style.width = `${progress}%`;
            document.getElementById('progress-text').innerText = `${Math.round(progress)}%`;
        };

        function startTransfer() {
            showModal(`
                <h3>กำลังส่งไฟล์...</h3>
                <div style="margin: 1.5rem 0; height: 8px; background: var(--border-color); border-radius: 4px; overflow: hidden;">
                    <div id="progress-bar" style="width: 0%; height: 100%; background: var(--accent-color); transition: width 0.2s;"></div>
                </div>
                <p id="progress-text" style="text-align:center; font-size: 0.9rem;">กำลังเริ่มโอนย้าย...</p>
            `);
            readNextChunk();
        }

        function readNextChunk() {
            const slice = file.slice(offset, offset + chunkSize);
            reader.readAsArrayBuffer(slice);
        }
    };
}

function handleIncomingConnection(conn) {
    const senderData = connectedPeers.get(conn.peer);
    const { fileName, fileSize } = conn.metadata;

    showModal(`
        <h3>รับไฟล์จาก ${senderData ? senderData.name : 'Unknown'}</h3>
        <p style="margin: 1rem 0; color: var(--text-secondary);">ส่งไฟล์: <b>${fileName}</b> (${formatBytes(fileSize)})</p>
        <div class="flex-center">
            <button class="btn btn-secondary" id="decline-btn">ปฏิเสธ</button>
            <button class="btn btn-primary" id="confirm-accept">รับไฟล์</button>
        </div>
    `);

    let receivedChunks = [];
    let receivedSize = 0;
    let isAccepted = false;

    document.getElementById('decline-btn').onclick = () => {
        conn.close();
        hideModal();
    };

    document.getElementById('confirm-accept').onclick = () => {
        isAccepted = true;
        conn.send('READY');

        showModal(`
            <h3>กำลังรับไฟล์...</h3>
            <div style="margin: 1.5rem 0; height: 8px; background: var(--border-color); border-radius: 4px; overflow: hidden;">
                <div id="progress-bar" style="width: 0%; height: 100%; background: var(--accent-color); transition: width 0.2s;"></div>
            </div>
            <p id="progress-text" style="text-align:center; font-size: 0.9rem;">กำลังดาวน์โหลด...</p>
        `);
    };

    conn.on('data', (data) => {
        if (!isAccepted) return;

        let size = 0;
        if (data instanceof ArrayBuffer) {
            size = data.byteLength;
        } else if (data instanceof Blob) {
            size = data.size;
        }

        if (size > 0) {
            receivedChunks.push(data);
            receivedSize += size;

            const progress = (receivedSize / fileSize) * 100;
            const progressBar = document.getElementById('progress-bar');
            const progressText = document.getElementById('progress-text');

            if (progressBar) progressBar.style.width = `${progress}%`;
            if (progressText) progressText.innerText = `${Math.round(progress)}%`;

            // Always acknowledge receipt to sender so they send next chunk
            conn.send('ACK');

            if (receivedSize >= fileSize) {
                const blob = new Blob(receivedChunks);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                a.click();

                if (progressText) progressText.innerText = "ดาวน์โหลดเสร็จแล้ว!";
                setTimeout(hideModal, 2000);
            }
        }
    });

    conn.on('close', () => {
        if (receivedSize < fileSize && isAccepted) {
            showModal(`<h3>การเชื่อมต่อหลุด</h3><p style="text-align:center;">การรับไฟล์ล้มเหลว</p><button class="btn btn-primary" onclick="hideModal()">ตกลง</button>`);
        }
    });
}

// --- Helpers ---
function showModal(html) {
    modalContent.innerHTML = html;
    modalContainer.classList.remove('hidden');
}

function hideModal() {
    modalContainer.classList.add('hidden');
}

window.hideModal = hideModal;

function generateRandomName() {
    const adjectives = ["Happy", "Quiet", "Fast", "Brave", "Clever", "Cool", "Mighty"];
    const animals = ["Panda", "Fox", "Eagle", "Lion", "Tiger", "Dolphin", "Wolf"];
    return adjectives[Math.floor(Math.random() * adjectives.length)] + " " +
        animals[Math.floor(Math.random() * animals.length)];
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
