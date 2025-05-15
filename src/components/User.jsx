import { useRef, forwardRef, useImperativeHandle, useEffect, useState } from "react";
import io from "socket.io-client";
import PropTypes from "prop-types";

const SOCKET_URL = window.location.hostname === "localhost"
    ? "http://localhost:8081"
    : window.location.origin;

let socket = null;

const getSocket = () => {
    if (!socket) {
        socket = io(SOCKET_URL, {
            path: "/database.io/socket.io",
            transports: ["websocket", "polling"],
            autoConnect: false,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000
        });
    }
    
    return socket;
};

export const User = forwardRef(({ onLoginSuccess, onCreateSuccess, onDeleteSuccess, onFailure }, ref) => {
    const socketRef = useRef(getSocket());
    const currentUser = useRef(null);
    const [isConnecting, setIsConnecting] = useState(false);

    useImperativeHandle(ref, () => ({
        loginUser,
        createUser,
        loginAsGuest,
        logoutUser,
        deleteUser,
        checkAccountCreationStatus,
        toggleAccountCreation,
        addAdminUser,
        removeAdminUser,
        getAllAdmins,
        getAllUsers,
        saveTunnel,
        editTunnel,
        deleteTunnel,
        shareTunnel,
        getAllTunnels,
        getUser: () => currentUser.current
    }));

    const safeConnect = async () => {
        if (isConnecting) return;
        
        if (!socketRef.current.connected) {
            setIsConnecting(true);
            try {
                socketRef.current.connect();
                
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error("Connection timeout"));
                    }, 5000);
                    
                    const onConnect = () => {
                        clearTimeout(timeout);
                        socketRef.current.off('connect', onConnect);
                        socketRef.current.off('connect_error', onError);
                        resolve();
                    };
                    
                    const onError = (error) => {
                        clearTimeout(timeout);
                        socketRef.current.off('connect', onConnect);
                        socketRef.current.off('connect_error', onError);
                        reject(error);
                    };
                    
                    socketRef.current.once('connect', onConnect);
                    socketRef.current.once('connect_error', onError);
                });
            } catch (error) {
                throw error;
            } finally {
                setIsConnecting(false);
            }
        }
    };

    const emitWithTimeout = async (event, data = {}, timeout = 10000) => {
        await safeConnect();
        
        if (typeof data === 'number') {
            timeout = data;
            data = {};
        }
        
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Request timeout for ${event}`));
            }, timeout);
            
            try {
                socketRef.current.emit(event, data, function(response) {
                    clearTimeout(timer);
                    resolve(response);
                });
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });
    };

    useEffect(() => {
        safeConnect().catch(error => {
            onFailure("Failed to connect to server");
        });
        
        const verifySession = async () => {
            const storedSession = localStorage.getItem("sessionToken");
            if (!storedSession || storedSession === "undefined") return;

            try {
                const response = await emitWithTimeout("verifySession", { sessionToken: storedSession });

                if (response?.success) {
                    currentUser.current = {
                        id: response.user.id,
                        username: response.user.username,
                        sessionToken: storedSession,
                        isAdmin: response.user.isAdmin || false,
                    };
                    onLoginSuccess(response.user);
                } else {
                    localStorage.removeItem("sessionToken");
                    onFailure("Session expired");
                }
            } catch (error) {
                onFailure("Failed to verify session");
            }
        };

        verifySession();
        
        return () => {
        };
    }, [onLoginSuccess, onFailure]);

    const createUser = async (userConfig) => {
        try {
            const accountCreationStatus = await checkAccountCreationStatus();
            if (!accountCreationStatus.allowed && !accountCreationStatus.isFirstUser) {
                throw new Error("Account creation has been disabled by an administrator");
            }

            const response = await new Promise((resolve) => {
                const isFirstUser = accountCreationStatus.isFirstUser;
                socketRef.current.emit("createUser", { ...userConfig, isAdmin: isFirstUser }, resolve);
            });

            if (response?.user?.sessionToken) {
                currentUser.current = {
                    id: response.user.id,
                    username: response.user.username,
                    sessionToken: response.user.sessionToken,
                    isAdmin: response.user.isAdmin || false,
                };
                localStorage.setItem("sessionToken", response.user.sessionToken);
                onCreateSuccess(response.user);
            } else {
                throw new Error(response?.error || "User creation failed");
            }
        } catch (error) {
            onFailure(error.message);
            throw error;
        }
    };

    const loginUser = async ({ username, password, sessionToken }) => {
        try {
            const response = await new Promise((resolve) => {
                const credentials = sessionToken ? { sessionToken } : { username, password };
                socketRef.current.emit("loginUser", credentials, resolve);
            });

            if (response?.success) {
                currentUser.current = {
                    id: response.user.id,
                    username: response.user.username,
                    sessionToken: response.user.sessionToken,
                    isAdmin: response.user.isAdmin || false,
                };
                localStorage.setItem("sessionToken", response.user.sessionToken);
                onLoginSuccess(response.user);
            } else {
                throw new Error(response?.error || "Login failed");
            }
        } catch (error) {
            onFailure(error.message);
            throw error;
        }
    };

    const loginAsGuest = async () => {
        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("loginAsGuest", resolve);
            });

            if (response?.success) {
                currentUser.current = {
                    id: response.user.id,
                    username: response.user.username,
                    sessionToken: response.user.sessionToken,
                    isAdmin: false,
                };
                localStorage.setItem("sessionToken", response.user.sessionToken);
                onLoginSuccess(response.user);
            } else {
                throw new Error(response?.error || "Guest login failed");
            }
        } catch (error) {
            onFailure(error.message);
            throw error;
        }
    };

    const logoutUser = () => {
        localStorage.removeItem("sessionToken");
        currentUser.current = null;
        
        try {
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current.connect();
            }
        } catch (e) {
        }
        
        if (onLoginSuccess) {
            onLoginSuccess(null);
        }
    };

    const deleteUser = async (targetUserId = null) => {
        if (!currentUser.current) return onFailure("No user logged in");

        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("deleteUser", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    targetUserId: targetUserId
                }, resolve);
            });

            if (response?.success) {
                if (!targetUserId || targetUserId === currentUser.current.id) {
                    logoutUser();
                }
                onDeleteSuccess(response);
            } else {
                throw new Error(response?.error || "User deletion failed");
            }
        } catch (error) {
            onFailure(error.message);
            throw error;
        }
    };

    const checkAccountCreationStatus = async () => {
        try {
            await safeConnect();
            
            const response = await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    resolve({ allowed: true, isFirstUser: false });
                }, 5000);
                
                socketRef.current.emit("checkAccountCreationStatus", (result) => {
                    clearTimeout(timeout);
                    resolve(result || { allowed: true, isFirstUser: false });
                });
            });
            
            return {
                allowed: response?.allowed !== false,
                isFirstUser: response?.isFirstUser || false
            };
        } catch (error) {
            return { allowed: true, isFirstUser: false };
        }
    };

    const toggleAccountCreation = async (enabled) => {
        if (!currentUser.current?.isAdmin) return onFailure("Not authorized");

        try {
            const response = await emitWithTimeout("toggleAccountCreation", {
                userId: currentUser.current.id,
                sessionToken: currentUser.current.sessionToken,
                enabled
            }, 8000);

            if (!response?.success) {
                throw new Error(response?.error || "Failed to update account creation settings");
            }
            
            return response.enabled === true || response.enabled === false ? response.enabled : enabled;
        } catch (error) {
            onFailure(error.message || "Failed to toggle account creation");
            throw error;
        }
    };

    const addAdminUser = async (username) => {
        if (!currentUser.current?.isAdmin) return onFailure("Not authorized");

        try {
            const response = await emitWithTimeout("addAdminUser", {
                userId: currentUser.current.id,
                sessionToken: currentUser.current.sessionToken,
                targetUsername: username
            });

            if (!response?.success) {
                const errorMsg = response?.error || "Failed to add admin user";
                throw new Error(errorMsg);
            }
            
            return true;
        } catch (error) {
            onFailure(error.message || "Failed to add admin");
            throw error;
        }
    };

    const removeAdminUser = async (username) => {
        if (!currentUser.current?.isAdmin) return onFailure("Not authorized");

        try {
            const response = await emitWithTimeout("removeAdminUser", {
                userId: currentUser.current.id,
                sessionToken: currentUser.current.sessionToken,
                targetUsername: username
            });

            if (!response?.success) {
                const errorMsg = response?.error || "Failed to remove admin privileges";
                throw new Error(errorMsg);
            }
            
            return true;
        } catch (error) {
            onFailure(error.message || "Failed to remove admin");
            throw error;
        }
    };

    const getAllAdmins = async () => {
        if (!currentUser.current?.isAdmin) return [];

        try {
            const response = await emitWithTimeout("getAllAdmins", {
                userId: currentUser.current.id,
                sessionToken: currentUser.current.sessionToken,
            });

            if (response?.success) {
                return response.admins || [];
            } else {
                throw new Error(response?.error || "Failed to fetch admins");
            }
        } catch (error) {
            onFailure(error.message || "Failed to load admin users");
            return [];
        }
    };

    const getAllUsers = async () => {
        if (!currentUser.current?.isAdmin) return [];

        try {
            const response = await emitWithTimeout("getAllUsers", {
                userId: currentUser.current.id,
                sessionToken: currentUser.current.sessionToken,
            });

            if (response?.success) {
                return response.users || [];
            } else {
                throw new Error(response?.error || "Failed to fetch users");
            }
        } catch (error) {
            onFailure(error.message || "Failed to load users");
            return [];
        }
    };
    
    const saveTunnel = async (tunnelConfig) => {
        if (!currentUser.current) return onFailure("No user logged in");
        
        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("saveTunnel", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    tunnelConfig
                }, resolve);
            });
            
            if (response?.success) {
                return response.tunnel;
            } else {
                throw new Error(response?.error || "Failed to save tunnel");
            }
        } catch (error) {
            onFailure(error.message);
            throw error;
        }
    };
    
    const editTunnel = async (tunnelId, tunnelConfig) => {
        if (!currentUser.current) return onFailure("No user logged in");
        
        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("editTunnel", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    tunnelId,
                    tunnelConfig
                }, resolve);
            });
            
            if (response?.success) {
                return response.tunnel;
            } else {
                throw new Error(response?.error || "Failed to update tunnel");
            }
        } catch (error) {
            onFailure(error.message);
            throw error;
        }
    };
    
    const deleteTunnel = async (tunnelId) => {
        if (!currentUser.current) return onFailure("No user logged in");
        
        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("deleteTunnel", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    tunnelId
                }, resolve);
            });
            
            if (response?.success) {
                return true;
            } else {
                throw new Error(response?.error || "Failed to delete tunnel");
            }
        } catch (error) {
            onFailure(error.message);
            throw error;
        }
    };
    
    const shareTunnel = async (tunnelId, username) => {
        if (!currentUser.current) return onFailure("No user logged in");
        
        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("shareTunnel", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    tunnelId,
                    targetUsername: username
                }, resolve);
            });
            
            if (response?.success) {
                return true;
            } else {
                throw new Error(response?.error || "Failed to share tunnel");
            }
        } catch (error) {
            onFailure(error.message);
            throw error;
        }
    };
    
    const getAllTunnels = async () => {
        if (!currentUser.current) return [];
        
        try {
            const response = await emitWithTimeout("getTunnels", {
                userId: currentUser.current.id,
                sessionToken: currentUser.current.sessionToken
            });
            
            if (response?.success) {
                return response.tunnels || [];
            } else {
                throw new Error(response?.error || "Failed to fetch tunnels");
            }
        } catch (error) {
            onFailure(error.message);
            return [];
        }
    };

    return null; // This component doesn't render anything
});

User.propTypes = {
    onLoginSuccess: PropTypes.func.isRequired,
    onCreateSuccess: PropTypes.func.isRequired,
    onDeleteSuccess: PropTypes.func.isRequired,
    onFailure: PropTypes.func.isRequired
}; 