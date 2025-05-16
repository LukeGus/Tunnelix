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
                <div className="flex items-center bg-slate-700 hover:bg-slate-600 rounded-md h-9 px-3 transition-colors">
                    <svg className="w-6 h-6 mr-2 flex-shrink-0" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
                        <path d="M0 0 C1.51057124 1.32240795 3.01044818 2.65700381 4.50952148 3.99243164 C5.17725586 4.58668945 5.84499023 5.18094727 6.53295898 5.79321289 C27.25711073 25.39845504 40.93996498 56.0366966 42.45483398 84.41821289 C42.47288086 85.26770508 42.49092773 86.11719727 42.50952148 86.99243164 C42.5675293 88.56057617 42.5675293 88.56057617 42.62670898 90.16040039 C43.3377843 125.12160318 30.53936166 155.14047792 7.50952148 180.99243164 C6.91526367 181.66016602 6.32100586 182.32790039 5.70874023 183.01586914 C-15.76724381 205.7175297 -47.53822755 217.52794152 -78.22875977 219.19555664 C-113.51455092 219.65832111 -145.00725445 207.29599541 -170.54516602 182.92993164 C-194.78438671 159.12269706 -207.13914191 127.17552724 -207.74047852 93.42993164 C-207.10798994 60.01345203 -194.52924446 31.73186331 -172.49047852 6.99243164 C-171.8962207 6.32469727 -171.30196289 5.65696289 -170.68969727 4.96899414 C-125.71269525 -42.57493355 -47.93462091 -41.28110303 0 0 Z " fill="#334155" transform="translate(210.490478515625,34.007568359375)"/>
                        <path d="M0 0 C0.97590088 -0.00281982 1.95180176 -0.00563965 2.95727539 -0.00854492 C4.03162842 -0.00652069 5.10598145 -0.00449646 6.21289062 -0.00241089 C7.34138428 -0.00416321 8.46987793 -0.00591553 9.63256836 -0.00772095 C13.3781079 -0.01213696 17.12360057 -0.00920233 20.86914062 -0.00582886 C23.46223968 -0.00650197 26.05533867 -0.00747205 28.6484375 -0.00872803 C34.08919939 -0.01020466 39.52994353 -0.00814635 44.97070312 -0.00338745 C51.26570472 0.00205496 57.56067393 0.00029222 63.85567474 -0.00521386 C69.90517119 -0.01029392 75.95465176 -0.00976221 82.00415039 -0.00683212 C84.58146163 -0.00616311 87.1587737 -0.00699038 89.73608398 -0.00931168 C93.33254209 -0.01183969 96.92893723 -0.00799544 100.52539062 -0.00241089 C101.59974365 -0.00443512 102.67409668 -0.00645935 103.78100586 -0.00854492 C105.24485718 -0.00431519 105.24485718 -0.00431519 106.73828125 0 C108.01475525 0.00056554 108.01475525 0.00056554 109.3170166 0.0011425 C111.36914062 0.12698364 111.36914062 0.12698364 113.36914062 1.12698364 C113.36914062 14.65698364 113.36914062 28.18698364 113.36914062 42.12698364 C110.19520374 43.71395209 106.78739858 43.27012834 103.30664062 43.25198364 C102.18805664 43.25778442 102.18805664 43.25778442 101.046875 43.26370239 C95.49577563 43.25361865 95.49577563 43.25361865 94.36914062 42.12698364 C94.00153331 39.79880401 93.66672482 37.46514514 93.36914062 35.12698364 C91.42007813 34.94135864 91.42007813 34.94135864 89.43164062 34.75198364 C87.21679687 34.54104614 87.21679687 34.54104614 85.36914062 34.12698364 C84.16643098 31.72156436 84.16597399 30.02331773 84.05273438 27.33792114 C84.01083984 26.39690552 83.96894531 25.45588989 83.92578125 24.48635864 C83.88646484 23.50151489 83.84714844 22.51667114 83.80664062 21.50198364 C83.76345703 20.50940552 83.72027344 19.51682739 83.67578125 18.49417114 C83.56952994 16.03858526 83.46749099 13.58289661 83.36914062 11.12698364 C80.72914063 11.12698364 78.08914062 11.12698364 75.36914062 11.12698364 C75.36490869 11.83212317 75.36067675 12.53726271 75.35631657 13.2637701 C75.25315113 30.39685807 75.14453485 47.52990272 75.02980137 64.66291714 C74.97445022 72.94820665 74.92096517 81.23350047 74.87182617 89.51882935 C74.82900745 96.73770675 74.7827354 103.9565522 74.73226207 111.17538029 C74.70564244 115.00004742 74.68078899 118.82470814 74.6600666 122.64941216 C74.64052965 126.24527256 74.61639491 129.84107205 74.58864975 133.4368782 C74.57476974 135.3940196 74.56583995 137.35119412 74.55702209 139.30836487 C74.54723328 140.46247864 74.53744446 141.61659241 74.52735901 142.80567932 C74.52090646 143.81504264 74.51445391 144.82440596 74.50780582 145.86435604 C74.36914062 148.12698364 74.36914062 148.12698364 73.36914062 149.12698364 C70.42378492 149.22808717 67.50236503 149.26667644 64.55664062 149.25979614 C63.67258545 149.26075287 62.78853027 149.26170959 61.87768555 149.26269531 C60.00471933 149.26337716 58.13175077 149.26152257 56.25878906 149.25735474 C53.38145675 149.25200654 50.50428055 149.25729958 47.62695312 149.26370239 C45.81184861 149.26304161 43.9967442 149.26176045 42.18164062 149.25979614 C41.31498779 149.26182037 40.44833496 149.2638446 39.55541992 149.26593018 C33.48409072 149.24193374 33.48409072 149.24193374 32.36914062 148.12698364 C32.26059081 146.35575478 32.22226618 144.58019505 32.21092224 142.80567932 C32.20113342 141.65156555 32.1913446 140.49745178 32.18125916 139.30836487 C32.17262596 137.39218102 32.17262596 137.39218102 32.16381836 135.43728638 C32.15424498 134.08739925 32.14423523 132.73751516 32.13381958 131.38763428 C32.1067058 127.71221021 32.08573142 124.03677322 32.06581759 120.36130404 C32.04399782 116.52422635 32.01658959 112.68718879 31.98976135 108.85014343 C31.93978008 101.57930057 31.89486149 94.3084355 31.85173899 87.03754908 C31.80241295 78.76196162 31.7474777 70.48641441 31.6920594 62.21086586 C31.57815596 45.1829423 31.47133523 28.15498141 31.36914062 11.12698364 C28.72914062 11.12698364 26.08914062 11.12698364 23.36914062 11.12698364 C23.34932129 11.75266235 23.32950195 12.37834106 23.30908203 13.02297974 C23.21399837 15.84974883 23.10425316 18.67576179 22.99414062 21.50198364 C22.94773437 22.97924927 22.94773437 22.97924927 22.90039062 24.48635864 C22.86171875 25.42737427 22.82304688 26.36838989 22.78320312 27.33792114 C22.75178223 28.20723267 22.72036133 29.07654419 22.68798828 29.97219849 C22.36914062 32.12698364 22.36914062 32.12698364 20.36914062 34.12698364 C18.04638886 34.52745809 15.71174705 34.86669404 13.36914062 35.12698364 C13.15257812 36.82854614 13.15257812 36.82854614 12.93164062 38.56448364 C12.36914062 42.12698364 12.36914062 42.12698364 11.36914062 43.12698364 C8.71091405 43.25356586 6.09026639 43.31218578 3.43164062 43.31448364 C2.68978516 43.32672974 1.94792969 43.33897583 1.18359375 43.35159302 C-0.75599567 43.35686842 -2.69509647 43.24887266 -4.63085938 43.12698364 C-6.63085938 41.12698364 -6.63085938 41.12698364 -6.85791016 37.22805786 C-6.85759279 35.54589572 -6.84625333 33.86371345 -6.82617188 32.18167114 C-6.82334198 31.29665924 -6.82051208 30.41164734 -6.81759644 29.49981689 C-6.80638178 26.66706952 -6.78127508 23.83463581 -6.75585938 21.00198364 C-6.74583123 19.08401945 -6.73670509 17.16605032 -6.72851562 15.24807739 C-6.70643827 10.54092488 -6.67189982 5.83400748 -6.63085938 1.12698364 C-4.21468346 -0.08110431 -2.69937241 0.00119595 0 0 Z " fill="#D7D7D7" transform="translate(74.630859375,54.873016357421875)"/>
                        <path d="M0 0 C1.51057124 1.32240795 3.01044818 2.65700381 4.50952148 3.99243164 C5.17725586 4.58668945 5.84499023 5.18094727 6.53295898 5.79321289 C27.25711073 25.39845504 40.93996498 56.0366966 42.45483398 84.41821289 C42.47288086 85.26770508 42.49092773 86.11719727 42.50952148 86.99243164 C42.5675293 88.56057617 42.5675293 88.56057617 42.62670898 90.16040039 C43.3377843 125.12160318 30.53936166 155.14047792 7.50952148 180.99243164 C6.91526367 181.66016602 6.32100586 182.32790039 5.70874023 183.01586914 C-15.76724381 205.7175297 -47.53822755 217.52794152 -78.22875977 219.19555664 C-113.51455092 219.65832111 -145.00725445 207.29599541 -170.54516602 182.92993164 C-194.78438671 159.12269706 -207.13914191 127.17552724 -207.74047852 93.42993164 C-207.10798994 60.01345203 -194.52924446 31.73186331 -172.49047852 6.99243164 C-171.8962207 6.32469727 -171.30196289 5.65696289 -170.68969727 4.96899414 C-125.71269525 -42.57493355 -47.93462091 -41.28110303 0 0 Z M-141.49047852 -7.00756836 C-142.46629883 -6.46616211 -143.44211914 -5.92475586 -144.44750977 -5.36694336 C-151.87389335 -0.98973301 -157.94994142 4.68765734 -164.10424805 10.6574707 C-165.22289691 11.7347465 -166.36666889 12.78589884 -167.51782227 13.82836914 C-180.19615671 25.58193095 -187.8398553 41.57547064 -193.30297852 57.67993164 C-193.59325928 58.53466064 -193.88354004 59.38938965 -194.18261719 60.27001953 C-197.80764889 71.4275013 -198.85330308 81.96466971 -198.80297852 93.67993164 C-198.80148804 94.34095886 -198.79999756 95.00198608 -198.79846191 95.68304443 C-198.75741429 105.81047444 -198.21542746 115.22020094 -195.49047852 124.99243164 C-195.21204102 126.02368164 -194.93360352 127.05493164 -194.64672852 128.11743164 C-185.65081563 157.89700533 -164.08264598 182.7158903 -137.05297852 197.46899414 C-119.7477825 206.45616174 -102.36527481 210.53201664 -82.92797852 210.55493164 C-81.60902588 210.55759033 -80.29007324 210.56024902 -78.93115234 210.56298828 C-47.80241734 210.02854739 -18.75910488 196.06082158 2.91308594 174.13256836 C14.28222111 162.07369259 22.35947599 147.73267905 27.69702148 132.11743164 C27.93525635 131.42278809 28.17349121 130.72814453 28.41894531 130.01245117 C32.37221437 117.87393228 34.09460758 106.06097828 34.00952148 93.30493164 C34.00809143 92.60754883 34.00666138 91.91016602 34.00518799 91.19165039 C33.94599155 79.48346519 32.48623977 69.03006939 28.50952148 57.99243164 C28.05644111 56.60263846 27.60591088 55.21201128 27.15795898 53.82055664 C22.38205507 39.5538355 14.59347059 27.13356896 4.50952148 15.99243164 C3.62780273 15.01661133 2.74608398 14.04079102 1.83764648 13.03540039 C-14.28755863 -4.2075305 -34.82433735 -14.31059758 -57.49047852 -20.00756836 C-58.12985352 -20.19085693 -58.76922852 -20.37414551 -59.42797852 -20.56298828 C-66.98481246 -22.54969853 -74.72570741 -22.53673491 -82.49047852 -22.57006836 C-83.61181183 -22.57550659 -83.61181183 -22.57550659 -84.75579834 -22.58105469 C-105.27143133 -22.57012264 -123.74860291 -17.31063201 -141.49047852 -7.00756836 Z " fill="#747475" transform="translate(210.490478515625,34.007568359375)"/>
                    </svg>
                    <h1 className="text-xl font-semibold leading-none flex items-center">Tunnelix</h1>
                </div>
                
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