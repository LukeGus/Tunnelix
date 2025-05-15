const http = require("http");
const socketIo = require("socket.io");
const SSHClient = require("ssh2").Client;
const { exec } = require("child_process");

const server = http.createServer();
const io = socketIo(server, {
    path: "/ssh.io/socket.io",
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    allowEIO3: true,
    pingInterval: 2000,
    pingTimeout: 10000,
    maxHttpBufferSize: 1e7,
    connectTimeout: 15000,
    transports: ['websocket', 'polling'],
});

// Simplified logger that focuses on essential information
const logger = {
    info: (...args) => console.log(`🖥️ | 🔧 [${new Date().toISOString()}] INFO:`, ...args),
    error: (...args) => console.error(`🖥️ | ❌  [${new Date().toISOString()}] ERROR:`, ...args),
    warn: (...args) => console.warn(`🖥️ | ⚠️ [${new Date().toISOString()}] WARN:`, ...args),
    debug: (...args) => console.debug(`🖥️ | 🔍 [${new Date().toISOString()}] DEBUG:`, ...args)
};

// Restart with a cleaner state management
const activeTunnels = new Map();
const retryCounters = new Map(); // Maps tunnel name to current retry count
const connectionStatus = new Map();
const tunnelVerifications = new Map();
const manualDisconnects = new Set();
const verificationTimers = new Map();
const activeRetryTimers = new Map(); // Track active retry timers by tunnel name
const retryExhaustedTunnels = new Set();
const remoteClosureEvents = new Map(); // Maps tunnel name to count of remote closure events

// Constants
const CONNECTION_STATES = {
    DISCONNECTED: "disconnected",
    CONNECTING: "connecting",
    CONNECTED: "connected",
    VERIFYING: "verifying",
    FAILED: "failed",
    UNSTABLE: "unstable",
    RETRYING: "retrying"
};

const ERROR_TYPES = {
    AUTH: "authentication",
    NETWORK: "network",
    PORT: "port_conflict",
    PERMISSION: "permission",
    TIMEOUT: "timeout",
    UNKNOWN: "unknown"
};

function broadcastTunnelStatus(tunnelName, status) {
    // Prevent marking as connected during an active retry cycle
    if (status.status === CONNECTION_STATES.CONNECTED && activeRetryTimers.has(tunnelName)) {
        return; // Don't broadcast 'connected' while a retry is scheduled
    }
    
    // If tunnel has exhausted retries, always show that reason
    if (retryExhaustedTunnels.has(tunnelName) && status.status === CONNECTION_STATES.FAILED) {
        status.reason = "Max retries exhausted";
    }
    
    io.emit("individualTunnelStatus", { 
        name: tunnelName,
        status: status
    });
    connectionStatus.set(tunnelName, status);
}

function broadcastAllTunnelStatus(socket) {
    const tunnelStatus = {};
    
    connectionStatus.forEach((status, key) => {
        tunnelStatus[key] = status;
    });
    
    socket.emit("tunnelStatus", tunnelStatus);
}

// Completely rewrite the handleDisconnect function with a simpler approach
function handleDisconnect(tunnelName, hostConfig, shouldRetry = true, socket = null, isRemoteClosure = false) {
    logger.info(`Disconnecting tunnel: ${tunnelName}`);
    
    // Cancel any verification in progress
    if (tunnelVerifications.has(tunnelName)) {
        try {
            const verification = tunnelVerifications.get(tunnelName);
            if (verification.timeout) clearTimeout(verification.timeout);
            verification.conn.end();
        } catch (e) {}
        tunnelVerifications.delete(tunnelName);
    }
    
    // Clean up any existing connections
    cleanupTunnelResources(tunnelName);
    
    // If it's a manual disconnect, just update UI and return
    if (manualDisconnects.has(tunnelName)) {
        // Clear any retry state
        resetRetryState(tunnelName);
        
        broadcastTunnelStatus(tunnelName, { 
            connected: false, 
            status: CONNECTION_STATES.DISCONNECTED,
            manualDisconnect: true
        });
        return;
    }
    
    // For remote closures, track this event
    if (isRemoteClosure) {
        const currentCount = remoteClosureEvents.get(tunnelName) || 0;
        remoteClosureEvents.set(tunnelName, currentCount + 1);
        
        // Force status to FAILED to prevent it from showing connected between retries
        broadcastTunnelStatus(tunnelName, {
            connected: false,
            status: CONNECTION_STATES.FAILED,
            reason: "Remote host disconnected"
        });
        
        // For the first remote closure in a sequence, reset any retry counters
        if (currentCount === 0) {
            retryCounters.delete(tunnelName);
        }
    }
    
    // For remote closures, reset the exhausted status to ensure retries work properly
    if (isRemoteClosure && retryExhaustedTunnels.has(tunnelName)) {
        retryExhaustedTunnels.delete(tunnelName);
    }
    
    // If this tunnel already exhausted its retries, don't retry again
    if (retryExhaustedTunnels.has(tunnelName)) {
        broadcastTunnelStatus(tunnelName, { 
            connected: false, 
            status: CONNECTION_STATES.FAILED,
            reason: "Max retries already exhausted"
        });
        return;
    }
    
    // If we already have an active retry timer, don't start another one
    if (activeRetryTimers.has(tunnelName)) {
        return;
    }
    
    // Handle retries if requested and we have config
    if (shouldRetry && hostConfig && hostConfig.retryConfig) {
        const maxRetries = hostConfig.retryConfig.maxRetries || 3;
        const retryInterval = hostConfig.retryConfig.retryInterval || 5000;
        
        // For remote closures, track the event separately to ensure proper retry count
        if (isRemoteClosure) {
            const currentCount = remoteClosureEvents.get(tunnelName) || 0;
            remoteClosureEvents.set(tunnelName, currentCount + 1);
            
            // If this is the first remote closure, reset retry counter to ensure at least one retry
            if (currentCount === 0) {
                retryCounters.delete(tunnelName);
            }
        }
        
        // Get the current retry count for this tunnel
        let retryCount = (retryCounters.get(tunnelName) || 0) + 1;
        
        // Ensure we don't exceed maxRetries
        if (retryCount > maxRetries) {
            logger.error(`All ${maxRetries} retries failed for ${tunnelName}`);
            
            // Mark this tunnel as having exhausted retries
            retryExhaustedTunnels.add(tunnelName);
            
            // Remove any active tunnels
            activeTunnels.delete(tunnelName);
            
            // Clear retry state
            retryCounters.delete(tunnelName);
            
            // Update UI to show failure
            broadcastTunnelStatus(tunnelName, { 
                connected: false, 
                status: CONNECTION_STATES.FAILED,
                retryExhausted: true,
                reason: `Max retries exhausted`
            });
            return;
        }
        
        // Update the retry counter with the new value
        retryCounters.set(tunnelName, retryCount);
        
        // Check if we should retry
        if (retryCount <= maxRetries) {
            // Update UI to show we're retrying
            broadcastTunnelStatus(tunnelName, { 
                connected: false, 
                status: CONNECTION_STATES.RETRYING, 
                retryCount: retryCount,
                maxRetries: maxRetries,
                nextRetryIn: retryInterval/1000
            });
            
            // Cancel any existing retry timer
            if (activeRetryTimers.has(tunnelName)) {
                clearTimeout(activeRetryTimers.get(tunnelName));
                activeRetryTimers.delete(tunnelName);
            }
            
            // Schedule the retry
            const timer = setTimeout(() => {
                activeRetryTimers.delete(tunnelName);
                
                // Only retry if not manually disconnected
                if (!manualDisconnects.has(tunnelName)) {
                    // Clear any previous connection state
                    activeTunnels.delete(tunnelName);
                    
                    // Connect with retry count
                    connectSSHTunnel(hostConfig, retryCount, socket);
                }
            }, retryInterval);
            
            activeRetryTimers.set(tunnelName, timer);
        }
    } else {
        // No retry requested, mark as failed
        broadcastTunnelStatus(tunnelName, { 
            connected: false, 
            status: CONNECTION_STATES.FAILED
        });
        
        // Ensure any active tunnels are removed
        activeTunnels.delete(tunnelName);
    }
}

// Helper function to clean up all resources for a tunnel
function cleanupTunnelResources(tunnelName) {
    // Clean up active connection
    if (activeTunnels.has(tunnelName)) {
        try {
            const conn = activeTunnels.get(tunnelName);
            if (conn) conn.end();
        } catch (e) {}
        activeTunnels.delete(tunnelName);
    }
    
    // Clean up verification process
    if (tunnelVerifications.has(tunnelName)) {
        const verification = tunnelVerifications.get(tunnelName);
        if (verification.timeout) clearTimeout(verification.timeout);
        try {
            verification.conn.end();
        } catch (e) {}
        tunnelVerifications.delete(tunnelName);
    }
    
    // Clean up all timers
    const timerKeys = [
        tunnelName,
        `${tunnelName}_confirm`,
        `${tunnelName}_retry`,
        `${tunnelName}_verify_retry`
    ];
    
    timerKeys.forEach(key => {
        if (verificationTimers.has(key)) {
            clearTimeout(verificationTimers.get(key));
            verificationTimers.delete(key);
        }
    });
    
    // Clean up retry timer
    if (activeRetryTimers.has(tunnelName)) {
        clearTimeout(activeRetryTimers.get(tunnelName));
        activeRetryTimers.delete(tunnelName);
    }
}

// Modify verifyTunnelConnection to pass socket to cleanupVerification
function verifyTunnelConnection(tunnelName, hostConfig, isPeriodic = false, socket = null) {
    const endpointPort = hostConfig.endPointPort;
    
    // Skip verification if the tunnel is no longer in activeTunnels
    if (!activeTunnels.has(tunnelName)) {
        if (!isPeriodic) {
            // For initial verification, mark it as failed
            broadcastTunnelStatus(tunnelName, { connected: false, status: CONNECTION_STATES.FAILED });
        }
        return;
    }
    
    // Skip verification if retries have been exhausted
    if (retryExhaustedTunnels.has(tunnelName)) {
        broadcastTunnelStatus(tunnelName, { 
            connected: false, 
            status: CONNECTION_STATES.FAILED,
            reason: "Max retries already exhausted"
        });
        return;
    }
    
    // Skip verification if a retry is in progress 
    if (activeRetryTimers.has(tunnelName)) {
        return;
    }
    
    // Skip verification if we've had remote closures during retry
    const isInRemoteRetryProcess = remoteClosureEvents.get(tunnelName) && retryCounters.get(tunnelName) > 0;
    if (isInRemoteRetryProcess && !isPeriodic) {
        return;
    }
    
    // Set status to verifying only if it's not a periodic check
    if (!isPeriodic) {
        broadcastTunnelStatus(tunnelName, { connected: false, status: CONNECTION_STATES.VERIFYING });
    }
    
    // For periodic checks, allow more retries before failing
    let verificationAttempts = isPeriodic ? 0 : null;
    const maxVerificationAttempts = 3;
    
    function attemptVerification() {
        // If we're doing periodic checks, increment the attempts
        if (isPeriodic) {
            verificationAttempts++;
        }
        
        // Double-check if tunnel is still active before starting verification
        if (!activeTunnels.has(tunnelName)) {
            logger.error(`Tunnel '${tunnelName}' disappeared before verification could start`);
            cleanupVerification(false, "Connection lost before verification could start");
            return;
        }
        
        // Create verification connection to test the tunnel actually works
        const verificationConn = new SSHClient();
        let verificationTimeout;
        
        // Add a quick timeout for the initial connection check
        let initialConnectTimeout = setTimeout(() => {
            cleanupVerification(false, "Connection timeout during verification");
        }, 8000);
        
        verificationConn.on("ready", () => {
            clearTimeout(initialConnectTimeout);
            
            // Execute a command to check if the port is listening on the endpoint
            const checkCmd = `sshpass -p '${hostConfig.endPointPassword}' ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${hostConfig.endPointUser}@${hostConfig.endPointIp} "nc -z localhost ${hostConfig.endPointPort} && echo 'PORT_ACTIVE' || echo 'PORT_INACTIVE'"`;
            
            verificationConn.exec(checkCmd, (err, stream) => {
                if (err) {
                    cleanupVerification(false, err.message);
                    return;
                }
                
                let output = '';
                let hasReceivedData = false;
                
                stream.on("data", (data) => {
                    hasReceivedData = true;
                    output += data.toString();
                });
                
                stream.stderr.on("data", (data) => {
                    // Only log serious errors
                    if (data.toString().includes('ERROR') || data.toString().includes('FAILURE')) {
                        // Do nothing - removed logger call
                    }
                });
                
                stream.on("close", (code) => {
                    // If we received no data, that's a failure
                    if (!hasReceivedData) {
                        logger.error(`Verification failed for '${tunnelName}': No data received from port check`);
                        cleanupVerification(false, "No data received from port check");
                        return;
                    }
                    
                    if (output.includes('PORT_ACTIVE')) {
                        cleanupVerification(true);
                    } else {
                        cleanupVerification(false, "Port is not accessible on remote host");
                    }
                });
            });
        });
        
        verificationConn.on("error", (err) => {
            clearTimeout(initialConnectTimeout);
            
            // If this is a remote host closure, mark as failed immediately
            const isRemoteHostClosure = err.message.toLowerCase().includes("closed by remote host") ||
                                       err.message.toLowerCase().includes("connection reset by peer") ||
                                       err.message.toLowerCase().includes("broken pipe");
            if (isRemoteHostClosure) {
                logger.error(`Remote host closed connection during verification for '${tunnelName}'`);
                
                // For remote closures, reset exhausted state if necessary
                if (retryExhaustedTunnels.has(tunnelName)) {
                    retryExhaustedTunnels.delete(tunnelName);
                    retryCounters.delete(tunnelName);
                }
                
                cleanupVerification(false, "Remote host closed connection");
                return;
            }
            
            cleanupVerification(false, err.message);
        });
        
        // Set verification timeout - don't hang forever
        verificationTimeout = setTimeout(() => {
            cleanupVerification(false, "Verification timeout");
        }, 15000);
        
        // Store reference to verification connection and timeout
        tunnelVerifications.set(tunnelName, {
            conn: verificationConn,
            timeout: verificationTimeout
        });
        
        // Connect to source server to perform verification
        verificationConn.connect({
            host: hostConfig.sourceIp,
            port: hostConfig.sourceSSHPort,
            username: hostConfig.sourceUser,
            password: hostConfig.sourcePassword || undefined,
            readyTimeout: 10000
        });
        
        function cleanupVerification(isSuccessful, failureReason = "Unknown verification failure") {
            // Clear timeout if it's still active
            if (verificationTimeout) {
                clearTimeout(verificationTimeout);
            }
            
            // Clear initial connection timeout if it exists
            if (initialConnectTimeout) {
                clearTimeout(initialConnectTimeout);
            }
            
            // Clean up verification connection
            try {
                verificationConn.end();
            } catch (err) {}
            
            // Remove from tracking
            tunnelVerifications.delete(tunnelName);
            
            // Check if this is a retry after a remote closure
            const hadRemoteClosure = remoteClosureEvents.get(tunnelName) && retryCounters.get(tunnelName) > 0;
            
            // Never mark as successful if a retry is in progress or if we've had a remote closure
            if ((isSuccessful && activeRetryTimers.has(tunnelName)) || (isSuccessful && hadRemoteClosure)) {
                isSuccessful = false;
                failureReason = activeRetryTimers.has(tunnelName) ? 
                    "Retry in progress - ignoring successful verification" : 
                    "Previous remote closure - verification likely incorrect";
            }
            
            // Update status based on result
            if (isSuccessful) {
                // Double-check if the tunnel is still active before marking as connected
                if (!activeTunnels.has(tunnelName)) {
                    logger.error(`Tunnel '${tunnelName}' disappeared during verification - marking as failed`);
                    broadcastTunnelStatus(tunnelName, { 
                        connected: false, 
                        status: CONNECTION_STATES.FAILED,
                        reason: "Connection lost during verification"
                    });
                    return;
                }
                
                // Check if the tunnel is in the process of retrying
                if (activeRetryTimers.has(tunnelName)) {
                    return;
                }
                
                // Triple-check: Make sure we can still access the tunnel's connection
                const conn = activeTunnels.get(tunnelName);
                if (!conn || !conn.exec) {
                    logger.error(`Tunnel '${tunnelName}' connection object is invalid - marking as failed`);
                    broadcastTunnelStatus(tunnelName, { 
                        connected: false, 
                        status: CONNECTION_STATES.FAILED,
                        reason: "Connection became invalid during verification"
                    });
                    activeTunnels.delete(tunnelName);
                    return;
                }
                
                // For periodic checks, only update if there's been a change in status
                const currentStatus = connectionStatus.get(tunnelName);
                const isCurrentlyConnected = currentStatus && 
                                            currentStatus.connected && 
                                            currentStatus.status === CONNECTION_STATES.CONNECTED;
                                            
                // Only broadcast if not currently connected or if it's not a periodic check and not after a remote closure
                if ((!isPeriodic || !isCurrentlyConnected) && !hadRemoteClosure) {
                    // Perform a quick command to ensure connection is truly alive
                    conn.exec('echo verify', (err) => {
                        if (err) {
                            logger.error(`Final verification failed for '${tunnelName}': ${err.message}`);
                            broadcastTunnelStatus(tunnelName, { 
                                connected: false, 
                                status: CONNECTION_STATES.FAILED,
                                reason: "Connection failed final verification check"
                            });
                            activeTunnels.delete(tunnelName);
                            return;
                        }
                        
                        // Only now mark as connected
                        broadcastTunnelStatus(tunnelName, { connected: true, status: CONNECTION_STATES.CONNECTED });
                    });
                }
                
                // Schedule periodic verification if config has a refresh interval
                if (hostConfig.refreshInterval) {
                    if (verificationTimers.has(tunnelName)) {
                        clearTimeout(verificationTimers.get(tunnelName));
                    }
                    
                    const timer = setTimeout(() => {
                        // Only verify if tunnel is still marked as connected
                        const latestStatus = connectionStatus.get(tunnelName);
                        if (latestStatus && latestStatus.status === CONNECTION_STATES.CONNECTED) {
                            verifyTunnelConnection(tunnelName, hostConfig, true, socket); // Note the true for isPeriodic
                        }
                    }, hostConfig.refreshInterval);
                    
                    verificationTimers.set(tunnelName, timer);
                }
            } else {
                // For periodic checks that fail, give more attempts before failing
                if (isPeriodic) {
                    // If we've tried enough times, mark as unstable/failed
                    if (verificationAttempts >= maxVerificationAttempts) {
                        // Check if there's an active tunnel - if not, this is a hard disconnect
                        if (!activeTunnels.has(tunnelName)) {
                            // Machine was likely turned off, jump straight to failed
                            logger.error(`Tunnel '${tunnelName}' connection is not active - marking as failed`);
                            broadcastTunnelStatus(tunnelName, { 
                                connected: false, 
                                status: CONNECTION_STATES.FAILED,
                                reason: "Connection lost"
                            });
                            
                            // Don't need to call handleDisconnect as the connection is already gone
                            return;
                        }
                        
                        // Mark as unstable and try one more verification
                        broadcastTunnelStatus(tunnelName, { 
                            connected: true,  // Still technically connected
                            status: CONNECTION_STATES.UNSTABLE
                        });
                        
                        // Schedule one more check quickly after to confirm failure
                        const confirmationTimer = setTimeout(() => {
                            // Check again if tunnel still exists
                            if (!activeTunnels.has(tunnelName)) {
                                // Connection is gone, mark as failed directly
                                broadcastTunnelStatus(tunnelName, { 
                                    connected: false, 
                                    status: CONNECTION_STATES.FAILED,
                                    reason: "Connection lost during confirmation"
                                });
                                return;
                            }
                            
                            // Try one more verification
                            verifyTunnelConnection(tunnelName, hostConfig, false, socket);
                        }, 3000); // Faster check to minimize "stuck" state time
                        
                        // Store the confirmation timer to clean it up if needed
                        verificationTimers.set(`${tunnelName}_confirm`, confirmationTimer);
                    } else {
                        // We still have more attempts - try again after a short delay
                        const retryTimer = setTimeout(() => {
                            attemptVerification();
                        }, 5000);
                        
                        // Store the retry timer
                        verificationTimers.set(`${tunnelName}_verify_retry`, retryTimer);
                    }
                } else {
                    // If it's a regular verification that failed, or a second attempt after unstable
                    // First check if retries have been exhausted
                    if (retryExhaustedTunnels.has(tunnelName)) {
                        // Exception for remote host closures - reset and retry
                        const isRemoteHostClosure = failureReason.toLowerCase().includes("remote host closed") ||
                                                   failureReason.toLowerCase().includes("closed by remote host") ||
                                                   failureReason.includes("connection reset");
                        if (isRemoteHostClosure) {
                            retryExhaustedTunnels.delete(tunnelName);
                            retryCounters.delete(tunnelName);
                        } else {
                            broadcastTunnelStatus(tunnelName, { 
                                connected: false, 
                                status: CONNECTION_STATES.FAILED,
                                reason: "Max retries already exhausted"
                            });
                            return;
                        }
                    }
                    
                    // Check for remote host closures, which should always retry
                    const isRemoteHostClosure = failureReason.toLowerCase().includes("remote host closed") ||
                                               failureReason.toLowerCase().includes("closed by remote host") ||
                                               failureReason.includes("connection reset");
                    if (isRemoteHostClosure) {
                        logger.error(`Remote host closed connection during verification for ${tunnelName} - marking as failed`);
                        broadcastTunnelStatus(tunnelName, { 
                            connected: false, 
                            status: CONNECTION_STATES.FAILED,
                            reason: "Remote host disconnected"
                        });
                        
                        // Immediately try to retry
                        handleDisconnect(tunnelName, hostConfig, true, socket, true);
                        return;
                    }
                    
                    // Only set as failed if not a manual disconnect
                    if (!manualDisconnects.has(tunnelName)) {
                        // Check if a retry is already in progress
                        if (activeRetryTimers.has(tunnelName)) {
                            return; // Don't update status if a retry is already pending
                        }
                        
                        // Make sure we don't have a stale connection
                        activeTunnels.delete(tunnelName);
                        
                        // For clean UI transitions always set status to FAILED
                        broadcastTunnelStatus(tunnelName, { 
                            connected: false, 
                            status: CONNECTION_STATES.FAILED,
                            reason: failureReason || "Verification failed"
                        });
                        
                        // Only handle disconnect if not already retrying and retries not already exhausted
                        if (!activeRetryTimers.has(tunnelName) && !retryExhaustedTunnels.has(tunnelName)) {
                            // Then handle the disconnect process
                            handleDisconnect(tunnelName, hostConfig, true, socket);
                        }
                    }
                }
            }
        }
    }
    
    // Start the verification process
    attemptVerification();
}

// Setup Socket.io event handlers
io.on("connection", (socket) => {
    let pingTimer = null;

    function setupPingInterval() {
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => {
            if (socket && socket.connected) {
                socket.emit("ping");
            } else {
                clearInterval(pingTimer);
            }
        }, 3000);
    }

    setupPingInterval();

    // Send initial tunnel status
    broadcastAllTunnelStatus(socket);

    socket.on("getTunnelStatus", () => {
        broadcastAllTunnelStatus(socket);
    });

    // Listen for both event names to support different client versions
    socket.on("connect-tunnel", (hostData) => {
        // Parse the host config if received as a string
        const hostConfig = typeof hostData === 'string' ? JSON.parse(hostData) : hostData;
        const tunnelName = hostConfig.name;
        
        logger.info(`New connection request for ${tunnelName}`);
        
        // Clear manual disconnect flag
        manualDisconnects.delete(tunnelName);
        
        // Reset retry counter and clear exhausted flag
        retryCounters.delete(tunnelName);
        retryExhaustedTunnels.delete(tunnelName);
        
        // Connect with fresh state
        connectSSHTunnel(hostConfig, 0, socket);
    });
    
    // For compatibility with new client code
    socket.on("connectToHost", (hostConfig) => {
        const tunnelName = hostConfig.name;
        
        logger.info(`New connection request for ${tunnelName}`);
        
        // Clear manual disconnect flag
        manualDisconnects.delete(tunnelName);
        
        // Reset retry counter and clear exhausted flag
        retryCounters.delete(tunnelName);
        retryExhaustedTunnels.delete(tunnelName);
        
        // Connect with fresh state
        connectSSHTunnel(hostConfig, 0, socket);
    });

    // Listen for both event names to support different client versions
    socket.on("disconnect-tunnel", (tunnelName) => {
        logger.info(`Disconnecting '${tunnelName}'`);
        
        // Mark as manually disconnected FIRST - this flag controls retry behavior
        manualDisconnects.add(tunnelName);
        
        // Clear retry counter and exhausted flag
        retryCounters.delete(tunnelName);
        retryExhaustedTunnels.delete(tunnelName);
        
        // Clean up any retry timers
        if (activeRetryTimers.has(tunnelName)) {
            clearTimeout(activeRetryTimers.get(tunnelName));
            activeRetryTimers.delete(tunnelName);
        }
        
        if (verificationTimers.has(`${tunnelName}_retry`)) {
            clearTimeout(verificationTimers.get(`${tunnelName}_retry`));
            verificationTimers.delete(`${tunnelName}_retry`);
        }
        
        // Update status immediately to show disconnecting
        broadcastTunnelStatus(tunnelName, { 
            connected: false, 
            status: CONNECTION_STATES.DISCONNECTED,
            manualDisconnect: true
        });
        
        // Get host config for reference
        let hostConfig = null;
        if (activeTunnels.has(tunnelName)) {
            hostConfig = global.hostConfigs.get(tunnelName);
        }
        
        // Now handle the actual disconnection with our global function
        handleDisconnect(tunnelName, hostConfig, false, socket);
        
        // Remove from manual disconnects after a delay
        // This ensures any straggling events don't trigger reconnections
        setTimeout(() => {
            manualDisconnects.delete(tunnelName);
        }, 5000);
    });
    
    // Update socket.on("closeTunnel") to be simpler and more reliable
    socket.on("closeTunnel", (tunnelName) => {
        // Log only once
        logger.info(`Disconnecting '${tunnelName}'`);
        
        // Mark as manually disconnected
        manualDisconnects.add(tunnelName);
        
        // Clear retry counter and exhausted flag
        retryCounters.delete(tunnelName);
        retryExhaustedTunnels.delete(tunnelName);
        
        // Clean up any active retry timer
        if (activeRetryTimers.has(tunnelName)) {
            clearTimeout(activeRetryTimers.get(tunnelName));
            activeRetryTimers.delete(tunnelName);
        }
        
        // Update status
        broadcastTunnelStatus(tunnelName, { 
            connected: false, 
            status: CONNECTION_STATES.DISCONNECTED,
            manualDisconnect: true
        });
        
        // Get host config
        let hostConfig = null;
        if (activeTunnels.has(tunnelName)) {
            hostConfig = global.hostConfigs.get(tunnelName);
        }
        
        // Handle disconnect
        handleDisconnect(tunnelName, hostConfig, false, socket);
        
        // Remove from manual disconnects after a delay
        setTimeout(() => {
            manualDisconnects.delete(tunnelName);
        }, 5000);
    });
    
    // Get detailed connection info
    socket.on("diagnose", (tunnelName) => {
        if (!activeTunnels.has(tunnelName)) {
            socket.emit("diagnosticResult", {
                name: tunnelName,
                status: "Not connected",
                details: "No active connection"
            });
            return;
        }

        const statusData = connectionStatus.get(tunnelName) || { status: "unknown" };
        const diagnosticData = {
            name: tunnelName,
            status: statusData.status,
            retryCount: retryCounters.get(tunnelName) || 0,
            hasVerification: tunnelVerifications.has(tunnelName),
            isManuallyDisconnected: manualDisconnects.has(tunnelName)
        };
        
        socket.emit("diagnosticResult", diagnosticData);
    });

    socket.on("disconnect", () => {
        if (pingTimer) {
            clearInterval(pingTimer);
            pingTimer = null;
        }
    });
});

// Simplified and more reliable connectSSHTunnel
function connectSSHTunnel(hostConfig, retryAttempt = 0, socket = null) {
    const tunnelName = hostConfig.name;
    
    // Don't connect if manually disconnected
    if (manualDisconnects.has(tunnelName)) {
        return;
    }
    
    // Store host config for later use
    if (!global.hostConfigs) {
        global.hostConfigs = new Map();
    }
    global.hostConfigs.set(tunnelName, hostConfig);
    
    // Clean up any existing resources before starting
    cleanupTunnelResources(tunnelName);
    
    // Clear any retry-exhausted status if we're starting a fresh connection
    if (retryAttempt === 0) {
        retryExhaustedTunnels.delete(tunnelName);
        retryCounters.delete(tunnelName);
        remoteClosureEvents.delete(tunnelName);
    }
    
    // Check if we're in a retry following a remote closure
    const isRetryAfterRemoteClosure = remoteClosureEvents.get(tunnelName) && retryAttempt > 0;
    
    // Log connection attempt - KEEP THIS LOG
    logger.info(`Connecting to ${tunnelName}`);
    
    // Update status to connecting
    broadcastTunnelStatus(tunnelName, { 
        connected: false, 
        status: CONNECTION_STATES.CONNECTING, 
        retryCount: retryAttempt > 0 ? retryAttempt : null,
        isRemoteRetry: isRetryAfterRemoteClosure
    });
    
    // Basic parameter validation
    if (!hostConfig || !hostConfig.sourceIp || !hostConfig.sourceUser || !hostConfig.sourceSSHPort) {
        logger.error(`Invalid connection details for '${tunnelName}'`);
        broadcastTunnelStatus(tunnelName, { connected: false, status: CONNECTION_STATES.FAILED });
        if (socket && socket.connected) {
            socket.emit("error", { 
                name: tunnelName, 
                error: "Missing required connection details",
                errorType: ERROR_TYPES.UNKNOWN
            });
        }
        return;
    }
    
    // Create SSH connection
    const conn = new SSHClient();
    
    // Set connection timeout
    const connectionTimeout = setTimeout(() => {
        if (conn) {
            logger.error(`Connection timeout for '${tunnelName}'`); // KEEP THIS ERROR LOG
            
            // If we're already handling a disconnect/retry, don't do it again
            if (activeRetryTimers.has(tunnelName)) {
                return;
            }
            
            // Notify socket if available
            if (socket && socket.connected) {
                socket.emit("error", { 
                    name: tunnelName,
                    error: "Connection timeout",
                    errorType: ERROR_TYPES.TIMEOUT
                });
            }
            
            try {
                conn.end();
            } catch (e) {}
            
            // Clean up and trigger retry
            activeTunnels.delete(tunnelName);
            
            // Only retry if not a manual disconnect
            if (!activeRetryTimers.has(tunnelName)) {
                handleDisconnect(tunnelName, hostConfig, !manualDisconnects.has(tunnelName), socket);
            }
        }
    }, 15000);

    // Handle connection errors
    conn.on("error", (err) => {
        clearTimeout(connectionTimeout);
        logger.error(`SSH error for '${tunnelName}': ${err.message}`); // KEEP THIS ERROR LOG
        
        // If we're already handling a disconnect/retry, don't do it again
        if (activeRetryTimers.has(tunnelName)) {
            return;
        }
        
        // Classify error
        const errorType = classifyError(err.message);
        const isRemoteHostClosure = err.message.toLowerCase().includes("closed by remote host") || 
                                   err.message.toLowerCase().includes("connection reset by peer") ||
                                   err.message.toLowerCase().includes("broken pipe");
        
        // Update status
        if (!manualDisconnects.has(tunnelName)) {
            broadcastTunnelStatus(tunnelName, { 
                connected: false, 
                status: CONNECTION_STATES.FAILED,
                errorType: errorType,
                reason: err.message
            });
        }
        
        // Notify client
        if (socket && socket.connected) {
            socket.emit("error", { 
                name: tunnelName,
                error: err.message,
                errorType: errorType
            });
        }
        
        // Clean up tunnel
        activeTunnels.delete(tunnelName);
        
        // For remote host closures, make sure we reset retry state if needed
        if (isRemoteHostClosure && retryExhaustedTunnels.has(tunnelName)) {
            // Allow at least one retry for remote closures even if exhausted
            retryExhaustedTunnels.delete(tunnelName);
        }
        
        // Determine if we should retry - always retry for remote host closures
        const shouldNotRetry = !isRemoteHostClosure && (
            errorType === ERROR_TYPES.AUTH || 
            errorType === ERROR_TYPES.PORT || 
            errorType === ERROR_TYPES.PERMISSION ||
            manualDisconnects.has(tunnelName)
        );
        
        // Handle disconnect with the remote closure flag
        handleDisconnect(tunnelName, hostConfig, !shouldNotRetry, socket, isRemoteHostClosure);
    });

    // Handle connection closing
    conn.on("close", () => {
        clearTimeout(connectionTimeout);
        
        // If we're already handling a disconnect/retry, don't do it again
        if (activeRetryTimers.has(tunnelName)) {
            return;
        }
        
        // Only update status if not already handled
        if (!manualDisconnects.has(tunnelName)) {
            const currentStatus = connectionStatus.get(tunnelName);
            if (!currentStatus || currentStatus.status !== CONNECTION_STATES.FAILED) {
                broadcastTunnelStatus(tunnelName, { 
                    connected: false, 
                    status: CONNECTION_STATES.DISCONNECTED
                });
            }
            
            // Handle disconnect - only if not already retrying
            if (!activeRetryTimers.has(tunnelName)) {
                handleDisconnect(tunnelName, hostConfig, !manualDisconnects.has(tunnelName), socket);
            }
        }
    });

    // Connection ready handler
    conn.on("ready", () => {
        clearTimeout(connectionTimeout);
        
        // Prevent double-verification race condition
        const isAlreadyVerifying = tunnelVerifications.has(tunnelName);
        if (isAlreadyVerifying) {
            return;
        }
        
        // Create the SSH tunnel
        const tunnelCmd = `sshpass -p '${hostConfig.endPointPassword}' ssh -T -o StrictHostKeyChecking=no -o ExitOnForwardFailure=yes -R ${hostConfig.endPointPort}:localhost:${hostConfig.sourcePort} ${hostConfig.endPointUser}@${hostConfig.endPointIp}`;

        conn.exec(tunnelCmd, (err, stream) => {
            if (err) {
                logger.error(`Connection error for '${tunnelName}': ${err.message}`); // KEEP THIS ERROR LOG
                
                // Clean up connection
                try { conn.end(); } catch(e) {}
                
                // Notify client
                if (socket && socket.connected) {
                    socket.emit("error", { 
                        name: tunnelName,
                        error: err.message,
                        errorType: classifyError(err.message)
                    });
                }
                
                // Remove from active tunnels
                activeTunnels.delete(tunnelName);
                
                // Determine if we should retry
                const errorType = classifyError(err.message);
                const shouldNotRetry = errorType === ERROR_TYPES.AUTH || 
                                      errorType === ERROR_TYPES.PORT ||
                                      errorType === ERROR_TYPES.PERMISSION;
                
                // Handle disconnect with appropriate retry flag
                handleDisconnect(tunnelName, hostConfig, !shouldNotRetry, socket);
                return;
            }

            // Store connection - must happen before verification
            activeTunnels.set(tunnelName, conn);
                
            // Start verification after a short delay
            setTimeout(() => {
                if (!manualDisconnects.has(tunnelName) && activeTunnels.has(tunnelName)) {
                    verifyTunnelConnection(tunnelName, hostConfig, false, socket);
                }
            }, 2000);

            // Handle stream closing
            stream.on("close", (code) => {
                // If we're already handling a disconnect/retry, don't do it again
                if (activeRetryTimers.has(tunnelName)) {
                    return;
                }
                
                // Only log non-zero exit codes
                if (code !== 0) {
                    // Do nothing - removed logger call
                }
                
                // Remove from active tunnels immediately upon stream close
                activeTunnels.delete(tunnelName);
                
                // Immediately abort any pending verification that might mark as connected later
                if (tunnelVerifications.has(tunnelName)) {
                    try {
                        const verification = tunnelVerifications.get(tunnelName);
                        if (verification.timeout) clearTimeout(verification.timeout);
                        verification.conn.end();
                    } catch (e) {}
                    tunnelVerifications.delete(tunnelName);
                }
                
                // Check if this is likely a remote closure 
                const isLikelyRemoteClosure = code === 255; // SSH typically returns 255 for remote closures
                
                // For remote closures, reset retry state if needed
                if (isLikelyRemoteClosure && retryExhaustedTunnels.has(tunnelName)) {
                    retryExhaustedTunnels.delete(tunnelName);
                }
                
                // Update status if not manually disconnected
                if (!manualDisconnects.has(tunnelName) && code !== 0) {
                    // If retries are exhausted, show that specific message
                    if (retryExhaustedTunnels.has(tunnelName)) {
                        broadcastTunnelStatus(tunnelName, { 
                            connected: false, 
                            status: CONNECTION_STATES.FAILED,
                            reason: "Max retries exhausted"
                        });
                    } else {
                        broadcastTunnelStatus(tunnelName, { 
                            connected: false, 
                            status: CONNECTION_STATES.FAILED,
                            code: code,
                            reason: isLikelyRemoteClosure ? "Connection closed by remote host" : "Connection closed unexpectedly"
                        });
                    }
                }
                
                // Handle disconnect if not already retrying or retries exhausted
                if (!activeRetryTimers.has(tunnelName) && !retryExhaustedTunnels.has(tunnelName)) {
                    handleDisconnect(tunnelName, hostConfig, !manualDisconnects.has(tunnelName), socket, isLikelyRemoteClosure);
                } else if (retryExhaustedTunnels.has(tunnelName) && isLikelyRemoteClosure) {
                    // For remote closures, always try at least one more time even if exhausted
                    retryExhaustedTunnels.delete(tunnelName);
                    retryCounters.delete(tunnelName);
                    handleDisconnect(tunnelName, hostConfig, true, socket, true);
                }
            });
            
            // Forward data to client
            stream.on("data", (data) => {
                if (socket && socket.connected) {
                    socket.emit("data", { name: tunnelName, data: data.toString() });
                }
            });

            // Handle errors in the stream
            stream.stderr.on("data", (data) => {
                const errorMsg = data.toString();
                
                // Skip logging for common non-critical messages
                if (!errorMsg.includes("Pseudo-terminal will not be allocated")) {
                    logger.error(`Error for '${tunnelName}': ${errorMsg.trim()}`); // KEEP THIS ERROR LOG
                    
                    // Notify client
                    if (socket && socket.connected) {
                        socket.emit("error", { 
                            name: tunnelName, 
                            error: errorMsg,
                            errorType: classifyError(errorMsg)
                        });
                    }
                }
                
                // Check for critical errors that should NOT be retried
                const isNonRetryableError = errorMsg.includes("Permission denied") || 
                                           errorMsg.includes("Authentication failed") ||
                                           errorMsg.includes("failed for listen port") ||
                                           errorMsg.includes("address already in use");
                
                // Check for remote host closures (should be retried)
                const isRemoteHostClosure = errorMsg.includes("closed by remote host") || 
                                            errorMsg.includes("connection reset by peer") ||
                                            errorMsg.includes("broken pipe");
                
                // Process error appropriately
                if (isNonRetryableError || isRemoteHostClosure) {
                    // If we're already handling a disconnect/retry, don't do it again
                    if (activeRetryTimers.has(tunnelName)) {
                        return;
                    }
                    
                    // Check if retries are already exhausted - but for remote closures, reset and retry anyway
                    if (retryExhaustedTunnels.has(tunnelName)) {
                        if (isRemoteHostClosure) {
                            retryExhaustedTunnels.delete(tunnelName);
                            retryCounters.delete(tunnelName);
                        } else {
                            return;
                        }
                    }
                    
                    // Remove from active tunnels on error
                    activeTunnels.delete(tunnelName);
                    
                    // Update status
                    if (!manualDisconnects.has(tunnelName)) {
                        broadcastTunnelStatus(tunnelName, { 
                            connected: false, 
                            status: CONNECTION_STATES.FAILED,
                            errorType: classifyError(errorMsg),
                            reason: errorMsg
                        });
                    }
                    
                    // For remote host closures, always retry
                    // For other errors, check error type
                    const errorType = classifyError(errorMsg);
                    const shouldNotRetry = !isRemoteHostClosure && (
                        errorType === ERROR_TYPES.AUTH || 
                        errorType === ERROR_TYPES.PORT ||
                        errorType === ERROR_TYPES.PERMISSION
                    );
                    
                    // Handle disconnect with appropriate retry flag
                    handleDisconnect(tunnelName, hostConfig, !shouldNotRetry, socket, isRemoteHostClosure);
                }
            });
        });
    });

    // Connect to SSH server
    conn.connect({
        host: hostConfig.sourceIp,
        port: hostConfig.sourceSSHPort,
        username: hostConfig.sourceUser,
        password: hostConfig.sourcePassword || undefined,
        keepaliveInterval: 5000,
        keepaliveCountMax: 10,
        readyTimeout: 10000,
        tcpKeepAlive: true,
    });
    
    return conn;
}

// Classify error type for better handling
function classifyError(errorMessage) {
    if (!errorMessage) return ERROR_TYPES.UNKNOWN;
    
    errorMessage = errorMessage.toLowerCase();
    
    // Remote closures should ALWAYS be network errors (retryable)
    if (errorMessage.includes("closed by remote host") ||
        errorMessage.includes("connection reset by peer") ||
        errorMessage.includes("connection refused") ||
        errorMessage.includes("broken pipe")) {
        return ERROR_TYPES.NETWORK;
    }
    
    if (errorMessage.includes("authentication failed") || 
        errorMessage.includes("permission denied") ||
        errorMessage.includes("incorrect password")) {
        return ERROR_TYPES.AUTH;
    }
    
    if (errorMessage.includes("connect etimedout") ||
        errorMessage.includes("timeout") ||
        errorMessage.includes("timed out")) {
        return ERROR_TYPES.TIMEOUT;
    }
    
    if (errorMessage.includes("bind: address already in use") ||
        errorMessage.includes("failed for listen port") ||
        errorMessage.includes("port forwarding failed")) {
        return ERROR_TYPES.PORT;
    }
    
    if (errorMessage.includes("permission") ||
        errorMessage.includes("access denied")) {
        return ERROR_TYPES.PERMISSION;
    }
    
    if (errorMessage.includes("network") ||
        errorMessage.includes("no route to host")) {
        return ERROR_TYPES.NETWORK;
    }
    
    return ERROR_TYPES.UNKNOWN;
}

// Add a periodic check for all connections' liveness
function startLivenessChecks() {
    setInterval(() => {
        // Check all active tunnels to ensure they're actually still alive
        activeTunnels.forEach((conn, tunnelName) => {
            // Only check if not already in a failed or disconnected state
            const status = connectionStatus.get(tunnelName);
            if (status && 
                (status.status === CONNECTION_STATES.CONNECTED || 
                 status.status === CONNECTION_STATES.UNSTABLE)) {
                
                // Instead of using ping which can be unreliable, send a harmless command
                // to verify the connection is truly alive
                try {
                    // Skip if connection doesn't have an exec method (already closed)
                    if (!conn || !conn.exec) {
                        // Don't immediately mark as failed - trigger a verification instead
                        const hostConfig = findHostConfigByName(tunnelName);
                        if (hostConfig) {
                            verifyTunnelConnection(tunnelName, hostConfig, true, null);
                        }
                        return;
                    }
                    
                    // Send a simple echo command to check if the connection is responsive
                    conn.exec('echo keepalive', (err, stream) => {
                        if (err) {
                            // Don't immediately mark as failed - trigger a verification to be sure
                            const hostConfig = findHostConfigByName(tunnelName);
                            if (hostConfig) {
                                verifyTunnelConnection(tunnelName, hostConfig, true, null);
                            }
                        } else {
                            // Command executed successfully, connection is good
                            stream.on('close', (code) => {
                                if (code !== 0) {
                                    // Trigger verification if echo command failed
                                    const hostConfig = findHostConfigByName(tunnelName);
                                    if (hostConfig) {
                                        verifyTunnelConnection(tunnelName, hostConfig, true, null);
                                    }
                                }
                                // Otherwise all is well - connection is alive
                            });
                        }
                    });
                } catch (err) {
                    // Don't immediately fail - schedule a verification
                    const hostConfig = findHostConfigByName(tunnelName);
                    if (hostConfig) {
                        verifyTunnelConnection(tunnelName, hostConfig, true, null);
                    }
                }
            }
        });
    }, 30000); // Check every 30 seconds (reduced frequency)
}

// Helper function to find host config by tunnel name
// We need this to perform verification when a keepalive check fails
function findHostConfigByName(tunnelName) {
    // Store active host configs in memory
    if (!global.hostConfigs) {
        global.hostConfigs = new Map();
        }
        
    return global.hostConfigs.get(tunnelName);
}

// Start liveness checks when the server starts
startLivenessChecks();

// Add a reset method to ensure retries work properly for remote closures
function resetRetryState(tunnelName) {
    // Clear retry state
    retryCounters.delete(tunnelName);
    retryExhaustedTunnels.delete(tunnelName);
    remoteClosureEvents.delete(tunnelName);
    
    // Clear any active retry timers
    if (activeRetryTimers.has(tunnelName)) {
        clearTimeout(activeRetryTimers.get(tunnelName));
        activeRetryTimers.delete(tunnelName);
    }
    
    // Also clear any verification timers
    ['', '_confirm', '_retry', '_verify_retry'].forEach(suffix => {
        const timerKey = `${tunnelName}${suffix}`;
        if (verificationTimers.has(timerKey)) {
            clearTimeout(verificationTimers.get(timerKey));
            verificationTimers.delete(timerKey);
        }
    });
    
    logger.info(`Retry state fully reset for ${tunnelName}`);
}

server.listen(8082, '0.0.0.0', () => {
    logger.info("SSH Tunnel Server running on port 8082"); // KEEP THIS SERVER START LOG
});