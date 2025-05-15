import { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';

export const EditTunnelModal = ({ onClose, onSave, tunnelData }) => {
    const modalRef = useRef(null);
    const [showSourcePassword, setShowSourcePassword] = useState(false);
    const [showEndpointPassword, setShowEndpointPassword] = useState(false);
    const [sourceKey, setSourceKey] = useState(null);
    const [endPointKey, setEndPointKey] = useState(null);
    const [showSshpassInfo, setShowSshpassInfo] = useState(false);
    
    // Add ref for file inputs
    const sourceKeyInputRef = useRef(null);
    const endPointKeyInputRef = useRef(null);
    
    const [tunnelConfig, setTunnelConfig] = useState(tunnelData || {
        name: '',
        sourceIp: '',
        sourceUser: '',
        sourceAuthType: 'password',
        sourcePassword: '',
        sourceKeyType: 'rsa',
        sourceSSHPort: 22,
        sourcePort: 22,
        endPointIp: '',
        endPointUser: '',
        endPointAuthType: 'password',
        endPointPassword: '',
        endPointKeyType: 'rsa',
        endPointSSHPort: 22,
        endPointPort: 0,
        retryConfig: {
            maxRetries: 3,
            retryInterval: 5000
        },
        refreshInterval: 30000
    });

    useEffect(() => {
        if (tunnelData) {
            const newTunnelConfig = {
                ...tunnelData,
                sourceAuthType: tunnelData.sourceAuthType || 'password',
                sourceKeyType: tunnelData.sourceKeyType || 'rsa',
                endPointAuthType: tunnelData.endPointAuthType || 'password',
                endPointKeyType: tunnelData.endPointKeyType || 'rsa',
                retryConfig: tunnelData.retryConfig || {
                    maxRetries: 3,
                    retryInterval: 5000
                }
            };
            
            setTunnelConfig(newTunnelConfig);
            
            if (tunnelData.sourceKey) {
                setSourceKey(tunnelData.sourceKey);
            }
            
            if (tunnelData.endPointKey) {
                setEndPointKey(tunnelData.endPointKey);
            }
        }
    }, [tunnelData]);

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
            
            // Reset key when auth type changes
            if (name === 'sourceAuthType') {
                if (value === 'password') {
                    setSourceKey(null);
                    if (sourceKeyInputRef.current) {
                        sourceKeyInputRef.current.value = '';
                    }
                }
            } else if (name === 'endPointAuthType') {
                if (value === 'password') {
                    setEndPointKey(null);
                    if (endPointKeyInputRef.current) {
                        endPointKeyInputRef.current.value = '';
                    }
                }
            }
        }
    };

    const handleFileChange = (event, setKeyFunction, keyType) => {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            setKeyFunction(content);
            
            // Auto-detect key type based on content
            let detectedKeyType = 'rsa'; // Default to RSA
            
            if (content.includes('BEGIN OPENSSH PRIVATE KEY')) {
                // Modern OpenSSH format, likely ED25519
                if (content.toLowerCase().includes('ed25519')) {
                    detectedKeyType = 'ed25519';
                } else if (content.toLowerCase().includes('ecdsa')) {
                    detectedKeyType = 'ecdsa';
                }
            } else if (content.includes('BEGIN DSA PRIVATE KEY')) {
                detectedKeyType = 'dsa';
            } else if (content.includes('BEGIN EC PRIVATE KEY')) {
                detectedKeyType = 'ecdsa';
            } else if (content.includes('BEGIN PRIVATE KEY') || content.includes('BEGIN RSA PRIVATE KEY')) {
                detectedKeyType = 'rsa';
            }
            
            // Update the key type in the config
            if (keyType === 'source') {
                setTunnelConfig(prev => ({
                    ...prev,
                    sourceKeyType: detectedKeyType
                }));
            } else if (keyType === 'endpoint') {
                setTunnelConfig(prev => ({
                    ...prev,
                    endPointKeyType: detectedKeyType
                }));
            }
        };
        reader.onerror = () => {
            console.error('Error reading file');
        };
        reader.readAsText(file);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        
        // Create a copy of the config with key data
        const configWithKeys = { ...tunnelConfig };
        
        if (tunnelConfig.sourceAuthType === 'key') {
            if (sourceKey) {
                configWithKeys.sourceKey = sourceKey;
            } else if (tunnelData.hasSourceKey) {
                // Keep existing key if the user didn't upload a new one
                configWithKeys.sourceKey = null;
            }
        }
        
        if (tunnelConfig.endPointAuthType === 'key') {
            if (endPointKey) {
                configWithKeys.endPointKey = endPointKey;
            } else if (tunnelData.hasEndPointKey) {
                // Keep existing key if the user didn't upload a new one
                configWithKeys.endPointKey = null;
            }
        }
        
        onSave(configWithKeys);
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
                                
                                <div className="flex items-center text-blue-300">
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
                            
                            {/* SSHPass Info Alert */}
                            <div className="bg-yellow-900/30 border border-yellow-700 rounded-md p-3 mb-4 text-yellow-200 text-sm">
                                <div className="flex items-start">
                                    <div className="flex-shrink-0 mt-0.5">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                        </svg>
                                    </div>
                                    <div className="ml-3">
                                        <h3 className="font-medium text-yellow-300">Required: sshpass installation</h3>
                                        <div className="mt-1">
                                            <p>For password-based authentication, <code className="bg-slate-800 px-1 rounded">sshpass</code> must be installed on both the local and remote servers.</p>
                                            <p className="mt-1">Install using: <code className="bg-slate-800 px-1 rounded">sudo apt-get install sshpass</code> (on Debian/Ubuntu) or the equivalent for your system.</p>
                                            <button
                                                type="button"
                                                className="text-yellow-300 hover:text-yellow-100 underline mt-1 text-xs"
                                                onClick={() => setShowSshpassInfo(!showSshpassInfo)}
                                            >
                                                {showSshpassInfo ? 'Hide Details' : 'Show More Details'}
                                            </button>
                                            {showSshpassInfo && (
                                                <div className="mt-2 bg-slate-800/50 p-2 rounded text-xs">
                                                    <p><strong>Other installation methods:</strong></p>
                                                    <ul className="list-disc list-inside mt-1">
                                                        <li>CentOS/RHEL/Fedora: <code>sudo yum install sshpass</code> or <code>sudo dnf install sshpass</code></li>
                                                        <li>macOS: <code>brew install hudochenkov/sshpass/sshpass</code></li>
                                                        <li>Windows: Use WSL or consider using SSH key authentication instead</li>
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            {/* SSH Config Alert */}
                            <div className="bg-blue-900/30 border border-blue-700 rounded-md p-3 mb-4 text-blue-200 text-sm">
                                <div className="flex items-start">
                                    <div className="flex-shrink-0 mt-0.5">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                    <div className="ml-3">
                                        <h3 className="font-medium text-blue-300">Required: SSH Server Configuration</h3>
                                        <div className="mt-1">
                                            <p>For reverse SSH tunnels to work, the endpoint SSH server must allow:</p>
                                            <ul className="list-disc list-inside mt-1 space-y-1">
                                                <li><code className="bg-slate-800 px-1 rounded">GatewayPorts yes</code> - Allows binding to remote ports</li>
                                                <li><code className="bg-slate-800 px-1 rounded">AllowTcpForwarding yes</code> - Permits port forwarding</li>
                                                <li><code className="bg-slate-800 px-1 rounded">PermitRootLogin yes</code> - (If using root user)</li>
                                            </ul>
                                            <p className="mt-2">Edit <code className="bg-slate-800 px-1 rounded">/etc/ssh/sshd_config</code> on the endpoint server and restart SSH with <code className="bg-slate-800 px-1 rounded">sudo systemctl restart sshd</code></p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
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
                                    <label htmlFor="sourceAuthType" className="block text-sm font-medium text-slate-300 mb-1">
                                        Authentication Method
                                    </label>
                                    <select
                                        id="sourceAuthType"
                                        name="sourceAuthType"
                                        value={tunnelConfig.sourceAuthType}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="password">Password</option>
                                        <option value="key">SSH Key</option>
                                    </select>
                                </div>
                                
                                {tunnelConfig.sourceAuthType === 'password' ? (
                                    <div className="md:col-span-2">
                                        <label htmlFor="sourcePassword" className="block text-sm font-medium text-slate-300 mb-1">
                                            Source Password
                                        </label>
                                        <div className="relative">
                                            <input
                                                id="sourcePassword"
                                                name="sourcePassword"
                                                type={showSourcePassword ? "text" : "password"}
                                                required={tunnelConfig.sourceAuthType === 'password'}
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
                                ) : (
                                    <>
                                        <div className="md:col-span-2">
                                            <label htmlFor="sourceKey" className="block text-sm font-medium text-slate-300 mb-1">
                                                SSH Private Key
                                            </label>
                                            <div className="relative">
                                                <label 
                                                    className={`w-full px-3 py-2 bg-slate-700 border ${sourceKey || tunnelData?.hasSourceKey ? 'border-green-600 bg-green-900/20' : 'border-slate-600'} rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center cursor-pointer hover:bg-slate-600`}
                                                >
                                                    <input
                                                        ref={sourceKeyInputRef}
                                                        id="sourceKey"
                                                        name="sourceKey"
                                                        type="file"
                                                        onChange={(e) => handleFileChange(e, setSourceKey, 'source')}
                                                        className="hidden"
                                                    />
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                                    </svg>
                                                    <span className={`truncate ${sourceKey ? 'text-green-300' : 'text-slate-300'}`}>
                                                        {sourceKey ? 'New Key Selected' : tunnelData?.hasSourceKey ? 'Using Saved Key (Click to Change)' : 'Choose Private Key File'}
                                                    </span>
                                                </label>
                                            </div>
                                            <p className="mt-1 text-xs text-slate-400">
                                                {tunnelData?.hasSourceKey 
                                                    ? "A key is already saved. Upload a new file only if you want to change it." 
                                                    : "Upload your private key file (e.g., id_rsa, id_ed25519)"}
                                                {sourceKey && <> - Detected <span className="font-medium text-blue-400">{tunnelConfig.sourceKeyType.toUpperCase()}</span> key</>}
                                                {!sourceKey && tunnelData?.hasSourceKey && <> (<span className="font-medium text-blue-400">{tunnelConfig.sourceKeyType.toUpperCase()}</span>)</>}
                                            </p>
                                        </div>
                                    </>
                                )}
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
                                    <label htmlFor="endPointAuthType" className="block text-sm font-medium text-slate-300 mb-1">
                                        Authentication Method
                                    </label>
                                    <select
                                        id="endPointAuthType"
                                        name="endPointAuthType"
                                        value={tunnelConfig.endPointAuthType}
                                        onChange={handleChange}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="password">Password</option>
                                        <option value="key">SSH Key</option>
                                    </select>
                                </div>
                                
                                {tunnelConfig.endPointAuthType === 'password' ? (
                                    <div className="md:col-span-2">
                                        <label htmlFor="endPointPassword" className="block text-sm font-medium text-slate-300 mb-1">
                                            Endpoint Password
                                        </label>
                                        <div className="relative">
                                            <input
                                                id="endPointPassword"
                                                name="endPointPassword"
                                                type={showEndpointPassword ? "text" : "password"}
                                                required={tunnelConfig.endPointAuthType === 'password'}
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
                                ) : (
                                    <>
                                        <div className="md:col-span-2">
                                            <label htmlFor="endPointKey" className="block text-sm font-medium text-slate-300 mb-1">
                                                SSH Private Key
                                            </label>
                                            <div className="relative">
                                                <label 
                                                    className={`w-full px-3 py-2 bg-slate-700 border ${endPointKey || tunnelData?.hasEndPointKey ? 'border-green-600 bg-green-900/20' : 'border-slate-600'} rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center cursor-pointer hover:bg-slate-600`}
                                                >
                                                    <input
                                                        ref={endPointKeyInputRef}
                                                        id="endPointKey"
                                                        name="endPointKey"
                                                        type="file"
                                                        onChange={(e) => handleFileChange(e, setEndPointKey, 'endpoint')}
                                                        className="hidden"
                                                    />
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                                    </svg>
                                                    <span className={`truncate ${endPointKey ? 'text-green-300' : 'text-slate-300'}`}>
                                                        {endPointKey ? 'New Key Selected' : tunnelData?.hasEndPointKey ? 'Using Saved Key (Click to Change)' : 'Choose Private Key File'}
                                                    </span>
                                                </label>
                                            </div>
                                            <p className="mt-1 text-xs text-slate-400">
                                                {tunnelData?.hasEndPointKey 
                                                    ? "A key is already saved. Upload a new file only if you want to change it." 
                                                    : "Upload your private key file (e.g., id_rsa, id_ed25519)"}
                                                {endPointKey && <> - Detected <span className="font-medium text-blue-400">{tunnelConfig.endPointKeyType.toUpperCase()}</span> key</>}
                                                {!endPointKey && tunnelData?.hasEndPointKey && <> (<span className="font-medium text-blue-400">{tunnelConfig.endPointKeyType.toUpperCase()}</span>)</>}
                                            </p>
                                        </div>
                                    </>
                                )}
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
                                        value={tunnelConfig.refreshInterval || 30000}
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