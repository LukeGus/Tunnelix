import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

export const LoginModal = ({ onLogin, onRegister, onGuest, onClose, isVisible, userRef }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [accountCreationAllowed, setAccountCreationAllowed] = useState(true);
    const [isFirstUser, setIsFirstUser] = useState(false);
    const [activeTab, setActiveTab] = useState('login');
    const [errorMessage, setErrorMessage] = useState('');
    
    // Form data
    const [loginData, setLoginData] = useState({ username: '', password: '' });
    const [registerData, setRegisterData] = useState({ username: '', password: '', confirmPassword: '' });
    
    // Check account creation status
    useEffect(() => {
        const checkStatus = async () => {
            try {
                if (userRef.current) {
                    const status = await userRef.current.checkAccountCreationStatus();
                    setAccountCreationAllowed(status.allowed);
                    setIsFirstUser(status.isFirstUser);
                    
                    // If this is the first user, switch to register tab
                    if (status.isFirstUser) {
                        setActiveTab('register');
                    }
                }
            } catch (err) {
                console.error('Failed to check account status:', err);
                setErrorMessage('Unable to connect to server. Please try again later.');
            }
        };
        
        if (isVisible) {
            checkStatus();
        }
    }, [isVisible, userRef]);
    
    // Clear error when tab changes
    useEffect(() => {
        setErrorMessage('');
    }, [activeTab]);
    
    // Expose API error handling to parent
    useEffect(() => {
        const handleError = error => {
            if (isVisible) {
                setErrorMessage(typeof error === 'string' ? error : 'Authentication failed. Please try again.');
                setIsLoading(false);
            }
        };
        
        // Register this function with a global event bus or parent component
        if (userRef.current && userRef.current.onLoginFailure) {
            userRef.current.onLoginFailure = handleError;
        }
    }, [isVisible]);

    const handleLoginChange = (e) => {
        const { name, value } = e.target;
        setLoginData(prev => ({ ...prev, [name]: value }));
    };

    const handleRegisterChange = (e) => {
        const { name, value } = e.target;
        setRegisterData(prev => ({ ...prev, [name]: value }));
    };

    const handleLoginSubmit = async (e) => {
        e.preventDefault();
        setErrorMessage('');
        setIsLoading(true);
        
        try {
            await onLogin(loginData);
        } catch (error) {
            setErrorMessage(error.message || 'Login failed');
        } finally {
            setIsLoading(false);
        }
    };

    const handleRegisterSubmit = async (e) => {
        e.preventDefault();
        setErrorMessage('');
        
        // Validation
        if (registerData.password !== registerData.confirmPassword) {
            setErrorMessage('Passwords do not match');
            return;
        }
        
        if (registerData.password.length < 6) {
            setErrorMessage('Password must be at least 6 characters long');
            return;
        }
        
        setIsLoading(true);
        
        try {
            await onRegister(registerData);
        } catch (error) {
            setErrorMessage(error.message || 'Registration failed');
        } finally {
            setIsLoading(false);
        }
    };

    const handleGuestLogin = async () => {
        setErrorMessage('');
        setIsLoading(true);
        
        try {
            await onGuest();
        } catch (error) {
            setErrorMessage(error.message || 'Guest login failed');
        } finally {
            setIsLoading(false);
        }
    };

    if (!isVisible) return null;

    return (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-slate-900/75 backdrop-blur-sm">
            <div className="bg-slate-800 rounded-lg shadow-xl w-full max-w-md p-6 border border-slate-700">
                <h2 className="text-2xl font-bold text-white mb-6 text-center">
                    {isFirstUser ? 'Welcome to Tunnelix' : 'Welcome Back'}
                </h2>
                
                {isFirstUser && (
                    <div className="mb-4 bg-blue-900/50 text-blue-200 p-3 rounded">
                        <p className="text-sm">
                            <span className="font-semibold">You're the first user!</span> Your account will be created with admin privileges.
                        </p>
                    </div>
                )}
                
                {errorMessage && (
                    <div className="mb-4 bg-red-900/50 text-red-200 p-3 rounded">
                        <p className="text-sm">{errorMessage}</p>
                    </div>
                )}

                {!isFirstUser && (
                    <div className="flex mb-4 border-b border-slate-700">
                        <button
                            className={`flex-1 py-2 font-medium ${
                                activeTab === 'login' 
                                    ? 'text-blue-400 border-b-2 border-blue-400' 
                                    : 'text-slate-400 hover:text-white'
                            }`}
                            onClick={() => setActiveTab('login')}
                        >
                            Login
                        </button>
                        {accountCreationAllowed && (
                            <button
                                className={`flex-1 py-2 font-medium ${
                                    activeTab === 'register' 
                                        ? 'text-blue-400 border-b-2 border-blue-400' 
                                        : 'text-slate-400 hover:text-white'
                                }`}
                                onClick={() => setActiveTab('register')}
                            >
                                Register
                            </button>
                        )}
                    </div>
                )}

                {activeTab === 'login' && !isFirstUser ? (
                    <form onSubmit={handleLoginSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="username" className="block text-sm font-medium text-slate-300 mb-1">
                                Username
                            </label>
                            <input
                                id="username"
                                name="username"
                                type="text"
                                required
                                value={loginData.username}
                                onChange={handleLoginChange}
                                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Enter your username"
                            />
                        </div>
                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-1">
                                Password
                            </label>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                required
                                value={loginData.password}
                                onChange={handleLoginChange}
                                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="••••••••"
                            />
                        </div>
                        <div className="pt-2">
                            <button
                                type="submit"
                                disabled={isLoading}
                                className={`w-full py-2 px-4 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium ${
                                    isLoading ? 'opacity-70 cursor-not-allowed' : ''
                                }`}
                            >
                                {isLoading ? 'Logging in...' : 'Login'}
                            </button>
                        </div>
                    </form>
                ) : (
                    <form onSubmit={handleRegisterSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="register-username" className="block text-sm font-medium text-slate-300 mb-1">
                                Username
                            </label>
                            <input
                                id="register-username"
                                name="username"
                                type="text"
                                required
                                value={registerData.username}
                                onChange={handleRegisterChange}
                                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Choose a username"
                            />
                        </div>
                        <div>
                            <label htmlFor="register-password" className="block text-sm font-medium text-slate-300 mb-1">
                                Password
                            </label>
                            <input
                                id="register-password"
                                name="password"
                                type="password"
                                required
                                value={registerData.password}
                                onChange={handleRegisterChange}
                                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Choose a password"
                            />
                        </div>
                        <div>
                            <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-300 mb-1">
                                Confirm Password
                            </label>
                            <input
                                id="confirm-password"
                                name="confirmPassword"
                                type="password"
                                required
                                value={registerData.confirmPassword}
                                onChange={handleRegisterChange}
                                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Confirm your password"
                            />
                        </div>
                        <div className="pt-2">
                            <button
                                type="submit"
                                disabled={isLoading}
                                className={`w-full py-2 px-4 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium ${
                                    isLoading ? 'opacity-70 cursor-not-allowed' : ''
                                }`}
                            >
                                {isLoading ? 'Creating Account...' : (isFirstUser ? 'Create Admin Account' : 'Register')}
                            </button>
                        </div>
                    </form>
                )}

                {accountCreationAllowed && !isFirstUser && (
                    <div className="mt-4 text-center">
                        <button
                            onClick={handleGuestLogin}
                            disabled={isLoading}
                            className="text-sm text-slate-400 hover:text-white"
                        >
                            Continue as Guest
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

LoginModal.propTypes = {
    onLogin: PropTypes.func.isRequired,
    onRegister: PropTypes.func.isRequired,
    onGuest: PropTypes.func.isRequired,
    onClose: PropTypes.func.isRequired,
    isVisible: PropTypes.bool.isRequired,
    userRef: PropTypes.object.isRequired
}; 