// Empty JavaScript file

// Sats Connect Wallet Integration
let playerWallet = null;

let labitbuImages = [];
// Connect to Xverse wallet using Sats Connect

let request, AddressPurpose;
let isConnecting = false;
let satsConnectReadyPromise = (async () => {
    try {
        const module = await import('https://esm.sh/sats-connect');
        request = module.request;
        AddressPurpose = module.AddressPurpose;
        console.log('Sats Connect module loaded successfully');
    } catch (err) {
        console.error('Failed to load Sats Connect module:', err);
    }
})();


async function connectXverseWallet() {
    if (isConnecting) {
        return;
    }
    isConnecting = true;

    const connectBtn = document.getElementById('connect-wallet-btn');
    if (connectBtn) {
        connectBtn.disabled = true;
        connectBtn.textContent = 'Connecting...';
        connectBtn.style.background = '#6c757d';
    }

    try {
        await satsConnectReadyPromise;
        if (!request || !AddressPurpose) {
            throw new Error('Wallet module not loaded. Please refresh and try again.');
        }
        const response = await request('wallet_connect', null);
        
        if (response.status === 'success') {
            const ordinalsAddressInfo = response.result.addresses.find(a => a.purpose === AddressPurpose.Ordinals);
            const paymentAddressInfo  = response.result.addresses.find(a => a.purpose === AddressPurpose.Payment);
            const chosen = ordinalsAddressInfo || paymentAddressInfo;
            if (chosen) {
                playerWallet = chosen.address;
                console.log('Connected to Xverse wallet (chosen):', playerWallet, 'purpose:', ordinalsAddressInfo ? 'Ordinals' : 'Payment');
                
                // Update UI
                const walletStatus = document.getElementById('wallet-status');
                if (walletStatus) {
                    walletStatus.textContent = 'Connected: ' + playerWallet.substring(0, 8) + '...';
                    walletStatus.style.color = '#28a745';
                }
                
                if (connectBtn) {
                    connectBtn.textContent = 'Wallet Connected';
                    connectBtn.disabled = true;
                    connectBtn.style.background = '#28a745';
                }
                
                // Show the Load Labitbu button
                const loadLabitbuBtn = document.getElementById('load-labitbu-btn');
                if (loadLabitbuBtn) {
                    loadLabitbuBtn.style.display = 'inline-block';
                }
            } else {
                console.error('No ordinals or payment address found');
                alert('No ordinals or payment address found in wallet response');
            }
        } else {
            console.error('Connection failed:', response.error);
            const msg = response?.error?.message || 'Unknown error';
            alert('Connection failed: ' + msg + '\n\nTips:\n- Approve the connection in the Xverse popup.\n- If you see code -32002, a request is already pending—close or finish the existing wallet prompt.\n- If previously denied, open Xverse → Settings → Connected apps → remove this site, then retry.\n- Ensure only one wallet extension is active.\n- Use a secure context (https or http://localhost).\n- This app expects Mainnet (bc1p...) addresses.');
        }
    } catch (err) {
        console.error('Wallet connection error:', err);
        alert('Wallet connection failed: ' + (err && err.message ? err.message : err));
    } finally {
        isConnecting = false;
        if (!playerWallet && connectBtn) {
            connectBtn.disabled = false;
            connectBtn.textContent = 'Connect Wallet';
            connectBtn.style.background = '';
        }
    }
}

// Load Labitbu function
async function loadLabitbu() {

    let satNumbers = [];
    let labitbuMintTxid = [];
    // Reset previously extracted images for a fresh selection
    labitbuImages = [];

    let address = '';
    let testAddressInput = document.getElementById('test-address-input');
    if (testAddressInput && testAddressInput.value.trim()) {
        address = testAddressInput.value.trim();
    } else if (typeof playerWallet === 'string' && playerWallet.length > 0) {
        address = playerWallet;
    } else {
        alert('No address found. Please connect your wallet or enter an address.');
        return;
    }
    // Fetch the outputs from thord.wizards.art
    let outputs = [];
    try {
        const url = `https://thord.wizards.art/outputs/${encodeURIComponent(address)}`;
        const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!resp.ok) {
            throw new Error(`Failed to fetch outputs: ${resp.statusText}`);
        }
        outputs = await resp.json();
    } catch (err) {
        console.error('Error fetching outputs:', err);
        alert('Failed to fetch outputs for address: ' + address);
        return;
    }

    // Collect sat ranges without expanding to individual sats to avoid huge arrays
    const satRanges = [];
    if (Array.isArray(outputs)) {
        for (const output of outputs) {
            if (Array.isArray(output.sat_ranges)) {
                for (const range of output.sat_ranges) {
                    // Each range is [start, end), inclusive of start, exclusive of end
                    if (
                        Array.isArray(range) &&
                        range.length === 2 &&
                        Number.isFinite(range[0]) &&
                        Number.isFinite(range[1]) &&
                        range[0] < range[1]
                    ) {
                        satRanges.push([range[0], range[1]]);
                    }
                }
            }
        }
    }
    
        console.log('Address being searched:', address);
    console.log('Number of outputs found:', outputs.length);
    console.log('Number of sat ranges found:', satRanges.length);
    console.log('All sat ranges:', satRanges);
    
    try {
        const labitbuResp = await fetch('labitbu.json');
        if (!labitbuResp.ok) {
            throw new Error(`Error loading labitbu.json: ${labitbuResp.statusText}`);
        }
        const labitbuData = await labitbuResp.json();
        
        // Helper to check if a sat is within any of the ranges
        function isSatInRanges(satValue) {
            for (let i = 0; i < satRanges.length; i++) {
                const [start, end] = satRanges[i];
                if (satValue >= start && satValue < end) {
                    return true;
                }
            }
            return false;
        }

        const seenTxids = new Set();
        let matchesFound = 0;
        for (let i = 0; i < labitbuData.length; i++) {
            const entry = labitbuData[i];
            const satNum = typeof entry.sat === 'string' ? Number(entry.sat) : entry.sat;
            
            if (Number.isFinite(satNum) && isSatInRanges(satNum)) {
                matchesFound++;
                const tx = entry.txid;
                if (tx && !seenTxids.has(tx)) {
                    seenTxids.add(tx);
                    labitbuMintTxid.push(tx);
                }
            }
        }
        
        console.log('Matches found between sat ranges and labitbu data:', matchesFound);
        console.log('Unique labitbu txids found:', labitbuMintTxid.length);
        
    } catch (err) {
        console.error('Error searching for sat:', err);
        return null;
    }

    // Use webp-extractor.js to extract the image using the txid
    if (Array.isArray(labitbuMintTxid) && labitbuMintTxid.length > 0) {
        // Assume WebPExtractor is available globally or imported
        const extractor = new WebPExtractor();
        try {
            if (typeof showLoading === 'function') showLoading('Extracting Labitbu images...');
            // Iterate over all found txids
            for (let i = 0; i < labitbuMintTxid.length; i++) {
                const txid = labitbuMintTxid[i];
                try {
                    const result = await extractor.extractImage(txid);
                    if (result && result.success && result.imageUrl) {
                        labitbuImages.push(result.imageUrl);
                    } else {
                        console.error('Image extraction failed for txid:', txid, result && result.error);
                    }
                } catch (err) {
                    console.error('Error extracting Labitbu image for txid:', txid, err);
                }
            }
            if (labitbuImages.length === 0) {
                alert('Failed to extract any Labitbu images.');
            } else {
                SelectLabitbu();
            }
            if (typeof hideLoading === 'function') hideLoading();
        } catch (err) {
            console.error('Error extracting Labitbu images:', err);
            alert('Error extracting Labitbu images: ' + (err && err.message ? err.message : err));
            if (typeof hideLoading === 'function') hideLoading();
        }
    } else {
        alert('No Labitbu mint txid found for the provided address.');
    }
}

function SelectLabitbu(){
    // If nothing to select, bail
    if (!Array.isArray(labitbuImages) || labitbuImages.length === 0) return;

    // Remove any existing overlay
    const existing = document.getElementById('labitbu-select-overlay');
    if (existing) existing.remove();

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'labitbu-select-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.6)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '9999';

    // Modal container
    const modal = document.createElement('div');
    modal.style.background = '#fff';
    modal.style.borderRadius = '8px';
    modal.style.padding = '16px';
    modal.style.maxWidth = '860px';
    modal.style.width = '90%';
    modal.style.boxShadow = '0 10px 30px rgba(0,0,0,0.2)';

    const title = document.createElement('div');
    title.textContent = 'Select your Labitbu';
    title.style.fontSize = '18px';
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '12px';
    title.style.textAlign = 'center';

    const hint = document.createElement('div');
    hint.textContent = 'Click an image to play as that Labitbu';
    hint.style.fontSize = '12px';
    hint.style.color = '#666';
    hint.style.marginBottom = '12px';
    hint.style.textAlign = 'center';

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(120px, 1fr))';
    grid.style.gap = '12px';
    grid.style.maxHeight = '60vh';
    grid.style.overflow = 'auto';

    // Build cards
    for (let i = 0; i < labitbuImages.length; i++) {
        const url = labitbuImages[i];
        const card = document.createElement('button');
        card.type = 'button';
        card.style.border = '1px solid #ddd';
        card.style.borderRadius = '6px';
        card.style.padding = '8px';
        card.style.background = '#fff';
        card.style.cursor = 'pointer';
        card.style.transition = 'transform 0.1s ease, box-shadow 0.1s ease';
        card.onmouseenter = () => { card.style.boxShadow = '0 4px 14px rgba(0,0,0,0.12)'; card.style.transform = 'translateY(-1px)'; };
        card.onmouseleave = () => { card.style.boxShadow = 'none'; card.style.transform = 'none'; };

        const img = document.createElement('img');
        img.src = url;
        img.alt = 'Labitbu';
        img.style.width = '100%';
        img.style.height = '120px';
        img.style.objectFit = 'contain';
        img.style.imageRendering = 'pixelated';

        card.appendChild(img);
        card.addEventListener('click', () => {
            try { console.log('Selected Labitbu URL:', url); } catch(_) {}
            const nextImg = new Image();
            // nextImg.crossOrigin = 'anonymous'; // not required for blob/object URLs, safe to leave commented
            nextImg.onload = () => {
                try { console.log('Labitbu image loaded', nextImg.width, nextImg.height); } catch(_) {}
                playerImg = nextImg;
            };
            nextImg.onerror = (e) => {
                try { console.error('Failed to load selected Labitbu image', e); } catch(_) {}
            };
            nextImg.src = url;
            overlay.remove();
        });

        grid.appendChild(card);
    }

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    closeBtn.style.marginTop = '12px';
    closeBtn.style.padding = '8px 12px';
    closeBtn.style.border = '1px solid #ccc';
    closeBtn.style.borderRadius = '4px';
    closeBtn.style.background = '#f5f5f5';
    closeBtn.style.cursor = 'pointer';
    closeBtn.addEventListener('click', () => overlay.remove());

    modal.appendChild(title);
    modal.appendChild(hint);
    modal.appendChild(grid);
    modal.appendChild(closeBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}


// Get the canvas and context
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Game state variables
let score = 0;
let distanceTraveled = 0;
let highScore = localStorage.getItem('labitbuHighScore') || 0;

// Set canvas size
canvas.width = 1080;
canvas.height = 300;

// Set pixel-perfect rendering for pixel art
ctx.imageSmoothingEnabled = false;
ctx.imageSmoothingQuality = 'low'; // Ensures fastest, sharpest rendering
ctx.mozImageSmoothingEnabled = false; // Firefox
ctx.webkitImageSmoothingEnabled = false; // Safari/Chrome
ctx.msImageSmoothingEnabled = false; // Internet Explorer

// Get display elements
const speedDisplay = document.getElementById('speed');
const distanceDisplay = document.getElementById('distance');
const scoreDisplay = document.getElementById('score');
const highScoreDisplay = document.getElementById('high-score');

// Background properties
const background = {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
    speed: 4.5
};

// Player properties
const player = {
    x: 100,
    y: canvas.height - 100,
    width: 45,
    height: 59,
    velocityY: 0,
    isJumping: false,
    isDying: false,
    hopOffset: 0, // For side-to-side hopping animation
    hopSpeed: 0 // Animation speed that increases with game speed
};

// Obstacle system - similar to a List<Obstacle> in C#
const obstacles = []; // Array to hold all active obstacles
const obstacleTypes = [
    { name: 'matcha.png', width: 32, height: 48, size: 1.75, outline: 0, yOffset: 0},
    { name: 'wave.png', width: 48, height: 64, size: 1.75, outline: 10, yOffset: 20},
    { name: 'btc-knots.png', width: 40, height: 40, size: 1.75, outline: 10, yOffset: 0},
    { name: 'filter-net.png', width: 40, height: 40, size: 1.75, outline: 10, yOffset: 0},
    // Add more obstacle types here
];

// Cloud system for background atmosphere
const clouds = []; // Array to hold all active clouds
const cloudTypes = [
    { name: 'cloud1.webp', width: 80, height: 40, size: 1.0, yOffset: 20},
    { name: 'cloud2.webp', width: 60, height: 30, size: 1.0, yOffset: 60},
    { name: 'cloud3.png', width: 100, height: 50, size: 1.0, yOffset: 10},
    { name: 'cloud4.png', width: 120, height: 120, size: 1.75, yOffset: 0},
    { name: 'cloud5.png', width: 120, height: 120, size: 1.75, yOffset: 0}
    // Add more cloud types here
];

// Load background image
const backgroundImg = new Image();
backgroundImg.src = 'Game-Img/Background.png';

// Load player image
let playerImg = new Image();
playerImg.src = 'Game-Img/labitbu.webp';

// Load obstacle images
const obstacleImages = [];
obstacleTypes.forEach(type => {
    const img = new Image();
            img.src = `Game-Img/obstacle/${type.name}`;
    obstacleImages.push(img);
});

// Load cloud images
const cloudImages = [];
cloudTypes.forEach(type => {
    const img = new Image();
            img.src = `Game-Img/clouds/${type.name}`;
    cloudImages.push(img);
});

// Create a scrolling background using the image
function drawBackground() {
    // Calculate proper scaling to maintain aspect ratio
    const bgAspectRatio = 512 / 48; // width / height
    const canvasAspectRatio = canvas.width / canvas.height;
    
    // Scale the background to fit the canvas height while maintaining aspect ratio
    const bgHeight = canvas.height;
    const bgWidth = bgHeight * bgAspectRatio;
    
    // Draw the background image with proper scaling
    ctx.drawImage(backgroundImg, background.x, 0, bgWidth, bgHeight);
    ctx.drawImage(backgroundImg, background.x + bgWidth, 0, bgWidth, bgHeight);
    
    // Reset background position when it moves completely off screen
    if (background.x <= -bgWidth) {
        background.x = 0;
    }
}

// Draw the player
function drawPlayer() {
    // Update hop animation speed based on game speed
    player.hopSpeed = background.speed * 0.8; // Animation speed scales with game speed
    
    // Update hop offset for up-and-down movement
    player.hopOffset += player.hopSpeed;
    
    // Only apply hopping animation when grounded (not jumping)
    const groundY = canvas.height - player.height - 20;
    const isGrounded = player.y >= groundY - 1; // Small tolerance for floating point
    
    let hopAmount = 0;
    if (isGrounded && !player.isDying) {
        // Up and down movement when grounded - fixed height regardless of speed
        hopAmount = Math.sin(player.hopOffset * 0.1) * 2; // Fixed 2-pixel hop height
    }
    
    // Review and correct the squash/stretch math for the player
    // The idea is to squash the player horizontally and stretch vertically as they get closer to the ground (i.e., during a jump/fall)
    // We'll use a squash factor based on how far above the ground the player is

    const jumpProgress = Math.max(0, groundY - player.y); // 0 when on ground, positive when above ground

    // Define squash/stretch parameters
    const maxSquash = 0.8; // Minimum width as a fraction of normal width (squash at peak jump)
    const minSquash = 1.0; // Normal width (on ground)
    const squashRange = 15; // How many pixels above ground to reach max squash

    // Calculate squash factor (1.0 on ground, down to maxSquash at peak)
    let squashFactor = minSquash - Math.abs(player.velocityY) * (minSquash - maxSquash) / squashRange;
    squashFactor = Math.max(maxSquash, Math.min(minSquash, squashFactor));

    const squashWidth = player.width * squashFactor;
    const squashHeight = player.height / squashFactor; // Keep area roughly constant
    
    // Draw player with hop animation (up/down when grounded) and squash/stretch
    ctx.drawImage(playerImg, player.x + (player.width - squashWidth) / 2, player.y - hopAmount, squashWidth, squashHeight);
}

// Create a new obstacle
function createObstacle() {
    if (Math.random() < 1) {
        const typeIndex = Math.floor(Math.random() * obstacleTypes.length);
        const type = obstacleTypes[typeIndex];
        
        const obstacle = {
            x: canvas.width,
            y: canvas.height - type.height * type.size - 20 + type.yOffset, // Ground level + yOffset
            width: type.width * type.size,
            height: type.height * type.size,
            typeIndex: typeIndex
        };
        
        obstacles.push(obstacle); // Add to array
    }
}

// Create a new cloud
function createCloud() {
    if (Math.random() < 0.3) { // 30% chance to spawn a cloud
        const typeIndex = Math.floor(Math.random() * cloudTypes.length);
        const type = cloudTypes[typeIndex];
        
        const cloud = {
            x: canvas.width,
            y: type.yOffset, // Use yOffset for cloud height
            width: type.width * type.size,
            height: type.height * type.size,
            typeIndex: typeIndex
        };
        
        clouds.push(cloud); // Add to array
    }
}

// Update all clouds
function updateClouds() {
    // Update each cloud
    for (let i = clouds.length - 1; i >= 0; i--) {
        const cloud = clouds[i];
        cloud.x -= background.speed * 0.5; // Clouds move at half background speed for parallax effect
        
        // Remove clouds that are off screen
        if (cloud.x + cloud.width < 0) {
            clouds.splice(i, 1);
        }
    }
}

// Draw all clouds
function drawClouds() {
    ctx.save(); // Save current context state
    ctx.globalAlpha = 0.3; // Set 30% transparency
    
    clouds.forEach(cloud => {
        // Draw the cloud image
        ctx.drawImage(cloudImages[cloud.typeIndex], cloud.x, cloud.y, cloud.width, cloud.height);
    });
    
    ctx.restore(); // Restore context state
}

// Update all obstacles
function updateObstacles() {
    // Update each obstacle (like foreach in C#)
    for (let i = obstacles.length - 1; i >= 0; i--) {
        const obstacle = obstacles[i];
        obstacle.x -= background.speed; // Use current background speed
        
        // Remove obstacles that are off screen (like List.RemoveAt() in C#)
        if (obstacle.x + obstacle.width < 0) {
            obstacles.splice(i, 1);
        }
    }
}

// Draw all obstacles
function drawObstacles() {
    obstacles.forEach(obstacle => {
        // Draw the obstacle image
        ctx.drawImage(obstacleImages[obstacle.typeIndex], obstacle.x, obstacle.y, obstacle.width, obstacle.height);
    });
}

// Check collision between player and obstacles
function checkCollisions() {
    obstacles.forEach(obstacle => {
        if (player.x < obstacle.x + obstacle.width &&
            player.x + player.width > obstacle.x &&
            player.y < obstacle.y + obstacle.height &&
            player.y + player.height > obstacle.y) {
            // Collision detected!
            gameOver();
        }
    });
}

// Update player physics
function updatePlayer() {
    // Apply gravity
    if (!player.isDying) {
        player.velocityY += 0.8;
        player.y += player.velocityY;
        
        // Ground collision - adjust for player height
        const groundY = canvas.height - player.height - 20;
        if (player.y > groundY) {
            player.y = groundY;
            player.velocityY = 0;
            player.isJumping = false;
        }
    } else {
        // When dying, just move left without physics
        player.x -= background.speed;
    }
}

// Handle keyboard input
document.addEventListener('keydown', function(event) {
    // Jump controls - multiple keys supported
    if ((event.code === 'Space' || 
         event.code === 'ArrowUp' || 
         event.code === 'KeyW') && 
        !player.isJumping) {
        if (!player.isDying) {
            player.velocityY = -18;
            player.isJumping = true;
        }
    }
    
    // Fast fall controls
    if (event.code === 'ArrowDown' || event.code === 'KeyS') {
        player.velocityY += 2; // Make player fall faster
    }
});

// Obstacle spawning timer
let obstacleTimer = 0;
const obstacleSpawnRate = 120; // Frames between obstacles

// Cloud spawning timer
let cloudTimer = 0;
const cloudSpawnRate = 160; // Frames between cloud spawn attempts

const speedAcceleration = 0.001;

// Update displays
function updateDisplays() {
    if (speedDisplay) speedDisplay.textContent = background.speed.toFixed(2);
    if (distanceDisplay) distanceDisplay.textContent = Math.floor(distanceTraveled);
    if (scoreDisplay) scoreDisplay.textContent = Math.floor(score);
    if (highScoreDisplay) highScoreDisplay.textContent = Math.floor(highScore);
}

// Animation loop
function gameLoop() {
    // Update game speed
    background.speed += speedAcceleration;
    
    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Update background position
    background.x -= background.speed;
    
    // Spawn obstacles
    obstacleTimer++;
    if (obstacleTimer >= obstacleSpawnRate) {
        createObstacle();
        obstacleTimer = 0;
    }
    
    // Spawn clouds
    cloudTimer++;
    if (cloudTimer >= cloudSpawnRate) {
        createCloud();
        cloudTimer = 0;
    }
    
    // Update all game objects
    updatePlayer();
    updateObstacles();
    updateClouds();
    
    checkCollisions();
    
    // Draw everything (clouds first for background effect)
    drawBackground();
    drawClouds();
    drawPlayer();
    
    drawObstacles();
    
    // Update score and distance
    distanceTraveled += background.speed;
    score += background.speed;
    
    // Update displays
    updateDisplays();
    
    requestAnimationFrame(gameLoop);
}

// Start the game loop when all images are loaded
let imagesLoaded = 0;
const totalImages = 2 + obstacleImages.length + cloudImages.length; // background + player + obstacles + clouds

function checkImagesLoaded() {
    imagesLoaded++;
    if (imagesLoaded === totalImages) {
        gameLoop();
    }
}

function gameOver() {
    
    // Check for new high score
    const currentScore = Math.floor(score);
    if (currentScore > highScore) {
        highScore = currentScore;
        localStorage.setItem('labitbuHighScore', highScore);
    }
    player.isDying = true;
    setTimeout(restartGame, 1000);
}


function restartGame() {

    // Reset all game variables to start over
    background.x = 0;
    background.speed = 4.5;

    // Reset player
    player.x = 100;
    player.y = canvas.height - 100;
    player.velocityY = 0;
    player.isJumping = false;
    player.isDying = false;
    player.hopOffset = 0;

    // Reset obstacles
    obstacles.length = 0; // Clear array without reassigning
    obstacleTimer = 0;
    clouds.length = 0;
    cloudTimer = 0;

    // Reset stats
    distanceTraveled = 0;
    score = 0;

    // Reset displays

    updatePlayer();
    

    updateDisplays();
    
    // Don't reload images - they're already loaded and working fine!
}

// Add event listener for wallet connection button
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, checking for Sats Connect...');
    
    // Debug: Check what's available
    setTimeout(() => {
        console.log('Available globals after load:', Object.keys(window).filter(key => key.toLowerCase().includes('sats') || key.toLowerCase().includes('wallet') || key.toLowerCase().includes('xverse')));
        
        if (window.Wallet) {
            console.log('Sats Connect Wallet found:', window.Wallet);
        } else if (window.XverseProviders) {
            console.log('XverseProviders found:', window.XverseProviders);
        } else if (window.SatsConnect) {
            console.log('SatsConnect found:', window.SatsConnect);
        } else if (window.satsConnect) {
            console.log('satsConnect found:', window.satsConnect);
        } else {
            console.log('No wallet provider found in global scope');
        }
    }, 1000);
    
    const connectWalletBtn = document.getElementById('connect-wallet-btn');
    if (connectWalletBtn) {
        connectWalletBtn.addEventListener('click', connectXverseWallet);
    }
    
    const loadLabitbuBtn = document.getElementById('load-labitbu-btn');
    if (loadLabitbuBtn) {
        loadLabitbuBtn.addEventListener('click', loadLabitbu);
    }
    
    const restartBtn = document.getElementById('restart-btn');
    if (restartBtn) {
        restartBtn.addEventListener('click', restartGame);
    }
});

backgroundImg.onload = checkImagesLoaded;
playerImg.onload = checkImagesLoaded;
obstacleImages.forEach(img => img.onload = checkImagesLoaded);
cloudImages.forEach(img => img.onload = checkImagesLoaded);

// Initialize high score display
updateDisplays();
