// --- Asset config ---
const ROOMS = [
    { glbPath: './room1.glb', audioPath: './room1theme.mp3' },
    { glbPath: './room2.glb', audioPath: null },
];

const isLocalFrontend = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
const AI_API_BASE = localStorage.getItem('ECHOLENS_API_BASE') || (isLocalFrontend ? 'http://localhost:8000' : window.location.origin);

const ANIM_DELAY      = 1.0;   // seconds before scale-in starts after postcard detected
const ANIM_DURATION   = 0.5;   // seconds for scale-in
const MODEL_SCALE     = 0.003; // base size relative to postcard
const MODEL_Y_OFFSET  = 0.15;
const MAX_RECORD_MS   = 10000;
const SWITCH_DURATION = 0.25;
const PULSE_SPEED     = 1.8;   // radians/sec → ~3.5s cycle between 1.0× and 1.1×

// --- State ---
let activeRoomIndex = 0;
let activeModel     = null;
let currentAudio    = null;
let isAudioPlaying  = false;
let trackerVisible  = false;
let modelsLoaded    = 0;

const loadedModels    = [null, null];
const customAudioUrls = [null, null];

let scaleAnim      = { running: false, startTime: 0, delay: ANIM_DELAY };
let roomSwitchAnim = { active: false, targetIndex: -1, startTime: 0 };
let mediaRecorder  = null;
let recordChunks   = [];
let recordTimeout  = null;
let isRecording    = false;
let overlayTimer   = null;

let recordCountdown         = 10;
let recordCountdownInterval = null;
let hasSeenRecordInfo       = false;

const memoryState = {
    result: null,
    isGenerating: false,
};
window.EchoLensMemoryState = memoryState;

// --- DOM refs ---
const overlay        = document.getElementById('scan-overlay');
const loadingGuide   = document.getElementById('loading-guide');
const scanGuide      = document.getElementById('scan-guide');
const hintBar        = document.getElementById('hint-bar');
const hintText       = document.getElementById('hint-text');
const recordOverlay  = document.getElementById('record-overlay');
const recordCount    = document.getElementById('record-count');
const welcomeScreen  = document.getElementById('welcome-screen');
const memoryForm     = document.getElementById('memory-form');
const composerLayout = document.getElementById('composer-layout');
const generateBtn    = document.getElementById('generate-btn');
const startBtn       = document.getElementById('start-btn');
const composerStatus = document.getElementById('composer-status');
const aiPreview      = document.getElementById('ai-preview');
const previewTitle   = document.getElementById('preview-title');
const previewMessage = document.getElementById('preview-message');
const previewMood    = document.getElementById('preview-mood');
const previewRoom    = document.getElementById('preview-room');
const previewFragments = document.getElementById('preview-fragments');
const memoryOverlay  = document.getElementById('memory-overlay');
const memoryOverlayMood = document.getElementById('memory-overlay-mood');
const memoryOverlayTitle = document.getElementById('memory-overlay-title');
const memoryOverlayMessage = document.getElementById('memory-overlay-message');
const memoryOverlayFragments = document.getElementById('memory-overlay-fragments');

// --- EchoLens Memory Composer ---
function cleanText(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    const text = value.replace(/\s+/g, ' ').trim();
    return text || fallback;
}

function readComposerPayload() {
    return {
        recipient: cleanText(document.getElementById('recipient-input').value, 'someone special'),
        occasion: cleanText(document.getElementById('occasion-input').value, 'shared memory'),
        message: cleanText(document.getElementById('message-input').value, 'A small moment worth keeping.'),
        tone: cleanText(document.getElementById('tone-select').value, 'warm').toLowerCase(),
    };
}

function toTitleCase(value) {
    return cleanText(value, 'Warm').replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeRoomIndex(index) {
    const numericIndex = Number(index);
    return Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < ROOMS.length ? numericIndex : 0;
}

function localFallbackMemory(payload) {
    const tone = cleanText(payload.tone, 'warm').toLowerCase();
    const recipient = cleanText(payload.recipient, 'someone special');
    const occasion = cleanText(payload.occasion, 'shared memory');
    const message = cleanText(payload.message, 'A small moment worth keeping.');
    const suggestedRoomIndex = ['romantic', 'nostalgic', 'cinematic'].includes(tone) ? 1 : 0;

    const moodByTone = {
        warm: 'Soft amber light with a calm, intimate glow',
        romantic: 'Moonlit rose reflections with quiet cinematic depth',
        funny: 'Bright playful color with buoyant postcard energy',
        nostalgic: 'Golden-hour haze with gentle echoes of the past',
        cinematic: 'Wide-screen shadows, luminous edges, and dramatic warmth',
        grateful: 'Clear morning light with tender celebratory accents',
    };

    return {
        title: `${recipient}'s ${toTitleCase(tone)} ${toTitleCase(occasion)}`,
        polished_message: `${recipient}, ${message} EchoLens turns this into a small immersive scene, holding the feeling close while the postcard comes alive.`,
        visual_mood: moodByTone[tone] || moodByTone.warm,
        memory_fragments: [
            `The first detail: ${occasion}.`,
            `The feeling: ${toTitleCase(tone)} and personal.`,
            `The keepsake: a postcard memory that opens in AR.`,
        ],
        suggested_room_index: suggestedRoomIndex,
        voiceover_prompt: `Read this in a ${tone} tone for ${recipient}: ${message}`,
    };
}

function normalizeMemoryResult(rawResult, payload) {
    const fallback = localFallbackMemory(payload);
    const fragments = Array.isArray(rawResult?.memory_fragments)
        ? rawResult.memory_fragments.map((item) => cleanText(String(item))).filter(Boolean).slice(0, 3)
        : [];

    while (fragments.length < 3) {
        fragments.push(fallback.memory_fragments[fragments.length]);
    }

    return {
        title: cleanText(rawResult?.title, fallback.title),
        polished_message: cleanText(rawResult?.polished_message, fallback.polished_message),
        visual_mood: cleanText(rawResult?.visual_mood, fallback.visual_mood),
        memory_fragments: fragments,
        suggested_room_index: normalizeRoomIndex(rawResult?.suggested_room_index ?? fallback.suggested_room_index),
        voiceover_prompt: cleanText(rawResult?.voiceover_prompt, fallback.voiceover_prompt),
    };
}

function setComposerLoading(isLoading) {
    memoryState.isGenerating = isLoading;
    memoryForm.classList.toggle('is-loading', isLoading);
    generateBtn.disabled = isLoading;
    generateBtn.textContent = isLoading ? 'Generating...' : 'Generate Memory';
    startBtn.disabled = isLoading || !memoryState.result;
}

function renderFragmentList(container, fragments) {
    container.replaceChildren();
    fragments.forEach((fragment) => {
        const item = document.createElement('li');
        item.textContent = fragment;
        container.appendChild(item);
    });
}

function updatePreview() {
    const result = memoryState.result;
    if (!result) {
        composerLayout.classList.remove('has-result');
        aiPreview.classList.add('hidden');
        return;
    }

    previewTitle.textContent = result.title;
    previewMessage.textContent = result.polished_message;
    previewMood.textContent = result.visual_mood;
    previewRoom.textContent = `Room ${result.suggested_room_index + 1}`;
    renderFragmentList(previewFragments, result.memory_fragments);
    composerLayout.classList.add('has-result');
    aiPreview.classList.remove('hidden');
}

function updateMemoryOverlay(isVisible = trackerVisible) {
    const result = memoryState.result;
    if (!result || !isVisible) {
        memoryOverlay.classList.add('hidden');
        return;
    }

    memoryOverlayMood.textContent = result.visual_mood;
    memoryOverlayTitle.textContent = result.title;
    memoryOverlayMessage.textContent = result.polished_message;
    renderFragmentList(memoryOverlayFragments, result.memory_fragments);
    memoryOverlay.classList.remove('hidden');
}

function applySuggestedRoom(result = memoryState.result) {
    if (!result) return;
    const suggestedRoomIndex = normalizeRoomIndex(result.suggested_room_index);
    if (suggestedRoomIndex !== activeRoomIndex) {
        requestRoomSwitch(suggestedRoomIndex);
    }
}

function setGeneratedMemory(rawResult, payload) {
    memoryState.result = normalizeMemoryResult(rawResult, payload);
    updatePreview();
    updateMemoryOverlay();
    applySuggestedRoom();
    startBtn.disabled = false;
}

async function generateMemory(event) {
    event.preventDefault();
    if (memoryState.isGenerating) return;

    const payload = readComposerPayload();
    setComposerLoading(true);
    composerStatus.textContent = 'Composing your memory with the EchoLens AI backend...';

    try {
        const response = await fetch(`${AI_API_BASE}/api/generate-memory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) throw new Error(`Memory API returned ${response.status}`);

        const result = await response.json();
        setGeneratedMemory(result, payload);
        composerStatus.textContent = 'Memory ready. You can start the AR experience.';
    } catch (err) {
        console.warn('Using local EchoLens fallback memory:', err);
        setGeneratedMemory(localFallbackMemory(payload), payload);
        composerStatus.textContent = 'Backend unavailable, so EchoLens prepared a local demo memory.';
    } finally {
        setComposerLoading(false);
    }
}

memoryForm.addEventListener('submit', generateMemory);

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setAnimationLoop(render);
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => renderer.setSize(window.innerWidth, window.innerHeight));

// --- Zappar camera ---
const camera = new ZapparThree.Camera();
ZapparThree.glContextSet(renderer.getContext());

// --- Scene ---
const scene = new THREE.Scene();
scene.background = null;

scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(0, 5, 5);
scene.add(dirLight);

// --- Image tracker ---
const manager      = new ZapparThree.LoadingManager();
const imageTracker = new ZapparThree.ImageTrackerLoader(manager).load('./postcard.zpt');
const trackerGroup = new ZapparThree.ImageAnchorGroup(camera, imageTracker);
scene.add(trackerGroup);

// --- Preload all room models (starts immediately in background) ---
const gltfLoader = new THREE.GLTFLoader(manager);

function onModelLoaded(gltf, i) {
    const model = gltf.scene;
    model.scale.setScalar(0);
    model.position.y = MODEL_Y_OFFSET;
    model.rotation.x = Math.PI / 2;
    loadedModels[i] = model;

    if (i === activeRoomIndex) setActiveRoom(i);

    modelsLoaded++;
    if (modelsLoaded === ROOMS.length) {
        loadingGuide.classList.add('guide-hidden');
        scanGuide.classList.remove('guide-hidden');
    }
}

function onModelError(i, err) {
    console.error('Room', i, 'failed to load:', err);
    modelsLoaded++;
    if (modelsLoaded === ROOMS.length) {
        loadingGuide.classList.add('guide-hidden');
        scanGuide.classList.remove('guide-hidden');
    }
}

ROOMS.forEach(({ glbPath }, i) => {
    gltfLoader.load(glbPath, (gltf) => onModelLoaded(gltf, i), undefined, (err) => onModelError(i, err));
});

// --- Start button: request camera permission, kick off AR ---
startBtn.addEventListener('click', () => {
    if (!memoryState.result) {
        const payload = readComposerPayload();
        setGeneratedMemory(localFallbackMemory(payload), payload);
    }

    applySuggestedRoom();
    welcomeScreen.classList.add('hidden');

    ZapparThree.permissionRequestUI().then((granted) => {
        if (granted) {
            camera.start();
            scene.background = camera.backgroundTexture;
        } else {
            ZapparThree.permissionDeniedUI();
        }
    });
});

// --- Room management ---
function setActiveRoom(index) {
    if (activeModel) trackerGroup.remove(activeModel);
    stopAudio();

    activeRoomIndex = index;
    activeModel     = loadedModels[index];

    if (!activeModel) return;

    activeModel.scale.setScalar(0);
    trackerGroup.add(activeModel);

    scaleAnim.running = false;
    trackerVisible    = false;

    document.querySelectorAll('.room-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
    });
}

// --- Scale-in animation (ease-out cubic, 0 → MODEL_SCALE) ---
function startScaleAnimation(delayOverride) {
    const delay = delayOverride !== undefined ? delayOverride : ANIM_DELAY;
    scaleAnim = { running: true, startTime: performance.now(), delay };
}

function updateScaleAnimation() {
    if (!scaleAnim.running || !activeModel) return;

    const elapsed = (performance.now() - scaleAnim.startTime) / 1000;
    if (elapsed < scaleAnim.delay) return;

    const t = Math.min((elapsed - scaleAnim.delay) / ANIM_DURATION, 1);
    activeModel.scale.setScalar(MODEL_SCALE * (1 - Math.pow(1 - t, 3)));

    if (t >= 1) scaleAnim.running = false;
}

// --- Idle pulse animation (MODEL_SCALE × 1.0 ↔ MODEL_SCALE × 1.1, looping) ---
function updatePulseAnimation() {
    if (!activeModel || !trackerVisible) return;
    if (scaleAnim.running || roomSwitchAnim.active) return;

    const t = performance.now() / 1000;
    // Oscillates between 1.0 and 1.1 times MODEL_SCALE
    activeModel.scale.setScalar(MODEL_SCALE * (1.05 + 0.05 * Math.sin(t * PULSE_SPEED)));
}

// --- Room switch animation (scale down → swap → scale up) ---
function requestRoomSwitch(index) {
    if (index === activeRoomIndex) return;
    if (roomSwitchAnim.active) return;

    if (activeModel && trackerVisible && activeModel.scale.x > 0) {
        scaleAnim.running = false;
        roomSwitchAnim = { active: true, targetIndex: index, startTime: performance.now() };
    } else {
        const wasVisible = trackerVisible;
        setActiveRoom(index);
        if (wasVisible) {
            trackerVisible = true;
            startScaleAnimation(0);
            playAudio();
        }
    }
    updateHint();
}

function updateRoomSwitchAnimation() {
    if (!roomSwitchAnim.active || !activeModel) return;

    const elapsed = (performance.now() - roomSwitchAnim.startTime) / 1000;
    const t       = Math.min(elapsed / SWITCH_DURATION, 1);
    activeModel.scale.setScalar(MODEL_SCALE * Math.pow(1 - t, 2));

    if (t >= 1) {
        const wasVisible = trackerVisible;
        roomSwitchAnim.active = false;
        setActiveRoom(roomSwitchAnim.targetIndex);
        if (wasVisible) {
            trackerVisible = true;
            startScaleAnimation(0);
            playAudio();
        }
        updateHint();
    }
}

// --- Overlay ---
function showOverlay() { overlay.classList.remove('hidden'); }
function hideOverlay()  { overlay.classList.add('hidden'); }

// --- Hint bar ---
function updateHint() {
    if (isAudioPlaying) {
        hintText.textContent = '🔊 Playing  ·  Tap anywhere to stop';
    } else if (customAudioUrls[activeRoomIndex]) {
        hintText.textContent = 'Tap anywhere to play your recording  ·  🎤 to re-record';
    } else if (ROOMS[activeRoomIndex].audioPath) {
        hintText.textContent = 'Tap anywhere to play audio  ·  🎤 to record your voice';
    } else {
        hintText.textContent = 'Tap 🎤 to record a voice note for this room';
    }
}

// --- Audio ---
function playAudio() {
    const src = customAudioUrls[activeRoomIndex] ?? ROOMS[activeRoomIndex].audioPath;
    if (!src) return;

    stopAudio();
    currentAudio = new Audio(src);
    currentAudio.onended = () => { isAudioPlaying = false; updateHint(); };
    currentAudio.play().catch(() => {});
    isAudioPlaying = true;
    updateHint();
}

function stopAudio() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }
    isAudioPlaying = false;
    updateHint();
}

function toggleAudio() {
    if (isAudioPlaying) stopAudio();
    else playAudio();
}

// Tap anywhere on the canvas to play/pause audio
renderer.domElement.addEventListener('click',    () => { if (trackerGroup.visible && activeModel) toggleAudio(); });
renderer.domElement.addEventListener('touchend', () => { if (trackerGroup.visible && activeModel) toggleAudio(); }, { passive: true });

// --- Voice recording ---
function showRecordOverlay() { recordOverlay.classList.remove('hidden'); }
function hideRecordOverlay() { recordOverlay.classList.add('hidden'); }

function startRecording() {
    if (isRecording) return;

    navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
            recordChunks = [];
            isRecording  = true;
            updateMicButton();

            recordCountdown = 10;
            recordCount.textContent = recordCountdown;
            showRecordOverlay();
            recordCountdownInterval = setInterval(() => {
                recordCountdown--;
                recordCount.textContent = recordCountdown;
                if (recordCountdown <= 0) {
                    clearInterval(recordCountdownInterval);
                    recordCountdownInterval = null;
                }
            }, 1000);

            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = (e) => recordChunks.push(e.data);
            mediaRecorder.onstop = () => {
                const blob = new Blob(recordChunks, { type: mediaRecorder.mimeType });
                if (customAudioUrls[activeRoomIndex]) {
                    URL.revokeObjectURL(customAudioUrls[activeRoomIndex]);
                }
                customAudioUrls[activeRoomIndex] = URL.createObjectURL(blob);
                recordChunks = [];
                isRecording  = false;
                updateMicButton();
                stream.getTracks().forEach((t) => t.stop());
                updateHint();
            };

            mediaRecorder.start();
            recordTimeout = setTimeout(stopRecording, MAX_RECORD_MS);
        })
        .catch(() => {
            isRecording = false;
            updateMicButton();
        });
}

function stopRecording() {
    if (!isRecording || !mediaRecorder) return;
    clearTimeout(recordTimeout);
    clearInterval(recordCountdownInterval);
    recordCountdownInterval = null;
    hideRecordOverlay();
    mediaRecorder.stop();
}

function updateMicButton() {
    const btn = document.getElementById('mic-btn');
    btn.classList.toggle('recording', isRecording);
    btn.title = isRecording ? 'Stop recording' : 'Record voice note';
}

// --- Recording info modal ---
function showRecordInfo() {
    document.getElementById('record-info-modal').classList.remove('hidden');
}
function hideRecordInfo() {
    document.getElementById('record-info-modal').classList.add('hidden');
}

document.getElementById('record-info-start').addEventListener('click', () => {
    hasSeenRecordInfo = true;
    hideRecordInfo();
    startRecording();
});

document.getElementById('record-info-cancel').addEventListener('click', hideRecordInfo);
document.getElementById('record-info-backdrop').addEventListener('click', hideRecordInfo);

// --- UI listeners ---
document.querySelectorAll('.room-btn').forEach((btn) => {
    btn.addEventListener('click', () => requestRoomSwitch(Number(btn.dataset.room)));
});

document.getElementById('mic-btn').addEventListener('click', () => {
    if (isRecording) {
        stopRecording();
    } else if (!hasSeenRecordInfo) {
        showRecordInfo();
    } else {
        startRecording();
    }
});

// --- Render loop ---
function render() {
    camera.updateFrame(renderer);

    const isVisible = trackerGroup.visible;

    if (isVisible && !trackerVisible) {
        clearTimeout(overlayTimer);
        hideOverlay();
        startScaleAnimation();
        playAudio();
        updateHint();
        updateMemoryOverlay(true);
        hintBar.classList.remove('hidden');
    }

    if (!isVisible && trackerVisible) {
        overlayTimer = setTimeout(showOverlay, 600);
        stopAudio();
        updateMemoryOverlay(false);
        hintBar.classList.add('hidden');
    }

    trackerVisible = isVisible;

    updateRoomSwitchAnimation();

    if (isVisible && activeModel) {
        updatePulseAnimation();
        updateScaleAnimation();
    }

    renderer.render(scene, camera);
}
