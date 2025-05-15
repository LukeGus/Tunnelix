import { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { ConfirmModal } from './ConfirmModal.jsx';

export const AdminPanel = ({ isOpen, onClose, userRef }) => {
    const [activeTab, setActiveTab] = useState('users');
    const [users, setUsers] = useState([]);
    const [admins, setAdmins] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [accountCreationEnabled, setAccountCreationEnabled] = useState(true);
    const [newAdminUsername, setNewAdminUsername] = useState('');
    const [userToDelete, setUserToDelete] = useState(null);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const modalRef = useRef(null);
    const adminInputRef = useRef(null);
    
    // Handle clicking outside to close the modal
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (modalRef.current && !modalRef.current.contains(event.target)) {
                // Check if we're clicking on a modal (like a ConfirmModal)
                const isClickingOnModal = event.target.closest('[role="dialog"]');
                
                // Don't close if we're clicking on another modal
                if (!isClickingOnModal) {
                    onClose();
                }
            }
        };
        
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, onClose]);
    
    // Load users and admins when panel opens
    useEffect(() => {
        if (isOpen) {
            // Clear any previous errors
            setErrorMessage('');
            // Start by setting loading state
            setIsLoading(true);
            
            const fetchData = async () => {
                try {
                    // Load settings first
                    await checkAccountCreationStatus();
                    
                    // Then load users and admins
                    await Promise.all([
                        loadUsers(),
                        loadAdmins()
                    ]);
                } catch (error) {
                    console.error("Error loading admin panel data:", error);
                    setErrorMessage("Failed to load admin panel data. Please try again.");
                } finally {
                    // Always set loading to false when done
                    setIsLoading(false);
                }
            };
            
            fetchData();
            
            // Focus the admin input field when the panel opens
            setTimeout(() => {
                if (adminInputRef.current) {
                    adminInputRef.current.focus();
                }
            }, 300);
        }
    }, [isOpen]);
    
    // Load all users
    const loadUsers = async (retryCount = 0) => {
        try {
            if (userRef.current) {
                const allUsers = await userRef.current.getAllUsers();
                setUsers(allUsers || []);
                return allUsers;
            }
        } catch (error) {
            // Retry on network errors
            if (retryCount < 2) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                return loadUsers(retryCount + 1);
            }
            
            setErrorMessage('Failed to load users: ' + (error.message || "Unknown error"));
            throw error;
        }
    };
    
    // Load admin users with retry mechanism
    const loadAdmins = async (retryCount = 0) => {
        try {
            if (userRef.current) {
                const adminList = await userRef.current.getAllAdmins();
                
                if (!adminList || adminList.length === 0) {
                    // If empty and we're an admin, something might be wrong
                    const currentUserData = userRef.current.getUser();
                    if (currentUserData?.isAdmin && retryCount < 2) {
                        // Wait a bit and retry
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        return loadAdmins(retryCount + 1);
                    }
                }
                
                setAdmins(adminList || []);
                return adminList;
            }
        } catch (error) {
            // Retry on network errors
            if (retryCount < 2) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                return loadAdmins(retryCount + 1);
            }
            
            setErrorMessage('Failed to load admins: ' + (error.message || "Unknown error"));
            throw error;
        }
    };
    
    // Check account creation status with better error handling
    const checkAccountCreationStatus = async () => {
        try {
            if (userRef.current) {
                const status = await userRef.current.checkAccountCreationStatus();
                
                // Only update state if we got a valid response
                if (status && typeof status.allowed === 'boolean') {
                    setAccountCreationEnabled(status.allowed);
                }
                return status;
            }
        } catch (error) {
            // Don't set error message here - just log it
            // This prevents the error from showing during initial load
        }
    };
    
    // Toggle account creation setting with better error handling
    const toggleAccountCreation = async () => {
        // Prevent multiple clicks
        if (isLoading) return;
        
        setIsLoading(true);
        setErrorMessage('');
        
        try {
            if (userRef.current) {
                // Store current state to revert if needed
                const previousState = accountCreationEnabled;
                
                // Optimistically update UI
                setAccountCreationEnabled(!previousState);
                
                // Call the API with a timeout
                const togglePromise = userRef.current.toggleAccountCreation(!previousState);
                
                // Add a timeout to the promise
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error("Toggle operation timed out")), 5000);
                });
                
                // Race the promises
                const result = await Promise.race([togglePromise, timeoutPromise]);
                
                // If result is not what we expected, revert
                if (typeof result === 'boolean' && result !== !previousState) {
                    setAccountCreationEnabled(previousState);
                }
                
                // Refresh admin list after toggling account creation
                await loadAdmins();
            }
        } catch (error) {
            // Revert UI state on error
            setAccountCreationEnabled(accountCreationEnabled);
            setErrorMessage(error.message || 'Failed to update account creation setting');
        } finally {
            setIsLoading(false);
        }
    };
    
    // Make a user an admin
    const addAdmin = async (e) => {
        e.preventDefault();
        if (!newAdminUsername.trim()) return;
        
        setIsLoading(true);
        setErrorMessage('');
        setSuccessMessage('');
        
        try {
            if (userRef.current) {
                await userRef.current.addAdminUser(newAdminUsername);
                setSuccessMessage(`User "${newAdminUsername}" is now an admin`);
                setNewAdminUsername('');
                await loadAdmins();
                await loadUsers();
                
                // Focus the input field again
                if (adminInputRef.current) {
                    adminInputRef.current.focus();
                }
            }
        } catch (error) {
            setErrorMessage(error.message || 'Failed to add admin');
        } finally {
            setIsLoading(false);
        }
    };
    
    // Remove admin privileges
    const removeAdmin = async (username) => {
        setIsLoading(true);
        setErrorMessage('');
        setSuccessMessage('');
        
        try {
            if (userRef.current) {
                await userRef.current.removeAdminUser(username);
                setSuccessMessage(`Admin privileges removed from "${username}"`);
                await loadAdmins();
                await loadUsers();
            }
        } catch (error) {
            setErrorMessage(error.message || 'Failed to remove admin privileges');
        } finally {
            setIsLoading(false);
        }
    };
    
    // Open delete user confirmation modal
    const confirmDeleteUser = (userId, username) => {
        setUserToDelete({ id: userId, username });
        setIsDeleteModalOpen(true);
    };
    
    // Delete a user
    const deleteUser = async () => {
        if (!userToDelete) return;
        
        setIsLoading(true);
        setErrorMessage('');
        setSuccessMessage('');
        
        try {
            if (userRef.current) {
                await userRef.current.deleteUser(userToDelete.id);
                setSuccessMessage(`User "${userToDelete.username}" deleted successfully`);
                await loadUsers();
                await loadAdmins();
                setUserToDelete(null);
                setIsDeleteModalOpen(false);
            }
        } catch (error) {
            setErrorMessage(error.message || 'Failed to delete user');
        } finally {
            setIsLoading(false);
        }
    };
    
    // Clear messages when changing tabs
    const handleTabChange = (tab) => {
        setActiveTab(tab);
        setErrorMessage('');
        setSuccessMessage('');
    };
    
    // If panel is closed, don't render anything
    if (!isOpen) return null;
    
    // Get current user for permissions
    const currentUserData = userRef.current?.getUser();
    
    return (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-slate-900/75 backdrop-blur-sm">
            <div ref={modalRef} className="bg-slate-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-auto border border-slate-700">
                <div className="p-4 border-b border-slate-700 flex justify-between items-center sticky top-0 bg-slate-800 z-10">
                    <h2 className="text-xl font-semibold text-white">Admin Panel</h2>
                    <button 
                        onClick={onClose}
                        className="text-slate-400 hover:text-white"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                
                <div className="flex border-b border-slate-700">
                    <button
                        className={`flex-1 py-3 px-4 font-medium ${
                            activeTab === 'users' 
                                ? 'text-blue-400 border-b-2 border-blue-400 -mb-px' 
                                : 'text-slate-400 hover:text-white'
                        }`}
                        onClick={() => handleTabChange('users')}
                    >
                        User Management
                    </button>
                    <button
                        className={`flex-1 py-3 px-4 font-medium ${
                            activeTab === 'settings' 
                                ? 'text-blue-400 border-b-2 border-blue-400 -mb-px' 
                                : 'text-slate-400 hover:text-white'
                        }`}
                        onClick={() => handleTabChange('settings')}
                    >
                        Application Settings
                    </button>
                </div>
                
                <div className="p-6">
                    {/* Messages */}
                    {errorMessage && (
                        <div className="mb-4 p-3 bg-red-900/50 text-red-200 rounded">
                            <button 
                                onClick={() => setErrorMessage('')}
                                className="float-right text-red-200 hover:text-white"
                            >
                                ✕
                            </button>
                            {errorMessage}
                        </div>
                    )}
                    
                    {successMessage && (
                        <div className="mb-4 p-3 bg-green-900/50 text-green-200 rounded">
                            <button 
                                onClick={() => setSuccessMessage('')}
                                className="float-right text-green-200 hover:text-white"
                            >
                                ✕
                            </button>
                            {successMessage}
                        </div>
                    )}
                    
                    {/* User Management Tab */}
                    {activeTab === 'users' && (
                        <div>
                            <h3 className="text-lg font-semibold text-white mb-4">User Management</h3>
                            
                            <div className="mb-6">
                                <h4 className="text-md font-semibold text-white mb-2">Add Admin</h4>
                                <form onSubmit={addAdmin} className="flex space-x-2">
                                    <input
                                        ref={adminInputRef}
                                        type="text"
                                        value={newAdminUsername}
                                        onChange={(e) => setNewAdminUsername(e.target.value)}
                                        placeholder="Username"
                                        className="flex-grow px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        disabled={isLoading}
                                    />
                                    <button
                                        type="submit"
                                        className={`px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md ${
                                            isLoading || !newAdminUsername.trim() ? 'opacity-70 cursor-not-allowed' : ''
                                        }`}
                                        disabled={isLoading || !newAdminUsername.trim()}
                                    >
                                        Add Admin
                                    </button>
                                </form>
                            </div>
                            
                            <div className="mb-6">
                                <h4 className="text-md font-semibold text-white mb-2">Current Admins</h4>
                                {isLoading ? (
                                    <div className="bg-slate-700 p-4 rounded-md text-slate-300 flex items-center justify-center">
                                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Loading admins...
                                    </div>
                                ) : admins.length === 0 ? (
                                    <p className="text-slate-400">No admins found</p>
                                ) : (
                                    <div className="bg-slate-900 rounded-md overflow-hidden">
                                        <div className="max-h-[200px] overflow-y-auto">
                                            <table className="min-w-full divide-y divide-slate-700">
                                                <thead className="bg-slate-800 sticky top-0 z-10">
                                                    <tr>
                                                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                                                            Username
                                                        </th>
                                                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-300 uppercase tracking-wider">
                                                            Actions
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-700">
                                                    {admins.map((admin) => (
                                                        <tr key={admin.id}>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                                                                {admin.username}
                                                            </td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                                {/* Don't allow removing your own admin privileges or if there's only one admin */}
                                                                {admin.id !== currentUserData?.id && admins.length > 1 && (
                                                                    <button
                                                                        onClick={() => removeAdmin(admin.username)}
                                                                        className="text-red-400 hover:text-red-300"
                                                                        disabled={isLoading}
                                                                    >
                                                                        Remove Admin
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                            
                            <div className="mb-6">
                                <h4 className="text-md font-semibold text-white mb-2">All Users</h4>
                                {isLoading ? (
                                    <div className="bg-slate-700 p-4 rounded-md text-slate-300 flex items-center justify-center">
                                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Loading users...
                                    </div>
                                ) : users.length === 0 ? (
                                    <p className="text-slate-400">No users found</p>
                                ) : (
                                    <div className="bg-slate-900 rounded-md overflow-hidden">
                                        <div className="max-h-[300px] overflow-y-auto">
                                            <table className="min-w-full divide-y divide-slate-700">
                                                <thead className="bg-slate-800 sticky top-0 z-10">
                                                    <tr>
                                                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                                                            Username
                                                        </th>
                                                        <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                                                            Role
                                                        </th>
                                                        <th className="px-6 py-3 text-right text-xs font-medium text-slate-300 uppercase tracking-wider">
                                                            Actions
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-700">
                                                    {users.map((user) => (
                                                        <tr key={user.id}>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                                                                {user.username}
                                                            </td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                                                                {user.isAdmin ? (
                                                                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-200 text-purple-800">
                                                                        Admin
                                                                    </span>
                                                                ) : user.username.startsWith('guest-') ? (
                                                                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-slate-200 text-slate-800">
                                                                        Guest
                                                                    </span>
                                                                ) : (
                                                                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-200 text-blue-800">
                                                                        User
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                                {/* Don't allow deleting yourself */}
                                                                {user.id !== currentUserData?.id && (
                                                                    <button
                                                                        onClick={() => confirmDeleteUser(user.id, user.username)}
                                                                        className="text-red-400 hover:text-red-300"
                                                                        disabled={isLoading}
                                                                    >
                                                                        Delete
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    
                    {/* Settings Tab */}
                    {activeTab === 'settings' && (
                        <div>
                            <h3 className="text-lg font-semibold text-white mb-4">Application Settings</h3>
                            
                            <div className="space-y-6">
                                <div className="flex items-center justify-between p-4 bg-slate-700 rounded-md">
                                    <div>
                                        <h4 className="text-md font-semibold text-white">Account Creation</h4>
                                        <p className="text-sm text-slate-300 mt-1">
                                            {accountCreationEnabled 
                                                ? 'New users can create accounts and use guest access' 
                                                : 'Only existing users can login, no new registrations'
                                            }
                                        </p>
                                    </div>
                                    <div className="flex items-center">
                                        <span className={`mr-3 text-sm font-medium ${accountCreationEnabled ? 'text-green-400' : 'text-red-400'}`}>
                                            {accountCreationEnabled ? 'Enabled' : 'Disabled'}
                                        </span>
                                        <div className="relative inline-block w-14 align-middle select-none">
                                            <input
                                                type="checkbox"
                                                name="accountCreation"
                                                id="accountCreation"
                                                className="sr-only"
                                                checked={accountCreationEnabled}
                                                onChange={() => !isLoading && toggleAccountCreation()}
                                                disabled={isLoading}
                                            />
                                            <label
                                                htmlFor="accountCreation"
                                                className={`block h-8 overflow-hidden rounded-full cursor-pointer ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            >
                                                <span
                                                    className={`block h-8 w-14 rounded-full transition-colors duration-200 ease-in-out ${
                                                        accountCreationEnabled ? 'bg-green-500' : 'bg-red-500'
                                                    }`}
                                                ></span>
                                                <span
                                                    className={`absolute block w-6 h-6 rounded-full bg-white border-2 border-transparent transition-transform duration-200 ease-in-out transform top-1 ${
                                                        accountCreationEnabled ? 'right-1' : 'left-1'
                                                    }`}
                                                ></span>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            
            {/* Delete User Confirmation Modal */}
            <ConfirmModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={deleteUser}
                title="Delete User"
                message={`Are you sure you want to delete user "${userToDelete?.username}"? This action cannot be undone and will delete all their tunnels.`}
                confirmText="Delete User"
                cancelText="Cancel"
                isDestructive={true}
            />
        </div>
    );
};

AdminPanel.propTypes = {
    isOpen: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
    userRef: PropTypes.object.isRequired
}; 