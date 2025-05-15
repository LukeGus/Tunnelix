import { useState, useRef, useEffect } from 'react';
import { NewTunnel } from "./components/SSHTunnel.jsx";
import { AddTunnelModal } from './components/AddTunnelModal.jsx';
import { EditTunnelModal } from './components/EditTunnelModal.jsx';
import { ShareTunnelModal } from './components/ShareTunnelModal.jsx';
import { LoginModal } from './components/LoginModal.jsx';
import { UserProfileDropdown } from './components/UserProfileDropdown.jsx';
import { AdminPanel } from './components/AdminPanel.jsx';
import { ConfirmModal } from './components/ConfirmModal.jsx';
import { User } from './components/User.jsx';

function App() {
    const userRef = useRef(null);
    
    useEffect(() => {
        window.userRef = userRef;
        return () => {
            window.userRef = null;
        };
    }, []);
    
    const [tunnels, setTunnels] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
    const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
    const [isDeleteAccountModalOpen, setIsDeleteAccountModalOpen] = useState(false);
    const [isDeleteTunnelModalOpen, setIsDeleteTunnelModalOpen] = useState(false);
    const [selectedTunnel, setSelectedTunnel] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    
    useEffect(() => {
        const checkSession = async () => {
            setLoading(true);
            try {
                const storedSession = localStorage.getItem("sessionToken");
                
                if (storedSession) {
                    setIsLoginModalOpen(false);
                    
                    setTimeout(() => {
                        setLoading(false);
                    }, 3000);
                } else {
                    setLoading(false);
                    setTimeout(() => {
                        setIsLoginModalOpen(true);
                    }, 100);
                }
            } catch (error) {
                setLoading(false);
                setTimeout(() => {
                    setIsLoginModalOpen(true);
                }, 100);
            }
        };
        
        checkSession();
    }, []);
    
    useEffect(() => {
        if (!currentUser) {
            setIsLoginModalOpen(true);
        } else {
            setIsLoginModalOpen(false);
            setLoading(false);
        }
    }, [currentUser]);
    
    useEffect(() => {
        if (currentUser) {
            loadTunnels();
        }
    }, [currentUser]);
    
    const loadTunnels = async () => {
        try {
            if (userRef.current && currentUser) {
                const fetchedTunnels = await userRef.current.getAllTunnels();
                setTunnels(fetchedTunnels);
            }
        } catch (error) {
            setError("Failed to load tunnels: " + error.message);
        }
    };
    
    const handleLoginSuccess = (user) => {
        setCurrentUser(user);
        setIsLoginModalOpen(false);
        setError('');
    };
    
    const handleCreateSuccess = (user) => {
        setCurrentUser(user);
        setIsLoginModalOpen(false);
        setError('');
    };
    
    const handleDeleteSuccess = () => {
        setCurrentUser(null);
        setTunnels([]);
        setIsLoginModalOpen(true);
        setError('');
    };
    
    const handleFailure = (errorMessage) => {
        if (!currentUser) {
            return;
        }
        
        setError(errorMessage);
    };
    
    const handleLogin = async (loginData) => {
        if (userRef.current) {
            await userRef.current.loginUser(loginData);
        }
    };
    
    const handleRegister = async (registerData) => {
        if (userRef.current) {
            await userRef.current.createUser({
                username: registerData.username,
                password: registerData.password
            });
        }
    };
    
    const handleGuestLogin = async () => {
        if (userRef.current) {
            await userRef.current.loginAsGuest();
        }
    };
    
    const handleLogout = () => {
        if (userRef.current) {
            userRef.current.logoutUser();
            setCurrentUser(null);
            setTunnels([]);
            
            setIsLoginModalOpen(true);
            
            localStorage.removeItem("sessionToken");
        }
    };
    
    const handleDeleteAccount = async () => {
        try {
            if (userRef.current) {
                await userRef.current.deleteUser();
            }
        } catch (error) {
            setError("Failed to delete account: " + error.message);
        }
    };
    
    const addNewTunnel = async (tunnelConfig) => {
        try {
            if (userRef.current) {
                await userRef.current.saveTunnel(tunnelConfig);
                setIsAddModalOpen(false);
                await loadTunnels();
            }
        } catch (error) {
            setError("Failed to add tunnel: " + error.message);
        }
    };
    
    const editTunnel = async (tunnelConfig) => {
        try {
            if (userRef.current && selectedTunnel) {
                await userRef.current.editTunnel(selectedTunnel.id, tunnelConfig);
                await loadTunnels();
                setIsEditModalOpen(false);
                setSelectedTunnel(null);
            }
        } catch (error) {
            setError("Failed to update tunnel: " + error.message);
        }
    };
    
    const shareTunnel = async (username) => {
        try {
            if (userRef.current && selectedTunnel) {
                await userRef.current.shareTunnel(selectedTunnel.id, username);
                setIsShareModalOpen(false);
                setSelectedTunnel(null);
            }
        } catch (error) {
            throw new Error(error.message || "Failed to share tunnel");
        }
    };
    
    const deleteTunnel = async () => {
        try {
            if (userRef.current && selectedTunnel) {
                await userRef.current.deleteTunnel(selectedTunnel.id);
                setTunnels(prevTunnels => 
                    prevTunnels.filter(tunnel => tunnel.id !== selectedTunnel.id)
                );
                setSelectedTunnel(null);
                setIsDeleteTunnelModalOpen(false);
            }
        } catch (error) {
            setError("Failed to delete tunnel: " + error.message);
        }
    };
    
    const handleEditTunnel = (tunnel) => {
        setSelectedTunnel(tunnel);
        setIsEditModalOpen(true);
    };
    
    const handleShareTunnel = (tunnel) => {
        setSelectedTunnel(tunnel);
        setIsShareModalOpen(true);
    };
    
    const handleDeleteTunnel = (tunnel) => {
        setSelectedTunnel(tunnel);
        setIsDeleteTunnelModalOpen(true);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="flex flex-col items-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
                    <div className="text-white text-lg">Loading Tunnelix...</div>
                </div>
                
                {/* Make the User component available during loading to handle session verification */}
                <div className="hidden">
                    <User
                        ref={userRef}
                        onLoginSuccess={handleLoginSuccess}
                        onCreateSuccess={handleCreateSuccess}
                        onDeleteSuccess={handleDeleteSuccess}
                        onFailure={handleFailure}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-900">
            {/* User component (invisible) */}
            <User
                ref={userRef}
                onLoginSuccess={handleLoginSuccess}
                onCreateSuccess={handleCreateSuccess}
                onDeleteSuccess={handleDeleteSuccess}
                onFailure={handleFailure}
            />
            
            {/* Login Modal */}
            <LoginModal
                isVisible={isLoginModalOpen}
                onClose={() => {}}
                onLogin={handleLogin}
                onRegister={handleRegister}
                onGuest={handleGuestLogin}
                userRef={userRef}
            />
            
            {/* Admin Panel */}
            <AdminPanel
                isOpen={isAdminPanelOpen}
                onClose={() => setIsAdminPanelOpen(false)}
                userRef={userRef}
            />
            
            {/* Delete Account Confirmation Modal */}
            <ConfirmModal
                isOpen={isDeleteAccountModalOpen}
                onClose={() => setIsDeleteAccountModalOpen(false)}
                onConfirm={handleDeleteAccount}
                title="Delete Account"
                message="Are you sure you want to delete your account? This action cannot be undone and will delete all your tunnels."
                confirmText="Delete Account"
                cancelText="Cancel"
                isDestructive={true}
            />
            
            {/* Delete Tunnel Confirmation Modal */}
            <ConfirmModal
                isOpen={isDeleteTunnelModalOpen}
                onClose={() => setIsDeleteTunnelModalOpen(false)}
                onConfirm={deleteTunnel}
                title={`${selectedTunnel?.isOwner ? 'Delete' : 'Remove'} Tunnel`}
                message={`Are you sure you want to ${selectedTunnel?.isOwner ? 'delete' : 'remove'} the tunnel "${selectedTunnel?.name || ''}"? ${selectedTunnel?.isOwner ? 'This action cannot be undone.' : ''}`}
                confirmText={selectedTunnel?.isOwner ? 'Delete' : 'Remove'}
                cancelText="Cancel"
                isDestructive={true}
            />
            
            {/* Top Bar */}
            <div className="bg-slate-800 text-white w-full h-16 px-6 flex items-center justify-between shadow-md">
                <h1 className="text-xl font-semibold">Tunnelix</h1>
                
                {currentUser && (
                    <div className="flex items-center space-x-4">
                        <button
                            onClick={() => setIsAddModalOpen(true)}
                            className="bg-slate-700 hover:bg-slate-600 text-white rounded-md w-9 h-9 relative transition-colors"
                            title="Add Tunnel"
                        >
                            <span className="absolute inset-0 flex items-center justify-center text-3xl font-bold" style={{ marginTop: "-7px" }}>+</span>
                        </button>
                        
                        <UserProfileDropdown
                            user={currentUser}
                            onLogout={handleLogout}
                            onDeleteAccount={() => setIsDeleteAccountModalOpen(true)}
                            onOpenAdminPanel={() => setIsAdminPanelOpen(true)}
                        />
                    </div>
                )}
            </div>
            
            {/* Tunnels Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 p-6">
                {tunnels.map((tunnel) => (
                    <div key={tunnel.id} className="h-auto relative group">
                        {/* Overlay with controls - moved to top and centered */}
                        <div className="absolute top-2 left-1/2 transform -translate-x-1/2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                            {tunnel.isOwner && (
                                <>
                                    <button
                                        onClick={() => handleEditTunnel(tunnel)}
                                        className="p-1 bg-slate-800/80 hover:bg-slate-700 rounded-md text-slate-200"
                                        title="Edit Tunnel"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                    </button>
                                    
                                    <button
                                        onClick={() => handleShareTunnel(tunnel)}
                                        className="p-1 bg-slate-800/80 hover:bg-slate-700 rounded-md text-slate-200"
                                        title="Share Tunnel"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                                        </svg>
                                    </button>
                                </>
                            )}
                            
                            <button
                                onClick={() => handleDeleteTunnel(tunnel)}
                                className="p-1 bg-slate-800/80 hover:bg-red-900 rounded-md text-slate-200"
                                title={tunnel.isOwner ? "Delete Tunnel" : "Remove Tunnel"}
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        </div>

                        <NewTunnel hostConfig={tunnel.config} />
                    </div>
                ))}
            </div>
            
            {/* Add Tunnel Modal */}
            {isAddModalOpen && (
                <AddTunnelModal 
                    onClose={() => setIsAddModalOpen(false)}
                    onAdd={addNewTunnel}
                />
            )}
            
            {/* Edit Tunnel Modal */}
            {isEditModalOpen && selectedTunnel && (
                <EditTunnelModal 
                    onClose={() => {
                        setIsEditModalOpen(false);
                        setSelectedTunnel(null);
                    }}
                    onSave={editTunnel}
                    tunnelData={selectedTunnel.config}
                />
            )}
            
            {/* Share Tunnel Modal */}
            {isShareModalOpen && selectedTunnel && (
                <ShareTunnelModal 
                    onClose={() => {
                        setIsShareModalOpen(false);
                        setSelectedTunnel(null);
                    }}
                    onShare={shareTunnel}
                    tunnelName={selectedTunnel.name}
                />
            )}
        </div>
    );
}

export default App;