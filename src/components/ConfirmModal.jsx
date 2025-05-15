import { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';

export const ConfirmModal = ({ 
    isOpen, 
    onClose, 
    onConfirm, 
    title = "Confirm Action", 
    message = "Are you sure you want to proceed?", 
    confirmText = "Confirm", 
    cancelText = "Cancel",
    isDestructive = false
}) => {
    const modalRef = useRef(null);
    
    // Handle clicking outside to close the modal
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (modalRef.current && !modalRef.current.contains(event.target)) {
                onClose();
            }
        };
        
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, onClose]);
    
    if (!isOpen) return null;
    
    return (
        <div className="fixed inset-0 backdrop-blur-sm bg-slate-900/70 flex items-center justify-center z-50">
            <div ref={modalRef} className="bg-slate-800 rounded-lg shadow-xl w-full max-w-md p-6" role="dialog" aria-modal="true">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-white">{title}</h2>
                    <button 
                        onClick={onClose}
                        className="text-slate-400 hover:text-white"
                        aria-label="Close"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                
                <p className="text-slate-300 mb-6">
                    {message}
                </p>
                
                <div className="flex justify-end space-x-3">
                    {cancelText && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-md"
                        >
                            {cancelText}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => {
                            onConfirm();
                            onClose();
                        }}
                        className={`px-4 py-2 ${isDestructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'} text-white rounded-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-2 ${isDestructive ? 'focus:ring-red-500' : 'focus:ring-blue-500'}`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

ConfirmModal.propTypes = {
    isOpen: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
    onConfirm: PropTypes.func.isRequired,
    title: PropTypes.string,
    message: PropTypes.string,
    confirmText: PropTypes.string,
    cancelText: PropTypes.string,
    isDestructive: PropTypes.bool
}; 