import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

export const LoginModal = ({ onLogin, onRegister, onGuest, onClose, isVisible, userRef }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [accountCreationAllowed, setAccountCreationAllowed] = useState(true);
    const [isFirstUser, setIsFirstUser] = useState(false);
    const [activeTab, setActiveTab] = useState('login');
    const [errorMessage, setErrorMessage] = useState('');
    const [showLoginPassword, setShowLoginPassword] = useState(false);
    const [showRegisterPassword, setShowRegisterPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    
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
            // Clear form
            setLoginData({ username: '', password: '' });
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
            // Clear form
            setRegisterData({ username: '', password: '', confirmPassword: '' });
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
                            <div className="relative">
                                <input
                                    id="password"
                                    name="password"
                                    type={showLoginPassword ? "text" : "password"}
                                    required
                                    value={loginData.password}
                                    onChange={handleLoginChange}
                                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="••••••••"
                                />
                                <button
                                    type="button"
                                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-white"
                                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                                >
                                    {showLoginPassword ? (
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
                            <div className="relative">
                                <input
                                    id="register-password"
                                    name="password"
                                    type={showRegisterPassword ? "text" : "password"}
                                    required
                                    value={registerData.password}
                                    onChange={handleRegisterChange}
                                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="Choose a password"
                                />
                                <button
                                    type="button"
                                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-white"
                                    onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                                >
                                    {showRegisterPassword ? (
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
                        <div>
                            <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-300 mb-1">
                                Confirm Password
                            </label>
                            <div className="relative">
                                <input
                                    id="confirm-password"
                                    name="confirmPassword"
                                    type={showConfirmPassword ? "text" : "password"}
                                    required
                                    value={registerData.confirmPassword}
                                    onChange={handleRegisterChange}
                                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="Confirm your password"
                                />
                                <button
                                    type="button"
                                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-white"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                >
                                    {showConfirmPassword ? (
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