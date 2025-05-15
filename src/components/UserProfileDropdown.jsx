import { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { ConfirmModal } from './ConfirmModal.jsx';

export const UserProfileDropdown = ({ user, onLogout, onDeleteAccount, onOpenAdminPanel }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isOnlyAdmin, setIsOnlyAdmin] = useState(false);
    const dropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const toggleDropdown = () => {
        setIsOpen(!isOpen);
    };

    const handleLogout = () => {
        setIsOpen(false);
        onLogout();
    };

    const openDeleteAccount = async () => {
        setIsOpen(false);

        if (user?.isAdmin) {
            try {
                const admins = await window.userRef?.current?.getAllAdmins();
                
                if (admins && admins.length === 1) {
                    setIsOnlyAdmin(true);
                } else {
                    setIsOnlyAdmin(false);
                    setIsDeleteModalOpen(true);
                }
            } catch (error) {
                setIsOnlyAdmin(false);
                setIsDeleteModalOpen(true);
            }
        } else {
            setIsOnlyAdmin(false);
            setIsDeleteModalOpen(true);
        }
    };

    const confirmDeleteAccount = () => {
        onDeleteAccount();
    };

    const handleOpenAdminPanel = () => {
        setIsOpen(false);
        onOpenAdminPanel();
    };

    const getUserTypeLabel = () => {
        if (!user) return '';
        if (user.isAdmin) return 'Admin';
        if (user.username.startsWith('guest-')) return 'Guest';
        return 'User';
    };
    
    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={toggleDropdown}
                className="flex items-center px-3 h-9 bg-slate-700 hover:bg-slate-600 rounded-md focus:outline-none"
                aria-label="User menu"
            >
                <span className="text-white text-sm">
                    {user ? user.username : 'Guest'}
                </span>
                <svg 
                    className="w-4 h-4 ml-1 text-slate-400" 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24" 
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            
            {isOpen && (
                <div className="absolute right-0 mt-2 w-48 py-2 bg-slate-800 border border-slate-700 rounded-md shadow-lg z-50">
                    <div className="px-4 py-2 border-b border-slate-700">
                        <p className="text-white text-sm font-medium truncate">{user ? user.username : 'Guest'}</p>
                        <p className="text-slate-400 text-xs">{getUserTypeLabel()}</p>
                    </div>
                    
                    {user?.isAdmin && (
                        <button
                            onClick={handleOpenAdminPanel}
                            className="w-full text-left px-4 py-2 text-sm text-white hover:bg-slate-700 flex items-center"
                        >
                            <svg className="w-4 h-4 mr-2 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            Admin Panel
                        </button>
                    )}
                    
                    <button
                        onClick={handleLogout}
                        className="w-full text-left px-4 py-2 text-sm text-white hover:bg-slate-700 flex items-center"
                    >
                        <svg className="w-4 h-4 mr-2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        Logout
                    </button>

                    {user && !user.username.startsWith('guest-') && (
                        <button
                            onClick={openDeleteAccount}
                            className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-slate-700 flex items-center"
                        >
                            <svg className="w-4 h-4 mr-2 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Delete Account
                        </button>
                    )}
                    
                    <div className="mt-2 px-4 py-1 border-t border-slate-700">
                        <p className="text-slate-500 text-xs text-right">v0.1</p>
                    </div>
                </div>
            )}

            {/* Delete Account Confirmation Modal */}
            <ConfirmModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={confirmDeleteAccount}
                title="Delete Account"
                message="Are you sure you want to delete your account? This action cannot be undone and will delete all your tunnels."
                confirmText="Delete Account"
                cancelText="Cancel"
                isDestructive={true}
            />

            {/* Only Admin Warning Modal */}
            <ConfirmModal
                isOpen={isOnlyAdmin}
                onClose={() => setIsOnlyAdmin(false)}
                onConfirm={() => setIsOnlyAdmin(false)}
                title="Cannot Delete Account"
                message="You are the only administrator in the system. Please add another admin before deleting your account."
                confirmText="OK"
                cancelText=""
                isDestructive={false}
            />
        </div>
    );
};

UserProfileDropdown.propTypes = {
    user: PropTypes.shape({
        id: PropTypes.string.isRequired,
        username: PropTypes.string.isRequired,
        isAdmin: PropTypes.bool
    }),
    onLogout: PropTypes.func.isRequired,
    onDeleteAccount: PropTypes.func.isRequired,
    onOpenAdminPanel: PropTypes.func.isRequired
}; 