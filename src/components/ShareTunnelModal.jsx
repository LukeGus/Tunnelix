import { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';

export const ShareTunnelModal = ({ onClose, onShare, tunnelName }) => {
    const [username, setUsername] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const modalRef = useRef(null);
    
    // Handle clicking outside to close the modal
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (modalRef.current && !modalRef.current.contains(event.target)) {
                onClose();
            }
        };
        
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [onClose]);
    
    // Handle form submission
    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!username.trim()) {
            setError('Please enter a username');
            return;
        }
        
        setError('');
        setIsLoading(true);
        
        try {
            await onShare(username);
            onClose();
        } catch (error) {
            // Only show error in the modal, not in the main app
            setError(error.message || 'Failed to share tunnel');
            setIsLoading(false);
        }
    };
    
    return (
        <div className="fixed inset-0 backdrop-blur-sm bg-slate-900/70 flex items-center justify-center z-50">
            <div ref={modalRef} className="bg-slate-800 rounded-lg shadow-xl w-full max-w-md p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-white">Share Tunnel</h2>
                    <button 
                        onClick={onClose}
                        className="text-slate-400 hover:text-white"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                
                <p className="text-slate-300 mb-4">
                    Share "{tunnelName}" with another user by entering their username below.
                </p>
                
                {error && (
                    <div className="mb-4 p-3 bg-red-900/50 text-red-200 rounded">
                        {error}
                    </div>
                )}
                
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label htmlFor="share-username" className="block text-sm font-medium text-slate-300 mb-1">
                            Username
                        </label>
                        <input
                            id="share-username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Enter username"
                            disabled={isLoading}
                        />
                    </div>
                    
                    <div className="flex justify-end space-x-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-md"
                            disabled={isLoading}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className={`px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md ${
                                isLoading ? 'opacity-70 cursor-not-allowed' : ''
                            }`}
                            disabled={isLoading}
                        >
                            {isLoading ? 'Sharing...' : 'Share'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

ShareTunnelModal.propTypes = {
    onClose: PropTypes.func.isRequired,
    onShare: PropTypes.func.isRequired,
    tunnelName: PropTypes.string.isRequired
}; 