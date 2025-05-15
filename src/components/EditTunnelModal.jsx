import { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';

export const EditTunnelModal = ({ onClose, onSave, tunnelData }) => {
    const modalRef = useRef(null);
    
    // Initialize form with tunnel data
    const [tunnelConfig, setTunnelConfig] = useState(tunnelData || {
        name: '',
        sourceIp: '',
        sourceUser: '',
        sourcePassword: '',
        sourceSSHPort: 22,
        sourcePort: 22,
        endPointIp: '',
        endPointUser: '',
        endPointPassword: '',
        endPointSSHPort: 22,
        endPointPort: 0,
        retryConfig: {
            maxRetries: 3,
            retryInterval: 5000
        },
        refreshInterval: 10000
    });

    // Update form when tunnelData changes
    useEffect(() => {
        if (tunnelData) {
            setTunnelConfig({
                ...tunnelData,
                // Ensure nested objects exist
                retryConfig: tunnelData.retryConfig || {
                    maxRetries: 3,
                    retryInterval: 5000
                }
            });
        }
    }, [tunnelData]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        
        if (name.includes('.')) {
            // Handle nested object fields (retryConfig.maxRetries)
            const [parent, child] = name.split('.');
            setTunnelConfig({
                ...tunnelConfig,
                [parent]: {
                    ...tunnelConfig[parent],
                    [child]: name.includes('retryInterval') || name.includes('refreshInterval') 
                        ? Number(value) 
                        : Number.isNaN(Number(value)) ? value : Number(value)
                }
            });
        } else {
            // Handle direct fields
            setTunnelConfig({
                ...tunnelConfig,
                [name]: name.includes('Port') || name === 'refreshInterval'
                    ? Number(value) 
                    : value
            });
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(tunnelConfig);
    };
    
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

    return (
        <div className="fixed inset-0 backdrop-blur-sm bg-slate-900/70 flex items-center justify-center z-50">
            <div ref={modalRef} className="bg-slate-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-auto">
                <div className="p-5 border-b border-slate-700 flex justify-between items-center sticky top-0 bg-slate-800 z-10">
                    <h2 className="text-xl font-semibold text-white">Edit Tunnel</h2>
                    <button 
                        onClick={onClose}
                        className="text-slate-400 hover:text-white"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                
                <form onSubmit={handleSubmit} className="p-5 space-y-6">
                    <div className="grid grid-cols-1 gap-6">
                        {/* Tunnel Name */}
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-slate-300 mb-1">
                                Tunnel Name
                            </label>
                            <input
                                id="name"
                                name="name"
                                type="text"
                                required
                                value={tunnelConfig.name}
                                onChange={handleChange}
                                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="My SSH Tunnel"
                            />
                        </div>
                        
                        {/* Source Configuration Section */}
                        <div className="border border-slate-700 rounded-lg p-4">
                            <h3 className="text-lg font-medium text-slate-200 mb-4">Source Configuration</h3>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="sourceIp" className="block text-sm font-medium text-slate-300 mb-1">
                                        Source IP
                                    </label>
                                    <input
                                        id="sourceIp"
                                        name="sourceIp"
                                        type="text"
                                        required
                                        value={tunnelConfig.sourceIp}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="192.168.1.1"
                                    />
                                </div>
                                
                                <div>
                                    <label htmlFor="sourcePort" className="block text-sm font-medium text-slate-300 mb-1">
                                        Source Port
                                    </label>
                                    <input
                                        id="sourcePort"
                                        name="sourcePort"
                                        type="number"
                                        required
                                        value={tunnelConfig.sourcePort}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                
                                <div>
                                    <label htmlFor="sourceUser" className="block text-sm font-medium text-slate-300 mb-1">
                                        Source Username
                                    </label>
                                    <input
                                        id="sourceUser"
                                        name="sourceUser"
                                        type="text"
                                        required
                                        value={tunnelConfig.sourceUser}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                
                                <div>
                                    <label htmlFor="sourcePassword" className="block text-sm font-medium text-slate-300 mb-1">
                                        Source Password
                                    </label>
                                    <input
                                        id="sourcePassword"
                                        name="sourcePassword"
                                        type="password"
                                        required
                                        value={tunnelConfig.sourcePassword}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                
                                <div>
                                    <label htmlFor="sourceSSHPort" className="block text-sm font-medium text-slate-300 mb-1">
                                        Source SSH Port
                                    </label>
                                    <input
                                        id="sourceSSHPort"
                                        name="sourceSSHPort"
                                        type="number"
                                        required
                                        value={tunnelConfig.sourceSSHPort}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                        </div>
                        
                        {/* Endpoint Configuration Section */}
                        <div className="border border-slate-700 rounded-lg p-4">
                            <h3 className="text-lg font-medium text-slate-200 mb-4">Endpoint Configuration</h3>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="endPointIp" className="block text-sm font-medium text-slate-300 mb-1">
                                        Endpoint IP
                                    </label>
                                    <input
                                        id="endPointIp"
                                        name="endPointIp"
                                        type="text"
                                        required
                                        value={tunnelConfig.endPointIp}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="192.168.1.2"
                                    />
                                </div>
                                
                                <div>
                                    <label htmlFor="endPointPort" className="block text-sm font-medium text-slate-300 mb-1">
                                        Endpoint Port
                                    </label>
                                    <input
                                        id="endPointPort"
                                        name="endPointPort"
                                        type="number"
                                        required
                                        value={tunnelConfig.endPointPort}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                
                                <div>
                                    <label htmlFor="endPointUser" className="block text-sm font-medium text-slate-300 mb-1">
                                        Endpoint Username
                                    </label>
                                    <input
                                        id="endPointUser"
                                        name="endPointUser"
                                        type="text"
                                        required
                                        value={tunnelConfig.endPointUser}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                
                                <div>
                                    <label htmlFor="endPointPassword" className="block text-sm font-medium text-slate-300 mb-1">
                                        Endpoint Password
                                    </label>
                                    <input
                                        id="endPointPassword"
                                        name="endPointPassword"
                                        type="password"
                                        required
                                        value={tunnelConfig.endPointPassword}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                
                                <div>
                                    <label htmlFor="endPointSSHPort" className="block text-sm font-medium text-slate-300 mb-1">
                                        Endpoint SSH Port
                                    </label>
                                    <input
                                        id="endPointSSHPort"
                                        name="endPointSSHPort"
                                        type="number"
                                        required
                                        value={tunnelConfig.endPointSSHPort}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                        </div>
                        
                        {/* Advanced Options Section */}
                        <div className="border border-slate-700 rounded-lg p-4">
                            <h3 className="text-lg font-medium text-slate-200 mb-4">Advanced Options</h3>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="retryConfig.maxRetries" className="block text-sm font-medium text-slate-300 mb-1">
                                        Max Retries
                                    </label>
                                    <input
                                        id="retryConfig.maxRetries"
                                        name="retryConfig.maxRetries"
                                        type="number"
                                        required
                                        value={tunnelConfig.retryConfig?.maxRetries || 3}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                
                                <div>
                                    <label htmlFor="retryConfig.retryInterval" className="block text-sm font-medium text-slate-300 mb-1">
                                        Retry Interval (ms)
                                    </label>
                                    <input
                                        id="retryConfig.retryInterval"
                                        name="retryConfig.retryInterval"
                                        type="number"
                                        required
                                        value={tunnelConfig.retryConfig?.retryInterval || 5000}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                
                                <div>
                                    <label htmlFor="refreshInterval" className="block text-sm font-medium text-slate-300 mb-1">
                                        Refresh Interval (ms)
                                    </label>
                                    <input
                                        id="refreshInterval"
                                        name="refreshInterval"
                                        type="number"
                                        required
                                        value={tunnelConfig.refreshInterval || 10000}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex justify-end space-x-3 pt-3 border-t border-slate-700">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-md"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md"
                        >
                            Save Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

EditTunnelModal.propTypes = {
    onClose: PropTypes.func.isRequired,
    onSave: PropTypes.func.isRequired,
    tunnelData: PropTypes.object.isRequired
}; 