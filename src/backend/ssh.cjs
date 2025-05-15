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

const logger = {
    info: (...args) => console.log(`🖥️ | 🔧 [${new Date().toISOString()}] INFO:`, ...args),
    error: (...args) => console.error(`🖥️ | ❌  [${new Date().toISOString()}] ERROR:`, ...args),
    warn: (...args) => console.warn(`🖥️ | ⚠️ [${new Date().toISOString()}] WARN:`, ...args),
    debug: (...args) => console.debug(`🖥️ | 🔍 [${new Date().toISOString()}] DEBUG:`, ...args)
};

const activeTunnels = new Map();
const retryCounters = new Map(); // Maps tunnel name to current retry count
const connectionStatus = new Map();
const tunnelVerifications = new Map();
const manualDisconnects = new Set();
const verificationTimers = new Map();
const activeRetryTimers = new Map(); // Track active retry timers by tunnel name
const retryExhaustedTunnels = new Set();
const remoteClosureEvents = new Map(); // Maps tunnel name to count of remote closure events

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
    if (status.status === CONNECTION_STATES.CONNECTED && activeRetryTimers.has(tunnelName)) {
        return; // Don't broadcast 'connected' while a retry is scheduled
    }
    
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

function handleDisconnect(tunnelName, hostConfig, shouldRetry = true, socket = null, isRemoteClosure = false) {
    logger.info(`Disconnecting tunnel: ${tunnelName}`);
    
    if (tunnelVerifications.has(tunnelName)) {
        try {
            const verification = tunnelVerifications.get(tunnelName);
            if (verification.timeout) clearTimeout(verification.timeout);
            verification.conn.end();
        } catch (e) {}
        tunnelVerifications.delete(tunnelName);
    }
    
    cleanupTunnelResources(tunnelName);
    
    if (manualDisconnects.has(tunnelName)) {
        resetRetryState(tunnelName);
        
        broadcastTunnelStatus(tunnelName, { 
            connected: false, 
            status: CONNECTION_STATES.DISCONNECTED,
            manualDisconnect: true
        });
        return;
    }
    
    if (isRemoteClosure) {
        const currentCount = remoteClosureEvents.get(tunnelName) || 0;
        remoteClosureEvents.set(tunnelName, currentCount + 1);
        
        broadcastTunnelStatus(tunnelName, {
            connected: false,
            status: CONNECTION_STATES.FAILED,
            reason: "Remote host disconnected"
        });
        
        if (currentCount === 0) {
            retryCounters.delete(tunnelName);
        }
    }
    
    if (isRemoteClosure && retryExhaustedTunnels.has(tunnelName)) {
        retryExhaustedTunnels.delete(tunnelName);
    }
    
    if (retryExhaustedTunnels.has(tunnelName)) {
        broadcastTunnelStatus(tunnelName, { 
            connected: false, 
            status: CONNECTION_STATES.FAILED,
            reason: "Max retries already exhausted"
        });
        return;
    }
    
    if (activeRetryTimers.has(tunnelName)) {
        return;
    }
    
    if (shouldRetry && hostConfig && hostConfig.retryConfig) {
        const maxRetries = hostConfig.retryConfig.maxRetries || 3;
        const retryInterval = hostConfig.retryConfig.retryInterval || 5000;
        
        if (isRemoteClosure) {
            const currentCount = remoteClosureEvents.get(tunnelName) || 0;
            remoteClosureEvents.set(tunnelName, currentCount + 1);
            
            if (currentCount === 0) {
                retryCounters.delete(tunnelName);
            }
        }
        
        let retryCount = (retryCounters.get(tunnelName) || 0) + 1;
        
        if (retryCount > maxRetries) {
            logger.error(`All ${maxRetries} retries failed for ${tunnelName}`);
            
            retryExhaustedTunnels.add(tunnelName);
            
            activeTunnels.delete(tunnelName);
            
            retryCounters.delete(tunnelName);
            
            broadcastTunnelStatus(tunnelName, { 
                connected: false, 
                status: CONNECTION_STATES.FAILED,
                retryExhausted: true,
                reason: `Max retries exhausted`
            });
            return;
        }
        
        retryCounters.set(tunnelName, retryCount);
        
        if (retryCount <= maxRetries) {
            broadcastTunnelStatus(tunnelName, { 
                connected: false, 
                status: CONNECTION_STATES.RETRYING, 
                retryCount: retryCount,
                maxRetries: maxRetries,
                nextRetryIn: retryInterval/1000
            });
            
            if (activeRetryTimers.has(tunnelName)) {
                clearTimeout(activeRetryTimers.get(tunnelName));
                activeRetryTimers.delete(tunnelName);
            }
            
            const timer = setTimeout(() => {
                activeRetryTimers.delete(tunnelName);
                
                if (!manualDisconnects.has(tunnelName)) {
                    activeTunnels.delete(tunnelName);
                    
                    connectSSHTunnel(hostConfig, retryCount, socket);
                }
            }, retryInterval);
            
            activeRetryTimers.set(tunnelName, timer);
        }
    } else {
        broadcastTunnelStatus(tunnelName, { 
            connected: false, 
            status: CONNECTION_STATES.FAILED
        });
        
        activeTunnels.delete(tunnelName);
    }
}

function cleanupTunnelResources(tunnelName) {
    if (activeTunnels.has(tunnelName)) {
        try {
            const conn = activeTunnels.get(tunnelName);
            if (conn) conn.end();
        } catch (e) {}
        activeTunnels.delete(tunnelName);
    }
    
    if (tunnelVerifications.has(tunnelName)) {
        const verification = tunnelVerifications.get(tunnelName);
        if (verification.timeout) clearTimeout(verification.timeout);
        try {
            verification.conn.end();
        } catch (e) {}
        tunnelVerifications.delete(tunnelName);
    }
    
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
    
    if (activeRetryTimers.has(tunnelName)) {
        clearTimeout(activeRetryTimers.get(tunnelName));
        activeRetryTimers.delete(tunnelName);
    }
}

function verifyTunnelConnection(tunnelName, hostConfig, isPeriodic = false, socket = null) {
    const endpointPort = hostConfig.endPointPort;
    
    if (!activeTunnels.has(tunnelName)) {
        if (!isPeriodic) {
            broadcastTunnelStatus(tunnelName, { connected: false, status: CONNECTION_STATES.FAILED });
        }
        return;
    }
    
    if (retryExhaustedTunnels.has(tunnelName)) {
        broadcastTunnelStatus(tunnelName, { 
            connected: false, 
            status: CONNECTION_STATES.FAILED,
            reason: "Max retries already exhausted"
        });
        return;
    }
    
    if (activeRetryTimers.has(tunnelName)) {
        return;
    }
    
    const isInRemoteRetryProcess = remoteClosureEvents.get(tunnelName) && retryCounters.get(tunnelName) > 0;
    if (isInRemoteRetryProcess && !isPeriodic) {
        return;
    }
    
    if (!isPeriodic) {
        broadcastTunnelStatus(tunnelName, { connected: false, status: CONNECTION_STATES.VERIFYING });
    }
    
    let verificationAttempts = isPeriodic ? 0 : null;
    const maxVerificationAttempts = 3;
    
    function attemptVerification() {
        if (isPeriodic) {
            verificationAttempts++;
        }
        
        if (!activeTunnels.has(tunnelName)) {
            logger.error(`Tunnel '${tunnelName}' disappeared before verification could start`);
            cleanupVerification(false, "Connection lost before verification could start");
            return;
        }
        
        const verificationConn = new SSHClient();
        let verificationTimeout;
        
        let initialConnectTimeout = setTimeout(() => {
            cleanupVerification(false, "Connection timeout during verification");
        }, 8000);
        
        verificationConn.on("ready", () => {
            clearTimeout(initialConnectTimeout);
            
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
                    if (data.toString().includes('ERROR') || data.toString().includes('FAILURE')) {
                    }
                });
                
                stream.on("close", (code) => {
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
            
            const isRemoteHostClosure = err.message.toLowerCase().includes("closed by remote host") ||
                                       err.message.toLowerCase().includes("connection reset by peer") ||
                                       err.message.toLowerCase().includes("broken pipe");
            if (isRemoteHostClosure) {
                logger.error(`Remote host closed connection during verification for '${tunnelName}'`);
                
                if (retryExhaustedTunnels.has(tunnelName)) {
                    retryExhaustedTunnels.delete(tunnelName);
                    retryCounters.delete(tunnelName);
                }
                
                cleanupVerification(false, "Remote host closed connection");
                return;
            }
            
            cleanupVerification(false, err.message);
        });
        
        verificationTimeout = setTimeout(() => {
            cleanupVerification(false, "Verification timeout");
        }, 15000);
        
        tunnelVerifications.set(tunnelName, {
            conn: verificationConn,
            timeout: verificationTimeout
        });
        
        verificationConn.connect({
            host: hostConfig.sourceIp,
            port: hostConfig.sourceSSHPort,
            username: hostConfig.sourceUser,
            password: hostConfig.sourcePassword || undefined,
            readyTimeout: 10000
        });
        
        function cleanupVerification(isSuccessful, failureReason = "Unknown verification failure") {
            if (verificationTimeout) {
                clearTimeout(verificationTimeout);
            }
            
            if (initialConnectTimeout) {
                clearTimeout(initialConnectTimeout);
            }
            
            try {
                verificationConn.end();
            } catch (err) {}
            
            tunnelVerifications.delete(tunnelName);
            
            const hadRemoteClosure = remoteClosureEvents.get(tunnelName) && retryCounters.get(tunnelName) > 0;
            
            if ((isSuccessful && activeRetryTimers.has(tunnelName)) || (isSuccessful && hadRemoteClosure)) {
                isSuccessful = false;
                failureReason = activeRetryTimers.has(tunnelName) ? 
                    "Retry in progress - ignoring successful verification" : 
                    "Previous remote closure - verification likely incorrect";
            }
            
            if (isSuccessful) {
                if (!activeTunnels.has(tunnelName)) {
                    logger.error(`Tunnel '${tunnelName}' disappeared during verification - marking as failed`);
                    broadcastTunnelStatus(tunnelName, { 
                        connected: false, 
                        status: CONNECTION_STATES.FAILED,
                        reason: "Connection lost during verification"
                    });
                    return;
                }
                
                if (activeRetryTimers.has(tunnelName)) {
                    return;
                }
                
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
                
                const currentStatus = connectionStatus.get(tunnelName);
                const isCurrentlyConnected = currentStatus && 
                                            currentStatus.connected && 
                                            currentStatus.status === CONNECTION_STATES.CONNECTED;
                                            
                if ((!isPeriodic || !isCurrentlyConnected) && !hadRemoteClosure) {
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
                        
                        broadcastTunnelStatus(tunnelName, { connected: true, status: CONNECTION_STATES.CONNECTED });
                    });
                }
                
                if (hostConfig.refreshInterval) {
                    if (verificationTimers.has(tunnelName)) {
                        clearTimeout(verificationTimers.get(tunnelName));
                    }
                    
                    const timer = setTimeout(() => {
                        const latestStatus = connectionStatus.get(tunnelName);
                        if (latestStatus && latestStatus.status === CONNECTION_STATES.CONNECTED) {
                            verifyTunnelConnection(tunnelName, hostConfig, true, socket); // Note the true for isPeriodic
                        }
                    }, hostConfig.refreshInterval);
                    
                    verificationTimers.set(tunnelName, timer);
                }
            } else {
                if (isPeriodic) {
                    if (verificationAttempts >= maxVerificationAttempts) {
                        if (!activeTunnels.has(tunnelName)) {
                            logger.error(`Tunnel '${tunnelName}' connection is not active - marking as failed`);
                            broadcastTunnelStatus(tunnelName, { 
                                connected: false, 
                                status: CONNECTION_STATES.FAILED,
                                reason: "Connection lost"
                            });
                            
                            return;
                        }
                        
                        broadcastTunnelStatus(tunnelName, { 
                            connected: true,  // Still technically connected
                            status: CONNECTION_STATES.UNSTABLE
                        });
                        
                        const confirmationTimer = setTimeout(() => {
                            if (!activeTunnels.has(tunnelName)) {
                                broadcastTunnelStatus(tunnelName, { 
                                    connected: false, 
                                    status: CONNECTION_STATES.FAILED,
                                    reason: "Connection lost during confirmation"
                                });
                                return;
                            }
                            
                            verifyTunnelConnection(tunnelName, hostConfig, false, socket);
                        }, 3000); // Faster check to minimize "stuck" state time
                        
                        verificationTimers.set(`${tunnelName}_confirm`, confirmationTimer);
                    } else {
                        const retryTimer = setTimeout(() => {
                            attemptVerification();
                        }, 5000);
                        
                        verificationTimers.set(`${tunnelName}_verify_retry`, retryTimer);
                    }
                } else {
                    if (retryExhaustedTunnels.has(tunnelName)) {
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
                        
                        handleDisconnect(tunnelName, hostConfig, true, socket, true);
                        return;
                    }
                    
                    if (!manualDisconnects.has(tunnelName)) {
                        if (activeRetryTimers.has(tunnelName)) {
                            return; // Don't update status if a retry is already pending
                        }
                        
                        activeTunnels.delete(tunnelName);
                        
                        broadcastTunnelStatus(tunnelName, { 
                            connected: false, 
                            status: CONNECTION_STATES.FAILED,
                            reason: failureReason || "Verification failed"
                        });
                        
                        if (!activeRetryTimers.has(tunnelName) && !retryExhaustedTunnels.has(tunnelName)) {
                            handleDisconnect(tunnelName, hostConfig, true, socket);
                        }
                    }
                }
            }
        }
    }
    
    attemptVerification();
}

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

    broadcastAllTunnelStatus(socket);

    socket.on("getTunnelStatus", () => {
        broadcastAllTunnelStatus(socket);
    });

    socket.on("connect-tunnel", (hostData) => {
        const hostConfig = typeof hostData === 'string' ? JSON.parse(hostData) : hostData;
        const tunnelName = hostConfig.name;
        
        logger.info(`New connection request for ${tunnelName}`);
        
        manualDisconnects.delete(tunnelName);
        
        retryCounters.delete(tunnelName);
        retryExhaustedTunnels.delete(tunnelName);
        
        connectSSHTunnel(hostConfig, 0, socket);
    });
    
    socket.on("connectToHost", (hostConfig) => {
        const tunnelName = hostConfig.name;
        
        logger.info(`New connection request for ${tunnelName}`);
        
        manualDisconnects.delete(tunnelName);
        
        retryCounters.delete(tunnelName);
        retryExhaustedTunnels.delete(tunnelName);
        
        connectSSHTunnel(hostConfig, 0, socket);
    });

    socket.on("disconnect-tunnel", (tunnelName) => {
        logger.info(`Disconnecting '${tunnelName}'`);
        
        manualDisconnects.add(tunnelName);
        
        retryCounters.delete(tunnelName);
        retryExhaustedTunnels.delete(tunnelName);
        
        if (activeRetryTimers.has(tunnelName)) {
            clearTimeout(activeRetryTimers.get(tunnelName));
            activeRetryTimers.delete(tunnelName);
        }
        
        if (verificationTimers.has(`${tunnelName}_retry`)) {
            clearTimeout(verificationTimers.get(`${tunnelName}_retry`));
            verificationTimers.delete(`${tunnelName}_retry`);
        }
        
        broadcastTunnelStatus(tunnelName, { 
            connected: false, 
            status: CONNECTION_STATES.DISCONNECTED,
            manualDisconnect: true
        });
        
        let hostConfig = null;
        if (activeTunnels.has(tunnelName)) {
            hostConfig = global.hostConfigs.get(tunnelName);
        }
        
        handleDisconnect(tunnelName, hostConfig, false, socket);
        
        setTimeout(() => {
            manualDisconnects.delete(tunnelName);
        }, 5000);
    });
    
    socket.on("closeTunnel", (tunnelName) => {
        logger.info(`Disconnecting '${tunnelName}'`);
        
        manualDisconnects.add(tunnelName);
        
        retryCounters.delete(tunnelName);
        retryExhaustedTunnels.delete(tunnelName);
        
        if (activeRetryTimers.has(tunnelName)) {
            clearTimeout(activeRetryTimers.get(tunnelName));
            activeRetryTimers.delete(tunnelName);
        }
        
        broadcastTunnelStatus(tunnelName, { 
            connected: false, 
            status: CONNECTION_STATES.DISCONNECTED,
            manualDisconnect: true
        });
        
        let hostConfig = null;
        if (activeTunnels.has(tunnelName)) {
            hostConfig = global.hostConfigs.get(tunnelName);
        }
        
        handleDisconnect(tunnelName, hostConfig, false, socket);
        
        setTimeout(() => {
            manualDisconnects.delete(tunnelName);
        }, 5000);
    });
    
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

function connectSSHTunnel(hostConfig, retryAttempt = 0, socket = null) {
    const tunnelName = hostConfig.name;
    
    if (manualDisconnects.has(tunnelName)) {
        return;
    }
    
    if (!global.hostConfigs) {
        global.hostConfigs = new Map();
    }
    global.hostConfigs.set(tunnelName, hostConfig);
    
    cleanupTunnelResources(tunnelName);
    
    if (retryAttempt === 0) {
        retryExhaustedTunnels.delete(tunnelName);
        retryCounters.delete(tunnelName);
        remoteClosureEvents.delete(tunnelName);
    }
    
    const isRetryAfterRemoteClosure = remoteClosureEvents.get(tunnelName) && retryAttempt > 0;
    
    logger.info(`Connecting to ${tunnelName}`);
    
    broadcastTunnelStatus(tunnelName, { 
        connected: false, 
        status: CONNECTION_STATES.CONNECTING, 
        retryCount: retryAttempt > 0 ? retryAttempt : null,
        isRemoteRetry: isRetryAfterRemoteClosure
    });
    
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
    
    const conn = new SSHClient();
    
    const connectionTimeout = setTimeout(() => {
        if (conn) {
            logger.error(`Connection timeout for '${tunnelName}'`); // KEEP THIS ERROR LOG
            
            if (activeRetryTimers.has(tunnelName)) {
                return;
            }
            
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
            
            activeTunnels.delete(tunnelName);
            
            if (!activeRetryTimers.has(tunnelName)) {
                handleDisconnect(tunnelName, hostConfig, !manualDisconnects.has(tunnelName), socket);
            }
        }
    }, 15000);

    conn.on("error", (err) => {
        clearTimeout(connectionTimeout);
        logger.error(`SSH error for '${tunnelName}': ${err.message}`); // KEEP THIS ERROR LOG
        
        if (activeRetryTimers.has(tunnelName)) {
            return;
        }
        
        const errorType = classifyError(err.message);
        const isRemoteHostClosure = err.message.toLowerCase().includes("closed by remote host") || 
                                   err.message.toLowerCase().includes("connection reset by peer") ||
                                   err.message.toLowerCase().includes("broken pipe");
        
        if (!manualDisconnects.has(tunnelName)) {
            broadcastTunnelStatus(tunnelName, { 
                connected: false, 
                status: CONNECTION_STATES.FAILED,
                errorType: errorType,
                reason: err.message
            });
        }
        
        if (socket && socket.connected) {
            socket.emit("error", { 
                name: tunnelName,
                error: err.message,
                errorType: errorType
            });
        }
        
        activeTunnels.delete(tunnelName);
        
        if (isRemoteHostClosure && retryExhaustedTunnels.has(tunnelName)) {
            retryExhaustedTunnels.delete(tunnelName);
        }
        
        const shouldNotRetry = !isRemoteHostClosure && (
            errorType === ERROR_TYPES.AUTH || 
            errorType === ERROR_TYPES.PORT || 
            errorType === ERROR_TYPES.PERMISSION ||
            manualDisconnects.has(tunnelName)
        );
        
        handleDisconnect(tunnelName, hostConfig, !shouldNotRetry, socket, isRemoteHostClosure);
    });

    conn.on("close", () => {
        clearTimeout(connectionTimeout);
        
        if (activeRetryTimers.has(tunnelName)) {
            return;
        }
        
        if (!manualDisconnects.has(tunnelName)) {
            const currentStatus = connectionStatus.get(tunnelName);
            if (!currentStatus || currentStatus.status !== CONNECTION_STATES.FAILED) {
                broadcastTunnelStatus(tunnelName, { 
                    connected: false, 
                    status: CONNECTION_STATES.DISCONNECTED
                });
            }
            
            if (!activeRetryTimers.has(tunnelName)) {
                handleDisconnect(tunnelName, hostConfig, !manualDisconnects.has(tunnelName), socket);
            }
        }
    });

    conn.on("ready", () => {
        clearTimeout(connectionTimeout);
        
        const isAlreadyVerifying = tunnelVerifications.has(tunnelName);
        if (isAlreadyVerifying) {
            return;
        }
        
        const tunnelCmd = `sshpass -p '${hostConfig.endPointPassword}' ssh -T -o StrictHostKeyChecking=no -o ExitOnForwardFailure=yes -R ${hostConfig.endPointPort}:localhost:${hostConfig.sourcePort} ${hostConfig.endPointUser}@${hostConfig.endPointIp}`;

        conn.exec(tunnelCmd, (err, stream) => {
            if (err) {
                logger.error(`Connection error for '${tunnelName}': ${err.message}`); // KEEP THIS ERROR LOG
                
                try { conn.end(); } catch(e) {}
                
                if (socket && socket.connected) {
                    socket.emit("error", { 
                        name: tunnelName,
                        error: err.message,
                        errorType: classifyError(err.message)
                    });
                }
                
                activeTunnels.delete(tunnelName);
                
                const errorType = classifyError(err.message);
                const shouldNotRetry = errorType === ERROR_TYPES.AUTH || 
                                      errorType === ERROR_TYPES.PORT ||
                                      errorType === ERROR_TYPES.PERMISSION;
                
                handleDisconnect(tunnelName, hostConfig, !shouldNotRetry, socket);
                return;
            }

            activeTunnels.set(tunnelName, conn);
                
            setTimeout(() => {
                if (!manualDisconnects.has(tunnelName) && activeTunnels.has(tunnelName)) {
                    verifyTunnelConnection(tunnelName, hostConfig, false, socket);
                }
            }, 2000);

            stream.on("close", (code) => {
                if (activeRetryTimers.has(tunnelName)) {
                    return;
                }
                
                if (code !== 0) {
                }
                
                activeTunnels.delete(tunnelName);
                
                if (tunnelVerifications.has(tunnelName)) {
                    try {
                        const verification = tunnelVerifications.get(tunnelName);
                        if (verification.timeout) clearTimeout(verification.timeout);
                        verification.conn.end();
                    } catch (e) {}
                    tunnelVerifications.delete(tunnelName);
                }
                
                const isLikelyRemoteClosure = code === 255; // SSH typically returns 255 for remote closures
                
                if (isLikelyRemoteClosure && retryExhaustedTunnels.has(tunnelName)) {
                    retryExhaustedTunnels.delete(tunnelName);
                }
                
                if (!manualDisconnects.has(tunnelName) && code !== 0) {
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
                
                if (!activeRetryTimers.has(tunnelName) && !retryExhaustedTunnels.has(tunnelName)) {
                    handleDisconnect(tunnelName, hostConfig, !manualDisconnects.has(tunnelName), socket, isLikelyRemoteClosure);
                } else if (retryExhaustedTunnels.has(tunnelName) && isLikelyRemoteClosure) {
                    retryExhaustedTunnels.delete(tunnelName);
                    retryCounters.delete(tunnelName);
                    handleDisconnect(tunnelName, hostConfig, true, socket, true);
                }
            });
            
            stream.on("data", (data) => {
                if (socket && socket.connected) {
                    socket.emit("data", { name: tunnelName, data: data.toString() });
                }
            });

            stream.stderr.on("data", (data) => {
                const errorMsg = data.toString();
                
                if (!errorMsg.includes("Pseudo-terminal will not be allocated")) {
                    logger.error(`Error for '${tunnelName}': ${errorMsg.trim()}`); // KEEP THIS ERROR LOG
                    
                    if (socket && socket.connected) {
                        socket.emit("error", { 
                            name: tunnelName, 
                            error: errorMsg,
                            errorType: classifyError(errorMsg)
                        });
                    }
                }
                
                const isNonRetryableError = errorMsg.includes("Permission denied") || 
                                           errorMsg.includes("Authentication failed") ||
                                           errorMsg.includes("failed for listen port") ||
                                           errorMsg.includes("address already in use");
                
                const isRemoteHostClosure = errorMsg.includes("closed by remote host") || 
                                            errorMsg.includes("connection reset by peer") ||
                                            errorMsg.includes("broken pipe");
                
                if (isNonRetryableError || isRemoteHostClosure) {
                    if (activeRetryTimers.has(tunnelName)) {
                        return;
                    }
                    
                    if (retryExhaustedTunnels.has(tunnelName)) {
                        if (isRemoteHostClosure) {
                            retryExhaustedTunnels.delete(tunnelName);
                            retryCounters.delete(tunnelName);
                        } else {
                            return;
                        }
                    }
                    
                    activeTunnels.delete(tunnelName);
                    
                    if (!manualDisconnects.has(tunnelName)) {
                        broadcastTunnelStatus(tunnelName, { 
                            connected: false, 
                            status: CONNECTION_STATES.FAILED,
                            errorType: classifyError(errorMsg),
                            reason: errorMsg
                        });
                    }
                    
                    const errorType = classifyError(errorMsg);
                    const shouldNotRetry = !isRemoteHostClosure && (
                        errorType === ERROR_TYPES.AUTH || 
                        errorType === ERROR_TYPES.PORT ||
                        errorType === ERROR_TYPES.PERMISSION
                    );
                    
                    handleDisconnect(tunnelName, hostConfig, !shouldNotRetry, socket, isRemoteHostClosure);
                }
            });
        });
    });

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

function classifyError(errorMessage) {
    if (!errorMessage) return ERROR_TYPES.UNKNOWN;
    
    errorMessage = errorMessage.toLowerCase();
    
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

function startLivenessChecks() {
    setInterval(() => {
        activeTunnels.forEach((conn, tunnelName) => {
            const status = connectionStatus.get(tunnelName);
            if (status && 
                (status.status === CONNECTION_STATES.CONNECTED || 
                 status.status === CONNECTION_STATES.UNSTABLE)) {
                
                try {
                    if (!conn || !conn.exec) {
                        const hostConfig = findHostConfigByName(tunnelName);
                        if (hostConfig) {
                            verifyTunnelConnection(tunnelName, hostConfig, true, null);
                        }
                        return;
                    }
                    
                    conn.exec('echo keepalive', (err, stream) => {
                        if (err) {
                            const hostConfig = findHostConfigByName(tunnelName);
                            if (hostConfig) {
                                verifyTunnelConnection(tunnelName, hostConfig, true, null);
                            }
                        } else {
                            stream.on('close', (code) => {
                                if (code !== 0) {
                                    const hostConfig = findHostConfigByName(tunnelName);
                                    if (hostConfig) {
                                        verifyTunnelConnection(tunnelName, hostConfig, true, null);
                                    }
                                }
                            });
                        }
                    });
                } catch (err) {
                    const hostConfig = findHostConfigByName(tunnelName);
                    if (hostConfig) {
                        verifyTunnelConnection(tunnelName, hostConfig, true, null);
                    }
                }
            }
        });
    }, 30000); // Check every 30 seconds (reduced frequency)
}

function findHostConfigByName(tunnelName) {
    if (!global.hostConfigs) {
        global.hostConfigs = new Map();
        }
        
    return global.hostConfigs.get(tunnelName);
}

startLivenessChecks();

function resetRetryState(tunnelName) {
    retryCounters.delete(tunnelName);
    retryExhaustedTunnels.delete(tunnelName);
    remoteClosureEvents.delete(tunnelName);
    
    if (activeRetryTimers.has(tunnelName)) {
        clearTimeout(activeRetryTimers.get(tunnelName));
        activeRetryTimers.delete(tunnelName);
    }
    
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