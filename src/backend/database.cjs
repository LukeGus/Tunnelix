const http = require('http');
const socketIo = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Logger setup
const logger = {
    info: (...args) => console.log(`📦 | 🔧 [${new Date().toISOString()}] INFO:`, ...args),
    error: (...args) => console.error(`📦 | ❌ [${new Date().toISOString()}] ERROR:`, ...args),
    warn: (...args) => console.warn(`📦 | ⚠️ [${new Date().toISOString()}] WARN:`, ...args),
    debug: (...args) => console.debug(`📦 | 🔍 [${new Date().toISOString()}] DEBUG:`, ...args)
};

// Create data directory if it doesn't exist
const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Load or create app settings
const settingsFilePath = path.join(dataDir, 'settings.json');
let appSettings = {
    accountCreationEnabled: true
};

if (fs.existsSync(settingsFilePath)) {
    try {
        appSettings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
    } catch (error) {
        logger.error('Failed to parse settings file, using defaults', error);
    }
} else {
    fs.writeFileSync(settingsFilePath, JSON.stringify(appSettings, null, 2));
}

// Function to save settings to file
const saveSettings = () => {
    try {
        fs.writeFileSync(settingsFilePath, JSON.stringify(appSettings, null, 2))
    } catch (error) {
        logger.error('Failed to save settings file', error);
    }
};

// Connect to SQLite database
const dbPath = path.join(dataDir, 'tunnelix.db');
const db = new Database(dbPath);
logger.info(`Connected to SQLite database at ${dbPath}`);

// Create HTTP server and Socket.io
const server = http.createServer();
const io = socketIo(server, {
    path: '/database.io/socket.io',
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Initialize database with required tables
function initializeDatabase() {
    // Users table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            sessionToken TEXT NOT NULL,
            isAdmin INTEGER DEFAULT 0
        )
    `).run();
    
    // SSH Tunnels table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS tunnels (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            config TEXT NOT NULL,
            createdBy TEXT NOT NULL,
            folder TEXT,
            isPinned INTEGER DEFAULT 0,
            FOREIGN KEY (createdBy) REFERENCES users(id)
        )
    `).run();
    
    // Tunnel sharing (user access) table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS tunnel_users (
            tunnelId TEXT NOT NULL,
            userId TEXT NOT NULL,
            PRIMARY KEY (tunnelId, userId),
            FOREIGN KEY (tunnelId) REFERENCES tunnels(id),
            FOREIGN KEY (userId) REFERENCES users(id)
        )
    `).run();
    
    // Tunnel tags table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS tunnel_tags (
            tunnelId TEXT NOT NULL,
            tag TEXT NOT NULL,
            PRIMARY KEY (tunnelId, tag),
            FOREIGN KEY (tunnelId) REFERENCES tunnels(id)
        )
    `).run();

    // Check if isAdmin column exists in users table, add if not
    const userTableInfo = db.prepare(`PRAGMA table_info(users)`).all();
    const hasIsAdminColumn = userTableInfo.some(column => column.name === 'isAdmin');
    
    if (!hasIsAdminColumn) {
        db.prepare(`ALTER TABLE users ADD COLUMN isAdmin INTEGER DEFAULT 0`).run();
    }
    
    logger.info('Database tables initialized');
}

// Initialize the database
initializeDatabase();

// Encryption and decryption utils
const getEncryptionKey = (userId, sessionToken) => {
    const salt = process.env.SALT || 'default_salt';
    return crypto.scryptSync(`${userId}-${sessionToken}`, salt, 32);
};

const encryptData = (data, userId, sessionToken) => {
    try {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(userId, sessionToken), iv);
        const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
        return `${iv.toString('hex')}:${encrypted.toString('hex')}:${cipher.getAuthTag().toString('hex')}`;
    } catch (error) {
        logger.error('Encryption failed:', error);
        return null;
    }
};

const decryptData = (encryptedData, userId, sessionToken) => {
    try {
        const [ivHex, contentHex, authTagHex] = encryptedData.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const content = Buffer.from(contentHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');

        const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(userId, sessionToken), iv);
        decipher.setAuthTag(authTag);

        return JSON.parse(Buffer.concat([decipher.update(content), decipher.final()]).toString());
    } catch (error) {
        logger.error('Decryption failed:', error);
        return null;
    }
};

// Add decrypt function to SQLite
db.function('decrypt', (encryptedData, userId, sessionToken) => {
    try {
        return JSON.stringify(decryptData(encryptedData, userId, sessionToken));
    } catch (error) {
        logger.error('SQLite decrypt function failed:', error);
        return null;
    }
});

// Prepared SQL statements
const statements = {
    // User management statements
    findUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    findUserBySessionToken: db.prepare('SELECT * FROM users WHERE sessionToken = ?'),
    findUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
    findUserByIdAndSessionToken: db.prepare('SELECT * FROM users WHERE id = ? AND sessionToken = ?'),
    createUser: db.prepare('INSERT INTO users (id, username, password, sessionToken, isAdmin) VALUES (?, ?, ?, ?, ?)'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    countAdminUsers: db.prepare('SELECT COUNT(*) as count FROM users WHERE isAdmin = 1'),
    countAllUsers: db.prepare('SELECT COUNT(*) as count FROM users'),
    findAllAdmins: db.prepare('SELECT id, username FROM users WHERE isAdmin = 1'),
    updateUserAdmin: db.prepare('UPDATE users SET isAdmin = ? WHERE username = ?'),
    
    // Tunnel management statements
    createTunnel: db.prepare('INSERT INTO tunnels (id, name, config, createdBy, folder, isPinned) VALUES (?, ?, ?, ?, ?, ?)'),
    addTunnelUser: db.prepare('INSERT INTO tunnel_users (tunnelId, userId) VALUES (?, ?)'),
    addTunnelTag: db.prepare('INSERT INTO tunnel_tags (tunnelId, tag) VALUES (?, ?)'),
    findTunnelById: db.prepare('SELECT * FROM tunnels WHERE id = ?'),
    findTunnelByIdAndCreator: db.prepare('SELECT * FROM tunnels WHERE id = ? AND createdBy = ?'),
    findTunnelsByUser: db.prepare('SELECT t.* FROM tunnels t JOIN tunnel_users tu ON t.id = tu.tunnelId WHERE tu.userId = ?'),
    findTunnelsByCreator: db.prepare('SELECT * FROM tunnels WHERE createdBy = ?'),
    findSharedTunnelsWithUser: db.prepare('SELECT t.* FROM tunnels t JOIN tunnel_users tu ON t.id = tu.tunnelId WHERE tu.userId = ? AND t.createdBy != ?'),
    findTunnelsByName: db.prepare('SELECT * FROM tunnels WHERE createdBy = ? AND LOWER(name) = LOWER(?)'),
    findTunnelUsers: db.prepare('SELECT userId FROM tunnel_users WHERE tunnelId = ?'),
    findTunnelTags: db.prepare('SELECT tag FROM tunnel_tags WHERE tunnelId = ?'),
    updateTunnel: db.prepare('UPDATE tunnels SET name = ?, config = ?, folder = ?, isPinned = ? WHERE id = ?'),
    deleteTunnel: db.prepare('DELETE FROM tunnels WHERE id = ? AND createdBy = ?'),
    deleteTunnelUsers: db.prepare('DELETE FROM tunnel_users WHERE tunnelId = ?'),
    deleteTunnelTags: db.prepare('DELETE FROM tunnel_tags WHERE tunnelId = ?'),
    removeTunnelUser: db.prepare('DELETE FROM tunnel_users WHERE tunnelId = ? AND userId = ?'),
    checkTunnelSharing: db.prepare('SELECT * FROM tunnel_users WHERE tunnelId = ? AND userId = ?')
};

// Helper functions
function generateId() {
    return crypto.randomBytes(16).toString('hex');
}

function getTunnelWithDetails(tunnel, userId, sessionToken) {
    if (!tunnel) return null;
    
    // Get users who have access to this tunnel
    const userIds = statements.findTunnelUsers.all(tunnel.id).map(row => row.userId);
    
    // Get tunnel tags
    const tags = statements.findTunnelTags.all(tunnel.id).map(row => row.tag);
    
    // Get creator information
    const createdBy = statements.findUserById.get(tunnel.createdBy);
    if (!createdBy) return null;
    
    // Decrypt tunnel configuration
    const decryptedConfig = decryptData(tunnel.config, createdBy.id, createdBy.sessionToken);
    if (!decryptedConfig) return null;
    
    return {
        ...tunnel,
        users: userIds,
        tags,
        createdBy,
        config: decryptedConfig,
        isPinned: !!tunnel.isPinned
    };
}

logger.info('Database is ready');

// Socket.io event handlers
io.on('connection', (socket) => {
    // Create a new user
    socket.on('createUser', async ({ username, password, isAdmin }, callback) => {
        try {
            if (!appSettings.accountCreationEnabled) {
                const userCount = statements.countAllUsers.get().count;
                if (userCount > 0) {
                    return callback({ error: 'Account creation has been disabled by an administrator' });
                }
            }

            const existingUser = statements.findUserByUsername.get(username);
            if (existingUser) {
                return callback({ error: 'Username already exists' });
            }

            const sessionToken = crypto.randomBytes(64).toString('hex');
            const userId = generateId();
            const hashedPassword = await bcrypt.hash(password, 10);

            const adminCount = statements.countAdminUsers.get().count;
            const makeAdmin = adminCount === 0 || isAdmin === true ? 1 : 0;

            statements.createUser.run(userId, username, hashedPassword, sessionToken, makeAdmin);

            logger.info(`User created: ${username}${makeAdmin ? ' (admin)' : ''}`);
            callback({ success: true, user: {
                id: userId,
                username,
                sessionToken,
                isAdmin: makeAdmin === 1
            }});
        } catch (error) {
            logger.error('User creation error:', error);
            callback({ error: 'User creation failed' });
        }
    });

    // Login an existing user
    socket.on('loginUser', async ({ username, password, sessionToken }, callback) => {
        try {
            let user;
            if (sessionToken) {
                user = statements.findUserBySessionToken.get(sessionToken);
            } else {
                user = statements.findUserByUsername.get(username);
                if (!user || !(await bcrypt.compare(password, user.password))) {
                    return callback({ error: 'Invalid credentials' });
                }
            }

            if (!user) {
                return callback({ error: 'Invalid credentials' });
            }

            callback({ success: true, user: {
                id: user.id,
                username: user.username,
                sessionToken: user.sessionToken,
                isAdmin: !!user.isAdmin
            }});
        } catch (error) {
            logger.error('Login error:', error);
            callback({ error: 'Login failed' });
        }
    });

    // Create and login as a guest user
    socket.on('loginAsGuest', async (callback) => {
        try {
            // Check if guest accounts are allowed
            if (!appSettings.accountCreationEnabled) {
                const userCount = statements.countAllUsers.get().count;
                if (userCount > 0) {
                    return callback({ error: 'Guest login has been disabled by an administrator' });
                }
            }
            
            const username = `guest-${crypto.randomBytes(4).toString('hex')}`;
            const sessionToken = crypto.randomBytes(64).toString('hex');
            const userId = generateId();
            const hashedPassword = await bcrypt.hash(username, 10);

            statements.createUser.run(userId, username, hashedPassword, sessionToken, 0);

            callback({ success: true, user: {
                id: userId,
                username,
                sessionToken,
                isAdmin: false
            }});
        } catch (error) {
            logger.error('Guest login error:', error);
            callback({error: 'Guest login failed'});
        }
    });

    // Verify a user's session token
    socket.on('verifySession', async ({ sessionToken }, callback) => {
        try {
            const user = statements.findUserBySessionToken.get(sessionToken);
            if (!user) {
                return callback({ error: 'Invalid session' });
            }

            callback({ success: true, user: {
                id: user.id,
                username: user.username,
                isAdmin: !!user.isAdmin
            }});
        } catch (error) {
            logger.error('Session verification error:', error);
            callback({ error: 'Session verification failed' });
        }
    });

    // Check if account creation is enabled
    socket.on('checkAccountCreationStatus', async (callback) => {
        try {
            const userCount = statements.countAllUsers.get().count;
            const isFirstUser = userCount === 0;
            
            callback({ 
                allowed: isFirstUser || appSettings.accountCreationEnabled, 
                isFirstUser: isFirstUser 
            });
        } catch (error) {
            logger.error('Error checking account creation status:', error);
            callback({ allowed: true, isFirstUser: false });
        }
    });

    // Toggle account creation (admin only)
    socket.on('toggleAccountCreation', async ({ userId, sessionToken, enabled }, callback) => {
        try {
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user || !user.isAdmin) {
                return callback({ error: 'Not authorized' });
            }

            appSettings.accountCreationEnabled = !!enabled;
            saveSettings();
            
            callback({ success: true, enabled: appSettings.accountCreationEnabled });
        }
        catch (error) {
            logger.error('Error toggling account creation:', error);
            callback({ error: 'Failed to update account creation settings' });
        }
    });

    // Add admin privileges to a user (admin only)
    socket.on('addAdminUser', async ({ userId, sessionToken, targetUsername }, callback) => {
        try {
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user || !user.isAdmin) {
                return callback({ error: 'Not authorized. You must be an admin to perform this action.' });
            }

            const targetUser = statements.findUserByUsername.get(targetUsername);
            if (!targetUser) {
                return callback({ error: `User "${targetUsername}" does not exist.` });
            }
            
            if (targetUser.isAdmin) {
                return callback({ error: `User "${targetUsername}" is already an admin.` });
            }

            statements.updateUserAdmin.run(1, targetUsername);
            
            callback({ success: true });
        } catch (error) {
            logger.error('Error adding admin user:', error);
            callback({ error: 'Failed to add admin user due to a server error. Please try again.' });
        }
    });

    // Remove admin privileges from a user (admin only)
    socket.on('removeAdminUser', async ({ userId, sessionToken, targetUsername }, callback) => {
        try {
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user || !user.isAdmin) {
                return callback({ error: 'Not authorized. You must be an admin to perform this action.' });
            }

            // Don't allow removing the last admin
            const adminCount = statements.countAdminUsers.get().count;
            if (adminCount <= 1) {
                return callback({ error: 'Cannot remove the last admin user from the system.' });
            }

            const targetUser = statements.findUserByUsername.get(targetUsername);
            if (!targetUser) {
                return callback({ error: `User "${targetUsername}" does not exist.` });
            }
            
            if (!targetUser.isAdmin) {
                return callback({ error: `User "${targetUsername}" is not an admin.` });
            }

            // Don't allow removing your own admin privileges
            if (targetUser.id === userId) {
                return callback({ error: 'You cannot remove your own admin privileges.' });
            }

            statements.updateUserAdmin.run(0, targetUsername);
            
            callback({ success: true });
        } catch (error) {
            logger.error('Error removing admin user:', error);
            callback({ error: 'Failed to remove admin user due to a server error. Please try again.' });
        }
    });

    // Get all admin users (admin only)
    socket.on('getAllAdmins', async ({ userId, sessionToken }, callback) => {
        try {
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user || !user.isAdmin) {
                return callback({ error: 'Not authorized' });
            }

            const admins = statements.findAllAdmins.all();
            
            callback({ success: true, admins: admins });
        } catch (error) {
            logger.error('Error getting admin list:', error);
            callback({ error: 'Failed to get admin list' });
        }
    });

    // Get all users (admin only)
    socket.on('getAllUsers', async ({ userId, sessionToken }, callback) => {
        try {
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user || !user.isAdmin) {
                return callback({ error: 'Not authorized' });
            }

            const users = db.prepare('SELECT id, username, isAdmin FROM users').all();
            
            callback({ success: true, users: users });
        } catch (error) {
            logger.error('Error getting user list:', error);
            callback({ error: 'Failed to get user list' });
        }
    });

    // Delete a user and all their data
    socket.on('deleteUser', async ({ userId, sessionToken, targetUserId = null }, callback) => {
        try {
            const requestingUser = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!requestingUser) {
                return callback({ error: 'Invalid session' });
            }

            // Determine the user to delete
            const userToDeleteId = targetUserId || userId;
            
            // If trying to delete another user, check admin privileges
            if (targetUserId && targetUserId !== userId) {
                if (!requestingUser.isAdmin) {
                    return callback({ error: 'Not authorized to delete other users' });
                }
                
                // Don't allow deleting the last admin
                const userToDelete = statements.findUserById.get(targetUserId);
                if (userToDelete && userToDelete.isAdmin) {
                    const adminCount = statements.countAdminUsers.get().count;
                    if (adminCount <= 1) {
                        return callback({ error: 'Cannot delete the last admin user from the system.' });
                    }
                }
            }

            // Transaction to delete user and all related data
            const db_transaction = db.transaction(() => {
                // Find and delete all tunnels created by this user
                const tunnels = statements.findTunnelsByCreator.all(userToDeleteId);
                
                for (const tunnel of tunnels) {
                    statements.deleteTunnelTags.run(tunnel.id);
                    statements.deleteTunnelUsers.run(tunnel.id);
                    statements.deleteTunnel.run(tunnel.id, userToDeleteId);
                }
                
                // Remove user access from shared tunnels
                const sharedTunnels = statements.findTunnelsByUser.all(userToDeleteId);
                for (const tunnel of sharedTunnels) {
                    statements.removeTunnelUser.run(tunnel.id, userToDeleteId);
                }
                
                // Delete the user
                statements.deleteUser.run(userToDeleteId);
                
                return true;
            });
            
            db_transaction();
            
            const actionDescription = targetUserId && targetUserId !== userId
                ? `User ${statements.findUserById.get(targetUserId)?.username} deleted by admin ${requestingUser.username}`
                : `User ${requestingUser.username} deleted their own account`;
                
            logger.info(actionDescription);
            callback({ success: true });
        } catch (error) {
            logger.error('User deletion error:', error);
            callback({ error: 'Failed to delete user' });
        }
    });

    // Save a new SSH tunnel configuration
    socket.on('saveTunnel', async ({ userId, sessionToken, tunnelConfig }, callback) => {
        try {
            if (!tunnelConfig) {
                return callback({ error: 'Missing tunnel configuration' });
            }

            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                return callback({ error: 'Invalid session' });
            }

            // Clean and validate tunnel config
            const cleanConfig = {
                name: (tunnelConfig.name?.trim()) || '',
                sourceIp: (tunnelConfig.sourceIp?.trim()) || '',
                sourceUser: (tunnelConfig.sourceUser?.trim()) || '',
                sourcePassword: (tunnelConfig.sourcePassword?.trim()) || '',
                sourceSSHPort: tunnelConfig.sourceSSHPort || 22,
                sourcePort: tunnelConfig.sourcePort || 22,
                endPointIp: (tunnelConfig.endPointIp?.trim()) || '',
                endPointUser: (tunnelConfig.endPointUser?.trim()) || '',
                endPointPassword: (tunnelConfig.endPointPassword?.trim()) || '',
                endPointSSHPort: tunnelConfig.endPointSSHPort || 22,
                endPointPort: tunnelConfig.endPointPort || 0,
                retryConfig: tunnelConfig.retryConfig || {
                    maxRetries: 3,
                    retryInterval: 5000
                },
                refreshInterval: tunnelConfig.refreshInterval || 10000,
                tags: Array.isArray(tunnelConfig.tags) ? tunnelConfig.tags : [],
                folder: (tunnelConfig.folder?.trim()) || null,
                isPinned: !!tunnelConfig.isPinned
            };

            // Basic validation
            if (!cleanConfig.sourceIp || !cleanConfig.sourceUser || 
                !cleanConfig.endPointIp || !cleanConfig.endPointUser) {
                return callback({ error: 'Source and Endpoint information are required' });
            }

            const finalName = cleanConfig.name || `${cleanConfig.sourceIp}->${cleanConfig.endPointIp}:${cleanConfig.endPointPort}`;

            const db_transaction = db.transaction(() => {
                // Check for duplicate names
                if (finalName.trim() !== '') {
                    try {
                        const existingTunnelByName = statements.findTunnelsByName.get(userId, finalName);
                        if (existingTunnelByName) {
                            throw new Error(`Tunnel with name "${finalName}" already exists. Please choose a different name.`);
                        }
                    } catch (error) {
                        if (error.message.includes('already exists')) {
                            throw error;
                        }
                    }
                }

                // Encrypt tunnel configuration
                const encryptedConfig = encryptData(cleanConfig, userId, sessionToken);
                if (!encryptedConfig) {
                    throw new Error('Configuration encryption failed');
                }

                // Save tunnel to database
                const tunnelId = generateId();
                statements.createTunnel.run(
                    tunnelId,
                    finalName,
                    encryptedConfig,
                    userId,
                    cleanConfig.folder,
                    cleanConfig.isPinned ? 1 : 0
                );

                // Associate tunnel with user
                statements.addTunnelUser.run(tunnelId, userId);

                // Save tags if any
                if (Array.isArray(cleanConfig.tags)) {
                    cleanConfig.tags.forEach(tag => {
                        statements.addTunnelTag.run(tunnelId, tag);
                    });
                }
                
                return tunnelId;
            });

            const tunnelId = db_transaction();
            logger.info(`Tunnel "${finalName}" saved for user: ${user.username}`);
            callback({ success: true, tunnelId });
        } catch (err) {
            logger.error('Error saving tunnel config:', err);
            callback({ error: err.message || 'Failed to save tunnel' });
        }
    });

    // Get all tunnels for a user
    socket.on('getTunnels', async ({ userId, sessionToken }, callback) => {
        try {
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                return callback({ error: 'Invalid session' });
            }

            // Get tunnels created by the user
            const createdTunnels = statements.findTunnelsByCreator.all(userId);
            
            // Get tunnels shared with the user
            const sharedTunnels = statements.findSharedTunnelsWithUser.all(userId, userId);
            
            // Combined list of tunnels
            const tunnels = [...createdTunnels, ...sharedTunnels];
            
            // Process each tunnel to get details
            const detailedTunnels = [];
            for (const tunnel of tunnels) {
                try {
                    // Get creator information
                    const createdBy = statements.findUserById.get(tunnel.createdBy);
                    if (!createdBy) {
                        continue;
                    }

                    // Get users with access to this tunnel
                    const userIds = statements.findTunnelUsers.all(tunnel.id).map(row => row.userId);
                    
                    // Get tunnel tags
                    const tags = statements.findTunnelTags.all(tunnel.id).map(row => row.tag);
                    
                    // Decrypt tunnel configuration
                    let decryptedConfig;
                    if (tunnel.createdBy === userId) {
                        // If user is the owner, use their session token
                        decryptedConfig = decryptData(tunnel.config, userId, sessionToken);
                    } else {
                        // If shared, use the creator's session token
                        decryptedConfig = decryptData(tunnel.config, createdBy.id, createdBy.sessionToken);
                    }
                    
                    if (!decryptedConfig) {
                        continue;
                    }

                    // Add tunnel to the results
                    detailedTunnels.push({
                        id: tunnel.id,
                        name: tunnel.name,
                        folder: tunnel.folder,
                        isPinned: !!tunnel.isPinned,
                        tags,
                        users: userIds,
                        createdBy: {
                            id: createdBy.id,
                            username: createdBy.username
                        },
                        config: decryptedConfig,
                        isOwner: tunnel.createdBy === userId
                    });
                } catch (error) {
                    logger.error(`Failed to process tunnel ${tunnel.id}:`, error);
                }
            }

            callback({ success: true, tunnels: detailedTunnels });
        } catch (error) {
            logger.error('Get tunnels error:', error);
            callback({ error: 'Failed to fetch tunnels' });
        }
    });

    // Edit an existing SSH tunnel
    socket.on('editTunnel', async ({ userId, sessionToken, tunnelId, tunnelConfig }, callback) => {
        try {
            if (!tunnelId || !tunnelConfig) {
                return callback({ error: 'Missing tunnel ID or configuration' });
            }

            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                return callback({ error: 'Invalid session' });
            }

            // Check if tunnel exists and user has permission to edit it
            const tunnel = statements.findTunnelById.get(tunnelId);
            if (!tunnel) {
                return callback({ error: 'Tunnel not found' });
            }

            // Only the creator can edit the tunnel
            if (tunnel.createdBy !== userId) {
                return callback({ error: 'You do not have permission to edit this tunnel' });
            }

            // Clean and validate tunnel config
            const cleanConfig = {
                name: (tunnelConfig.name?.trim()) || tunnel.name,
                sourceIp: (tunnelConfig.sourceIp?.trim()) || '',
                sourceUser: (tunnelConfig.sourceUser?.trim()) || '',
                sourcePassword: (tunnelConfig.sourcePassword?.trim()) || '',
                sourceSSHPort: tunnelConfig.sourceSSHPort || 22,
                sourcePort: tunnelConfig.sourcePort || 22,
                endPointIp: (tunnelConfig.endPointIp?.trim()) || '',
                endPointUser: (tunnelConfig.endPointUser?.trim()) || '',
                endPointPassword: (tunnelConfig.endPointPassword?.trim()) || '',
                endPointSSHPort: tunnelConfig.endPointSSHPort || 22,
                endPointPort: tunnelConfig.endPointPort || 0,
                retryConfig: tunnelConfig.retryConfig || {
                    maxRetries: 3,
                    retryInterval: 5000
                },
                refreshInterval: tunnelConfig.refreshInterval || 10000,
                tags: Array.isArray(tunnelConfig.tags) ? tunnelConfig.tags : [],
                folder: (tunnelConfig.folder?.trim()) || tunnel.folder || null,
                isPinned: tunnelConfig.isPinned !== undefined ? !!tunnelConfig.isPinned : !!tunnel.isPinned
            };

            // Basic validation
            if (!cleanConfig.sourceIp || !cleanConfig.sourceUser || 
                !cleanConfig.endPointIp || !cleanConfig.endPointUser) {
                return callback({ error: 'Source and Endpoint information are required' });
            }

            const finalName = cleanConfig.name;

            const db_transaction = db.transaction(() => {
                // Check for duplicate names only if name has changed
                if (finalName !== tunnel.name) {
                    try {
                        const existingTunnelByName = statements.findTunnelsByName.get(userId, finalName);
                        if (existingTunnelByName && existingTunnelByName.id !== tunnelId) {
                            throw new Error(`Tunnel with name "${finalName}" already exists. Please choose a different name.`);
                        }
                    } catch (error) {
                        if (error.message.includes('already exists')) {
                            throw error;
                        }
                    }
                }

                // Encrypt tunnel configuration
                const encryptedConfig = encryptData(cleanConfig, userId, sessionToken);
                if (!encryptedConfig) {
                    throw new Error('Configuration encryption failed');
                }

                // Update tunnel in database
                statements.updateTunnel.run(
                    finalName,
                    encryptedConfig,
                    cleanConfig.folder,
                    cleanConfig.isPinned ? 1 : 0,
                    tunnelId
                );

                // Update tags
                statements.deleteTunnelTags.run(tunnelId);
                if (Array.isArray(cleanConfig.tags)) {
                    cleanConfig.tags.forEach(tag => {
                        statements.addTunnelTag.run(tunnelId, tag);
                    });
                }
                
                return tunnelId;
            });

            const updatedTunnelId = db_transaction();
            logger.info(`Tunnel "${finalName}" updated for user: ${user.username}`);
            callback({ success: true, tunnelId: updatedTunnelId });
        } catch (err) {
            logger.error('Error updating tunnel:', err);
            callback({ error: err.message || 'Failed to update tunnel' });
        }
    });

    // Share a tunnel with another user
    socket.on('shareTunnel', async ({ userId, sessionToken, tunnelId, targetUsername }, callback) => {
        try {
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                return callback({ error: 'Invalid session' });
            }

            // Check if target user exists
            const targetUser = statements.findUserByUsername.get(targetUsername);
            if (!targetUser) {
                return callback({ error: 'User not found' });
            }

            // Check if tunnel exists and user has permission to share it
            const tunnel = statements.findTunnelByIdAndCreator.get(tunnelId, userId);
            if (!tunnel) {
                return callback({ error: 'Tunnel not found or unauthorized' });
            }

            // Check if already shared with this user
            const tunnelUsers = statements.findTunnelUsers.all(tunnelId).map(row => row.userId);
            if (tunnelUsers.includes(targetUser.id)) {
                return callback({ error: 'Tunnel already shared with this user' });
            }

            // Share the tunnel
            statements.addTunnelUser.run(tunnelId, targetUser.id);

            callback({ success: true });
        } catch (error) {
            logger.error('Tunnel sharing error:', error);
            callback({ error: 'Failed to share tunnel' });
        }
    });

    // Remove tunnel sharing
    socket.on('removeTunnelShare', async ({ userId, sessionToken, tunnelId, targetUserId }, callback) => {
        try {
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                return callback({ error: 'Invalid session' });
            }

            // Check if tunnel exists
            const tunnel = statements.findTunnelById.get(tunnelId);
            if (!tunnel) {
                return callback({ error: 'Tunnel not found' });
            }

            // Determine which user is being removed
            const userIdToRemove = targetUserId || userId;
            
            // If removing someone else, make sure requestor is the owner
            if (targetUserId && tunnel.createdBy !== userId) {
                return callback({ error: 'You do not have permission to remove this share' });
            }

            // Remove the share
            statements.removeTunnelUser.run(tunnelId, userIdToRemove);

            callback({ success: true });
        } catch (error) {
            logger.error('Share removal error:', error);
            callback({ error: 'Failed to remove share' });
        }
    });

    // Delete a tunnel
    socket.on('deleteTunnel', async ({ userId, sessionToken, tunnelId }, callback) => {
        try {
            if (!userId || !sessionToken) {
                return callback({ error: 'Authentication required' });
            }

            if (!tunnelId) {
                return callback({ error: 'Tunnel ID is required' });
            }

            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                return callback({ error: 'Invalid session' });
            }

            const db_transaction = db.transaction(() => {
                const tunnel = statements.findTunnelById.get(tunnelId);
                if (!tunnel) {
                    throw new Error('Tunnel not found');
                }

                if (tunnel.createdBy === userId) {
                    // Owner is deleting the tunnel - remove it completely
                    statements.deleteTunnelTags.run(tunnelId);
                    statements.deleteTunnelUsers.run(tunnelId);
                    statements.deleteTunnel.run(tunnelId, userId);
                } else {
                    // Non-owner is removing themselves from the tunnel
                    statements.removeTunnelUser.run(tunnelId, userId);
                }
                
                return true;
            });
            
            try {
                db_transaction();
                logger.info(`Tunnel ${tunnelId} processed successfully for user ${userId}`);
                callback({ success: true });
            } catch (error) {
                return callback({ error: error.message });
            }
        } catch (error) {
            logger.error('Tunnel deletion error:', error);
            callback({ error: `Tunnel deletion failed: ${error.message}` });
        }
    });
    
    // Handle socket disconnection
    socket.on('disconnect', () => {
        // No logging here to reduce spam
    });
});

// Start the server
server.listen(8081, () => {
    logger.info('Tunnelix database server running on port 8081');
});

module.exports = { server }; 