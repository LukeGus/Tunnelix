import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import PropTypes from "prop-types";

export const NewTunnel = ({ hostConfig }) => {
    const socketRef = useRef(null);
    const pingIntervalRef = useRef(null);
    const statusCheckIntervalRef = useRef(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);
    const [retryInfo, setRetryInfo] = useState(null);
    const [isDisconnecting, setIsDisconnecting] = useState(false);
    const [statusText, setStatusText] = useState("Disconnected");
    const [hasFailed, setHasFailed] = useState(false);
    const [errorDetails, setErrorDetails] = useState("");
    const [lastDiagnostic, setLastDiagnostic] = useState(null);
    const [wasEverConnected, setWasEverConnected] = useState(false);

    const CONNECTION_STATES = {
        DISCONNECTED: "disconnected",
        CONNECTING: "connecting",
        CONNECTED: "connected",
        VERIFYING: "verifying",
        FAILED: "failed",
        UNSTABLE: "unstable",
        RETRYING: "retrying"
    };

    useEffect(() => {
        const connectSocket = () => {
            const socket = io(
                window.location.hostname === "localhost"
                    ? "http://localhost:8082"
                    : "/",
                {
                    path: "/ssh.io/socket.io",
                    transports: ["websocket", "polling"],
                    reconnection: true,
                    reconnectionAttempts: 5,
                    reconnectionDelay: 1000,
                    timeout: 20000,
                }
            );

            socketRef.current = socket;

            socket.on("connect", () => {
                socket.emit("getTunnelStatus");
            });

            socket.on("tunnelStatus", (statusData) => {
                if (statusData[hostConfig.name]) {
                    updateStatusFromData(statusData[hostConfig.name]);
                } else {
                    resetStatus();
                }
            });
            
            socket.on("individualTunnelStatus", (data) => {
                if (data.name === hostConfig.name) {
                    updateStatusFromData(data.status);
                }
            });

            socket.on("error", (error) => {
                if (typeof error === "object" && error.name === hostConfig.name) {
                    if (error.error) {
                        setErrorDetails(error.error);
                    }
                }
            });
            
            socket.on("diagnosticResult", (diagnostic) => {
                if (diagnostic.name === hostConfig.name) {
                    setLastDiagnostic(diagnostic);
                }
            });

            setupStatusChecks();
        };
        
        function updateStatusFromData(status) {
            if (!status) return;
            
            const isManualDisconnect = status.manualDisconnect === true;
            
            if (isDisconnecting && status.status === CONNECTION_STATES.DISCONNECTED) {
                setIsDisconnecting(false);
                setIsConnected(false);
                setIsVerifying(false);
                setIsConnecting(false);
                setIsRetrying(false);
                setRetryInfo(null);
                setHasFailed(false);
                setStatusText("Disconnected");
                return;
            }
            
            if (status.status === CONNECTION_STATES.RETRYING) {
                setIsRetrying(true);
                setIsConnecting(false);
                setIsVerifying(false);
                setIsConnected(false);
                setHasFailed(false);
                
                const retryData = {
                    current: status.retryCount, 
                    max: status.maxRetries || hostConfig.retryConfig?.maxRetries || 3,
                    nextIn: status.nextRetryIn || 5 // Keep this for static display
                };
                
                setRetryInfo(retryData);
                
                setStatusText(`Retrying (${retryData.current}/${retryData.max})...`);
                return;
            }
            
            const wasConnected = isConnected;
            setIsConnected(status.connected === true);
            
            if (status.connected === true && !wasEverConnected) {
                setWasEverConnected(true);
            }
            
            if (status.status === CONNECTION_STATES.CONNECTING) {
                setIsConnecting(true);
                setIsVerifying(false);
                setIsDisconnecting(false);
                setIsRetrying(false);
                setRetryInfo(null);
                setHasFailed(false);
                setStatusText(status.retryCount ? `Connecting (retry ${status.retryCount})...` : "Connecting...");
                
                if (status.retryCount === 0) {
                    setWasEverConnected(false);
                }
            } else if (status.status === CONNECTION_STATES.VERIFYING) {
                if (!wasEverConnected) {
                    setIsConnecting(false);
                    setIsVerifying(true);
                    setIsDisconnecting(false);
                    setIsRetrying(false);
                    setRetryInfo(null);
                    setHasFailed(false);
                    setStatusText("Verifying...");
                } else {
                    setIsConnecting(false);
                    setIsVerifying(false);
                    setIsDisconnecting(false);
                    setIsRetrying(false);
                    setRetryInfo(null);
                    setStatusText("Connected");
                }
            } else if (status.status === CONNECTION_STATES.CONNECTED) {
                setIsConnecting(false);
                setIsVerifying(false);
                setIsDisconnecting(false);
                setIsRetrying(false);
                setRetryInfo(null);
                setIsConnected(true);
                setHasFailed(false);
                setStatusText("Connected");
                setErrorDetails("");
                setWasEverConnected(true);
            } else if (status.status === CONNECTION_STATES.FAILED) {
                setIsConnecting(false);
                setIsVerifying(false);
                setIsDisconnecting(false);
                setIsRetrying(false);
                setRetryInfo(null);
                setIsConnected(false);
                setHasFailed(true);
                setStatusText("Failed");
                
                if (status.reason) {
                    setErrorDetails(status.reason);
                }
                
            } else if (status.status === CONNECTION_STATES.UNSTABLE) {
                setIsConnecting(false);
                setIsVerifying(false);
                setIsDisconnecting(false);
                setIsRetrying(false);
                setRetryInfo(null);
                setIsConnected(true);
                setHasFailed(false);
                setStatusText("Unstable");
            } else if (status.status === CONNECTION_STATES.DISCONNECTED) {
                if (isManualDisconnect || isDisconnecting) {
                    setIsConnecting(false);
                    setIsVerifying(false);
                    setIsRetrying(false);
                    setRetryInfo(null);
                    setIsConnected(false);
                    setHasFailed(false);
                    setStatusText("Disconnected");
                    setIsDisconnecting(false);
                }
            } else {
                setIsConnecting(false);
                setIsVerifying(false);
                setIsDisconnecting(false);
                setIsRetrying(false);
                setRetryInfo(null);
                setIsConnected(false);
                setHasFailed(false);
                setStatusText("Disconnected");
            }
        }
        
        function resetStatus() {
            setIsConnected(false);
            setIsConnecting(false);
            setIsVerifying(false);
            setIsDisconnecting(false);
            setIsRetrying(false);
            setRetryInfo(null);
            setStatusText("Disconnected");
            setHasFailed(false);
            setErrorDetails("");
        }

        connectSocket();

        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
            if (pingIntervalRef.current) {
                clearInterval(pingIntervalRef.current);
                pingIntervalRef.current = null;
            }
            if (statusCheckIntervalRef.current) {
                clearInterval(statusCheckIntervalRef.current);
                statusCheckIntervalRef.current = null;
            }
        };
    }, [hostConfig.name, isConnected, wasEverConnected]);

    const setupStatusChecks = () => {
        if (statusCheckIntervalRef.current) {
            clearInterval(statusCheckIntervalRef.current);
        }

        statusCheckIntervalRef.current = setInterval(() => {
            if (socketRef.current && socketRef.current.connected) {
                socketRef.current.emit("getTunnelStatus");
                
                if (isConnected) {
                    socketRef.current.emit("diagnose", hostConfig.name);
                }
            }
        }, hostConfig.refreshInterval || 30000);
    };

    const connectTunnel = () => {
        if (isConnected || isConnecting || isVerifying || isDisconnecting || isRetrying || !socketRef.current) return;

        setIsConnecting(true);
        setStatusText("Connecting...");
        setHasFailed(false);
        setErrorDetails("");
        setWasEverConnected(false);
        socketRef.current.emit("connectToHost", hostConfig);
    };

    const closeTunnel = () => {
        if ((!isConnected && !isVerifying && !isRetrying) || isDisconnecting || hasFailed || !socketRef.current) return;

        setIsDisconnecting(true);
        setStatusText("Disconnecting...");
        
        socketRef.current.emit("closeTunnel", hostConfig.name);
    };

    const getStatusColor = () => {
        if (hasFailed) return "bg-red-500";
        if (isConnected) return "bg-green-500";
        if (isVerifying) return "bg-yellow-500";
        if (isConnecting) return "bg-yellow-500";
        if (isRetrying) return "bg-yellow-500";
        if (isDisconnecting) return "bg-yellow-500";
        return "bg-gray-400";
    };

    const requestDiagnostic = () => {
        if (socketRef.current) {
            socketRef.current.emit("diagnose", hostConfig.name);
        }
    };

    return (
        <div className="bg-slate-800 rounded-lg shadow-md overflow-hidden">
            {/* Top Bar */}
            <div className="p-4 bg-slate-700 flex justify-between items-center">
                <h3 className="text-white font-medium truncate">{hostConfig.name}</h3>
                <div className="flex items-center">
                    <div className={`h-3 w-3 rounded-full ${getStatusColor()} mr-2`}></div>
                    <span className="text-sm text-slate-300">
                        {isRetrying && retryInfo ? `Retrying (${retryInfo.current}/${retryInfo.max})` : statusText}
                    </span>
                </div>
            </div>

            {/* Connection Details */}
            <div className="p-4 text-slate-300 text-sm grid">
                {/* Connection info */}
                <div className="grid grid-cols-2 gap-2">
                    <div>Source:</div>
                    <div className="truncate">{hostConfig.sourceIp}:{hostConfig.sourcePort}</div>
                    
                    <div>Endpoint:</div>
                    <div className="truncate">{hostConfig.endPointIp}:{hostConfig.endPointPort}</div>
                </div>
            </div>
            
            {/* Error/Status Messages - Fixed height area */}
            <div className="h-8 px-4 -mt-2 mb-1">
                {errorDetails && (hasFailed || isRetrying) && (
                    <div className="text-red-400 text-xs overflow-hidden text-ellipsis whitespace-nowrap">
                        {errorDetails}
                    </div>
                )}
                
                {isRetrying && retryInfo && retryInfo.nextIn && (
                    <div className="text-yellow-400 text-xs">
                        Next attempt in {retryInfo.nextIn}s
                    </div>
                )}
            </div>

            {/* Action Buttons */}
            <div className="p-4 bg-slate-700 flex space-x-2">
                <button
                    onClick={connectTunnel}
                    disabled={isConnected || isConnecting || isVerifying || isDisconnecting || isRetrying}
                    className={`px-4 py-2 rounded text-white font-medium flex-1 ${
                        isConnected || isConnecting || isVerifying || isDisconnecting || isRetrying
                            ? "bg-slate-600 cursor-not-allowed"
                            : "bg-blue-600 hover:bg-blue-700"
                    }`}
                >
                    Connect
                </button>
                <button
                    onClick={closeTunnel}
                    disabled={(!isConnected && !isVerifying && !isRetrying) || isDisconnecting || hasFailed}
                    className={`px-4 py-2 rounded text-white font-medium flex-1 ${
                        (!isConnected && !isVerifying && !isRetrying) || isDisconnecting || hasFailed
                            ? "bg-slate-600 cursor-not-allowed"
                            : "bg-red-600 hover:bg-red-700"
                    }`}
                >
                    {isRetrying ? "Cancel" : "Disconnect"}
                </button>
            </div>
        </div>
    );
};

NewTunnel.displayName = "NewTunnel";

NewTunnel.propTypes = {
    hostConfig: PropTypes.shape({
        name: PropTypes.string.isRequired,
        sourceIp: PropTypes.string.isRequired,
        sourceUser: PropTypes.string.isRequired,
        sourcePassword: PropTypes.string.isRequired,
        sourceSSHPort: PropTypes.number.isRequired,
        sourcePort: PropTypes.number.isRequired,

        endPointIp: PropTypes.string.isRequired,
        endPointUser: PropTypes.string.isRequired,
        endPointPassword: PropTypes.string.isRequired,
        endPointSSHPort: PropTypes.number.isRequired,
        endPointPort: PropTypes.number.isRequired,
        
        retryConfig: PropTypes.shape({
            maxRetries: PropTypes.number,
            retryInterval: PropTypes.number
        }),
        refreshInterval: PropTypes.number
    }).isRequired
};