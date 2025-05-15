import { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';

export const AddTunnelModal = ({ onClose, onAdd }) => {
    const modalRef = useRef(null);
    const initialFormState = {
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
        refreshInterval: 30000
    };
    
    const [tunnelConfig, setTunnelConfig] = useState(initialFormState);
    const [showSourcePassword, setShowSourcePassword] = useState(false);
    const [showEndpointPassword, setShowEndpointPassword] = useState(false);

    const handleChange = (e) => {
        const { name, value } = e.target;
        
        if (name.includes('.')) {
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
        onAdd(tunnelConfig);
        setTunnelConfig(initialFormState);
    };
    
    const handleReset = () => {
        setTunnelConfig(initialFormState);
    };
    
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
                    <h2 className="text-xl font-semibold text-white">Add New Tunnel</h2>
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
                        
                        {/* Tunnel Port Configuration */}
                        <div className="border border-slate-700 rounded-lg p-4 bg-blue-900/20">
                            <h3 className="text-lg font-medium text-blue-300 mb-4">Tunnel Port Configuration</h3>
                            
                            <div className="flex flex-col md:flex-row items-center justify-center gap-6 mb-2">
                                <div className="w-full md:w-5/12">
                                    <label htmlFor="sourcePort" className="block text-sm font-medium text-slate-300 text-center mb-1">
                                        Source Port (Local)
                                    </label>
                                    <input
                                        id="sourcePort"
                                        name="sourcePort"
                                        type="number"
                                        required
                                        value={tunnelConfig.sourcePort}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-center"
                                    />
                                </div>
                                
                                <div className="flex items-center text-blue-300 self-end pb-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                                    </svg>
                                </div>
                                
                                <div className="w-full md:w-5/12">
                                    <label htmlFor="endPointPort" className="block text-sm font-medium text-slate-300 text-center mb-1">
                                        Endpoint Port (Remote)
                                    </label>
                                    <input
                                        id="endPointPort"
                                        name="endPointPort"
                                        type="number"
                                        required
                                        value={tunnelConfig.endPointPort}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-center"
                                    />
                                </div>
                            </div>
                            
                            <div className="text-xs text-blue-200 text-center mt-2">
                                This tunnel will forward traffic from port {tunnelConfig.sourcePort} on the source machine to port {tunnelConfig.endPointPort} on the endpoint machine.
                            </div>
                        </div>
                        
                        {/* Source Configuration Section */}
                        <div className="border border-slate-700 rounded-lg p-4">
                            <h3 className="text-lg font-medium text-slate-200 mb-4">Source Configuration (Local Machine)</h3>
                            
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
                                        placeholder="localhost"
                                    />
                                </div>
                                
                                <div>
                                    <label htmlFor="sourceSSHPort" className="block text-sm font-medium text-slate-300 mb-1">
                                        Source SSH Port (for connection)
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
                                    <div className="relative">
                                        <input
                                            id="sourcePassword"
                                            name="sourcePassword"
                                            type={showSourcePassword ? "text" : "password"}
                                            required
                                            value={tunnelConfig.sourcePassword}
                                            onChange={handleChange}
                                            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <button
                                            type="button"
                                            className="absolute right-2 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-white"
                                            onClick={() => setShowSourcePassword(!showSourcePassword)}
                                        >
                                            {showSourcePassword ? (
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                                </svg>
                                            ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                </svg>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        {/* Endpoint Configuration Section */}
                        <div className="border border-slate-700 rounded-lg p-4">
                            <h3 className="text-lg font-medium text-slate-200 mb-4">Endpoint Configuration (Remote Machine)</h3>
                            
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
                                    <label htmlFor="endPointSSHPort" className="block text-sm font-medium text-slate-300 mb-1">
                                        Endpoint SSH Port (for connection)
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
                                    <div className="relative">
                                        <input
                                            id="endPointPassword"
                                            name="endPointPassword"
                                            type={showEndpointPassword ? "text" : "password"}
                                            required
                                            value={tunnelConfig.endPointPassword}
                                            onChange={handleChange}
                                            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <button
                                            type="button"
                                            className="absolute right-2 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-white"
                                            onClick={() => setShowEndpointPassword(!showEndpointPassword)}
                                        >
                                            {showEndpointPassword ? (
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                                </svg>
                                            ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                </svg>
                                            )}
                                        </button>
                                    </div>
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
                                        value={tunnelConfig.retryConfig.maxRetries}
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
                                        value={tunnelConfig.retryConfig.retryInterval}
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
                                        value={tunnelConfig.refreshInterval}
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
                            onClick={handleReset}
                            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-md"
                        >
                            Reset
                        </button>
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
                            Add Tunnel
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

AddTunnelModal.propTypes = {
    onClose: PropTypes.func.isRequired,
    onAdd: PropTypes.func.isRequired
}; 