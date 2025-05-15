const http = require('http');
const socketIo = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const logger = {
    info: (...args) => console.log(`📦 | 🔧 [${new Date().toISOString()}] INFO:`, ...args),
    error: (...args) => console.error(`📦 | ❌ [${new Date().toISOString()}] ERROR:`, ...args),
    warn: (...args) => console.warn(`📦 | ⚠️ [${new Date().toISOString()}] WARN:`, ...args),
    debug: (...args) => console.debug(`📦 | 🔍 [${new Date().toISOString()}] DEBUG:`, ...args)
};

const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

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

const saveSettings = () => {
    try {
        fs.writeFileSync(settingsFilePath, JSON.stringify(appSettings, null, 2))
    } catch (error) {
        logger.error('Failed to save settings file', error);
    }
};

const dbPath = path.join(dataDir, 'tunnelix.db');
const db = new Database(dbPath);
logger.info(`Connected to SQLite database at ${dbPath}`);

const server = http.createServer();
const io = socketIo(server, {
    path: '/database.io/socket.io',
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

function initializeDatabase() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            sessionToken TEXT NOT NULL,
            isAdmin INTEGER DEFAULT 0
        )
    `).run();
    
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
    
    db.prepare(`
        CREATE TABLE IF NOT EXISTS tunnel_users (
            tunnelId TEXT NOT NULL,
            userId TEXT NOT NULL,
            PRIMARY KEY (tunnelId, userId),
            FOREIGN KEY (tunnelId) REFERENCES tunnels(id),
            FOREIGN KEY (userId) REFERENCES users(id)
        )
    `).run();
    
    db.prepare(`
        CREATE TABLE IF NOT EXISTS tunnel_tags (
            tunnelId TEXT NOT NULL,
            tag TEXT NOT NULL,
            PRIMARY KEY (tunnelId, tag),
            FOREIGN KEY (tunnelId) REFERENCES tunnels(id)
        )
    `).run();
    
    db.prepare(`
        CREATE TABLE IF NOT EXISTS ssh_keys (
            id TEXT PRIMARY KEY,
            tunnelId TEXT NOT NULL,
            keyType TEXT NOT NULL,
            keyData BLOB NOT NULL,
            forConnection TEXT NOT NULL,
            FOREIGN KEY (tunnelId) REFERENCES tunnels(id)
        )
    `).run();

    const userTableInfo = db.prepare(`PRAGMA table_info(users)`).all();
    const hasIsAdminColumn = userTableInfo.some(column => column.name === 'isAdmin');
    
    if (!hasIsAdminColumn) {
        db.prepare(`ALTER TABLE users ADD COLUMN isAdmin INTEGER DEFAULT 0`).run();
    }
    
    logger.info('Database tables initialized');
}

initializeDatabase();

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

db.function('decrypt', (encryptedData, userId, sessionToken) => {
    try {
        return JSON.stringify(decryptData(encryptedData, userId, sessionToken));
    } catch (error) {
        logger.error('SQLite decrypt function failed:', error);
        return null;
    }
});

const statements = {
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
    checkTunnelSharing: db.prepare('SELECT * FROM tunnel_users WHERE tunnelId = ? AND userId = ?'),
    
    saveSourceSSHKey: db.prepare('INSERT INTO ssh_keys (id, tunnelId, keyType, keyData, forConnection) VALUES (?, ?, ?, ?, \'source\')'),
    saveEndpointSSHKey: db.prepare('INSERT INTO ssh_keys (id, tunnelId, keyType, keyData, forConnection) VALUES (?, ?, ?, ?, \'endpoint\')'),
    getSourceSSHKey: db.prepare('SELECT * FROM ssh_keys WHERE tunnelId = ? AND forConnection = \'source\''),
    getEndpointSSHKey: db.prepare('SELECT * FROM ssh_keys WHERE tunnelId = ? AND forConnection = \'endpoint\''),
    updateSourceSSHKey: db.prepare('UPDATE ssh_keys SET keyType = ?, keyData = ? WHERE tunnelId = ? AND forConnection = \'source\''),
    updateEndpointSSHKey: db.prepare('UPDATE ssh_keys SET keyType = ?, keyData = ? WHERE tunnelId = ? AND forConnection = \'endpoint\''),
    deleteSSHKeys: db.prepare('DELETE FROM ssh_keys WHERE tunnelId = ?'),
    checkSourceSSHKey: db.prepare('SELECT COUNT(*) as count FROM ssh_keys WHERE tunnelId = ? AND forConnection = \'source\''),
    checkEndpointSSHKey: db.prepare('SELECT COUNT(*) as count FROM ssh_keys WHERE tunnelId = ? AND forConnection = \'endpoint\'')
};

function generateId() {
    return crypto.randomBytes(16).toString('hex');
}

function getTunnelWithDetails(tunnel, userId, sessionToken) {
    if (!tunnel) return null;
    
    const userIds = statements.findTunnelUsers.all(tunnel.id).map(row => row.userId);
    
    const tags = statements.findTunnelTags.all(tunnel.id).map(row => row.tag);
    
    const createdBy = statements.findUserById.get(tunnel.createdBy);
    if (!createdBy) return null;
    
    const decryptedConfig = decryptData(tunnel.config, createdBy.id, createdBy.sessionToken);
    if (!decryptedConfig) return null;
    
    const sourceSSHKey = statements.getSourceSSHKey.get(tunnel.id);
    const endpointSSHKey = statements.getEndpointSSHKey.get(tunnel.id);
    
    if (sourceSSHKey) {
        decryptedConfig.sourceAuthType = "key";
        decryptedConfig.sourceKeyType = sourceSSHKey.keyType;
        decryptedConfig.hasSourceKey = true;
        
        if (tunnel.createdBy === userId) {
            decryptedConfig.sourceKey = sourceSSHKey.keyData;
        }
    } else {
        decryptedConfig.sourceAuthType = "password";
        decryptedConfig.hasSourceKey = false;
    }
    
    if (endpointSSHKey) {
        decryptedConfig.endPointAuthType = "key";
        decryptedConfig.endPointKeyType = endpointSSHKey.keyType;
        decryptedConfig.hasEndPointKey = true;
        
        if (tunnel.createdBy === userId) {
            decryptedConfig.endPointKey = endpointSSHKey.keyData;
        }
    } else {
        decryptedConfig.endPointAuthType = "password";
        decryptedConfig.hasEndPointKey = false;
    }
    
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

io.on('connection', (socket) => {
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

    socket.on('loginAsGuest', async (callback) => {
        try {
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

    socket.on('removeAdminUser', async ({ userId, sessionToken, targetUsername }, callback) => {
        try {
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user || !user.isAdmin) {
                return callback({ error: 'Not authorized. You must be an admin to perform this action.' });
            }

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

    socket.on('deleteUser', async ({ userId, sessionToken, targetUserId = null }, callback) => {
        try {
            const requestingUser = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!requestingUser) {
                return callback({ error: 'Invalid session' });
            }

            const userToDeleteId = targetUserId || userId;
            
            if (targetUserId && targetUserId !== userId) {
                if (!requestingUser.isAdmin) {
                    return callback({ error: 'Not authorized to delete other users' });
                }
                
                const userToDelete = statements.findUserById.get(targetUserId);
                if (userToDelete && userToDelete.isAdmin) {
                    const adminCount = statements.countAdminUsers.get().count;
                    if (adminCount <= 1) {
                        return callback({ error: 'Cannot delete the last admin user from the system.' });
                    }
                }
            }

            const db_transaction = db.transaction(() => {
                const tunnels = statements.findTunnelsByCreator.all(userToDeleteId);
                
                for (const tunnel of tunnels) {
                    statements.deleteTunnelTags.run(tunnel.id);
                    statements.deleteTunnelUsers.run(tunnel.id);
                    statements.deleteTunnel.run(tunnel.id, userToDeleteId);
                }
                
                const sharedTunnels = statements.findTunnelsByUser.all(userToDeleteId);
                for (const tunnel of sharedTunnels) {
                    statements.removeTunnelUser.run(tunnel.id, userToDeleteId);
                }
                
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

    socket.on('saveTunnel', async ({ userId, sessionToken, tunnelConfig }, callback) => {
        try {
            if (!tunnelConfig) {
                return callback({ error: 'Missing tunnel configuration' });
            }

            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                return callback({ error: 'Invalid session' });
            }

            const sourceAuthType = tunnelConfig.sourceAuthType || "password";
            const endPointAuthType = tunnelConfig.endPointAuthType || "password";
            
            const sourceKeyMissingButRequired = sourceAuthType === "key" && !tunnelConfig.sourceKey;
            const endPointKeyMissingButRequired = endPointAuthType === "key" && !tunnelConfig.endPointKey;
            
            if (sourceKeyMissingButRequired || endPointKeyMissingButRequired) {
                return callback({ error: 'SSH key is required when using key authentication' });
            }
            
            const cleanConfig = {
                name: (tunnelConfig.name?.trim()) || '',
                sourceIp: (tunnelConfig.sourceIp?.trim()) || '',
                sourceUser: (tunnelConfig.sourceUser?.trim()) || '',
                sourceAuthType: sourceAuthType,
                sourcePassword: sourceAuthType === "password" ? (tunnelConfig.sourcePassword?.trim()) || '' : '',
                sourceSSHPort: tunnelConfig.sourceSSHPort || 22,
                sourcePort: tunnelConfig.sourcePort || 22,
                endPointIp: (tunnelConfig.endPointIp?.trim()) || '',
                endPointUser: (tunnelConfig.endPointUser?.trim()) || '',
                endPointAuthType: endPointAuthType,
                endPointPassword: endPointAuthType === "password" ? (tunnelConfig.endPointPassword?.trim()) || '' : '',
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

            if (!cleanConfig.sourceIp || !cleanConfig.sourceUser || 
                !cleanConfig.endPointIp || !cleanConfig.endPointUser) {
                return callback({ error: 'Source and Endpoint information are required' });
            }

            const finalName = cleanConfig.name || `${cleanConfig.sourceIp}->${cleanConfig.endPointIp}:${cleanConfig.endPointPort}`;

            const db_transaction = db.transaction(() => {
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

                const encryptedConfig = encryptData(cleanConfig, userId, sessionToken);
                if (!encryptedConfig) {
                    throw new Error('Configuration encryption failed');
                }

                const tunnelId = generateId();
                statements.createTunnel.run(
                    tunnelId,
                    finalName,
                    encryptedConfig,
                    userId,
                    cleanConfig.folder,
                    cleanConfig.isPinned ? 1 : 0
                );

                statements.addTunnelUser.run(tunnelId, userId);

                if (Array.isArray(cleanConfig.tags)) {
                    cleanConfig.tags.forEach(tag => {
                        statements.addTunnelTag.run(tunnelId, tag);
                    });
                }
                
                if (sourceAuthType === "key" && tunnelConfig.sourceKey) {
                    const keyId = generateId();
                    statements.saveSourceSSHKey.run(
                        keyId,
                        tunnelId,
                        tunnelConfig.sourceKeyType || "rsa",
                        tunnelConfig.sourceKey
                    );
                }
                
                if (endPointAuthType === "key" && tunnelConfig.endPointKey) {
                    const keyId = generateId();
                    statements.saveEndpointSSHKey.run(
                        keyId,
                        tunnelId,
                        tunnelConfig.endPointKeyType || "rsa",
                        tunnelConfig.endPointKey
                    );
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

    socket.on('getTunnels', async ({ userId, sessionToken }, callback) => {
        try {
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                return callback({ error: 'Invalid session' });
            }

            const createdTunnels = statements.findTunnelsByCreator.all(userId);
            
            const sharedTunnels = statements.findSharedTunnelsWithUser.all(userId, userId);
            
            const tunnels = [...createdTunnels, ...sharedTunnels];
            
            const detailedTunnels = [];
            for (const tunnel of tunnels) {
                try {
                    const createdBy = statements.findUserById.get(tunnel.createdBy);
                    if (!createdBy) {
                        continue;
                    }

                    const userIds = statements.findTunnelUsers.all(tunnel.id).map(row => row.userId);
                    
                    const tags = statements.findTunnelTags.all(tunnel.id).map(row => row.tag);
                    
                    let decryptedConfig;
                    if (tunnel.createdBy === userId) {
                        decryptedConfig = decryptData(tunnel.config, userId, sessionToken);
                    } else {
                        decryptedConfig = decryptData(tunnel.config, createdBy.id, createdBy.sessionToken);
                    }
                    
                    if (!decryptedConfig) {
                        continue;
                    }
                    
                    const sourceSSHKey = statements.getSourceSSHKey.get(tunnel.id);
                    const endpointSSHKey = statements.getEndpointSSHKey.get(tunnel.id);
                    
                    if (sourceSSHKey) {
                        decryptedConfig.sourceAuthType = "key";
                        decryptedConfig.sourceKeyType = sourceSSHKey.keyType;
                        decryptedConfig.hasSourceKey = true;
                        
                        if (tunnel.createdBy === userId) {
                            decryptedConfig.sourceKey = sourceSSHKey.keyData;
                        }
                    } else {
                        decryptedConfig.sourceAuthType = "password";
                        decryptedConfig.hasSourceKey = false;
                    }
                    
                    if (endpointSSHKey) {
                        decryptedConfig.endPointAuthType = "key";
                        decryptedConfig.endPointKeyType = endpointSSHKey.keyType;
                        decryptedConfig.hasEndPointKey = true;
                        
                        if (tunnel.createdBy === userId) {
                            decryptedConfig.endPointKey = endpointSSHKey.keyData;
                        }
                    } else {
                        decryptedConfig.endPointAuthType = "password";
                        decryptedConfig.hasEndPointKey = false;
                    }

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

    socket.on('editTunnel', async ({ userId, sessionToken, tunnelId, tunnelConfig }, callback) => {
        try {
            if (!tunnelId || !tunnelConfig) {
                return callback({ error: 'Missing tunnel ID or configuration' });
            }

            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                return callback({ error: 'Invalid session' });
            }

            const tunnel = statements.findTunnelById.get(tunnelId);
            if (!tunnel) {
                return callback({ error: 'Tunnel not found' });
            }

            if (tunnel.createdBy !== userId) {
                return callback({ error: 'You do not have permission to edit this tunnel' });
            }

            const sourceAuthType = tunnelConfig.sourceAuthType || "password";
            const endPointAuthType = tunnelConfig.endPointAuthType || "password";
            
            const sourceKeyUpdated = sourceAuthType === "key" && tunnelConfig.sourceKey;
            const endPointKeyUpdated = endPointAuthType === "key" && tunnelConfig.endPointKey;
            
            const cleanConfig = {
                name: (tunnelConfig.name?.trim()) || tunnel.name,
                sourceIp: (tunnelConfig.sourceIp?.trim()) || '',
                sourceUser: (tunnelConfig.sourceUser?.trim()) || '',
                sourceAuthType: sourceAuthType,
                sourcePassword: sourceAuthType === "password" ? (tunnelConfig.sourcePassword?.trim()) || '' : '',
                sourceSSHPort: tunnelConfig.sourceSSHPort || 22,
                sourcePort: tunnelConfig.sourcePort || 22,
                endPointIp: (tunnelConfig.endPointIp?.trim()) || '',
                endPointUser: (tunnelConfig.endPointUser?.trim()) || '',
                endPointAuthType: endPointAuthType,
                endPointPassword: endPointAuthType === "password" ? (tunnelConfig.endPointPassword?.trim()) || '' : '',
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

            if (!cleanConfig.sourceIp || !cleanConfig.sourceUser || 
                !cleanConfig.endPointIp || !cleanConfig.endPointUser) {
                return callback({ error: 'Source and Endpoint information are required' });
            }

            const finalName = cleanConfig.name;

            const db_transaction = db.transaction(() => {
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

                const encryptedConfig = encryptData(cleanConfig, userId, sessionToken);
                if (!encryptedConfig) {
                    throw new Error('Configuration encryption failed');
                }

                statements.updateTunnel.run(
                    finalName,
                    encryptedConfig,
                    cleanConfig.folder,
                    cleanConfig.isPinned ? 1 : 0,
                    tunnelId
                );

                statements.deleteTunnelTags.run(tunnelId);
                if (Array.isArray(cleanConfig.tags)) {
                    cleanConfig.tags.forEach(tag => {
                        statements.addTunnelTag.run(tunnelId, tag);
                    });
                }
                
                const hasSourceKey = statements.checkSourceSSHKey.get(tunnelId).count > 0;
                
                if (sourceAuthType === "key") {
                    if (sourceKeyUpdated) {
                        if (hasSourceKey) {
                            statements.updateSourceSSHKey.run(
                                tunnelConfig.sourceKeyType || "rsa",
                                tunnelConfig.sourceKey,
                                tunnelId
                            );
                        } else {
                            const keyId = generateId();
                            statements.saveSourceSSHKey.run(
                                keyId,
                                tunnelId,
                                tunnelConfig.sourceKeyType || "rsa",
                                tunnelConfig.sourceKey
                            );
                        }
                    }
                } else if (hasSourceKey) {
                    statements.deleteSSHKeys.run(tunnelId);
                }
                
                const hasEndpointKey = statements.checkEndpointSSHKey.get(tunnelId).count > 0;
                
                if (endPointAuthType === "key") {
                    if (endPointKeyUpdated) {
                        if (hasEndpointKey) {
                            statements.updateEndpointSSHKey.run(
                                tunnelConfig.endPointKeyType || "rsa",
                                tunnelConfig.endPointKey,
                                tunnelId
                            );
                        } else {
                            const keyId = generateId();
                            statements.saveEndpointSSHKey.run(
                                keyId,
                                tunnelId,
                                tunnelConfig.endPointKeyType || "rsa",
                                tunnelConfig.endPointKey
                            );
                        }
                    }
                } else if (hasEndpointKey) {
                    statements.deleteSSHKeys.run(tunnelId);
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

    socket.on('shareTunnel', async ({ userId, sessionToken, tunnelId, targetUsername }, callback) => {
        try {
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                return callback({ error: 'Invalid session' });
            }

            const targetUser = statements.findUserByUsername.get(targetUsername);
            if (!targetUser) {
                return callback({ error: 'User not found' });
            }

            const tunnel = statements.findTunnelByIdAndCreator.get(tunnelId, userId);
            if (!tunnel) {
                return callback({ error: 'Tunnel not found or unauthorized' });
            }

            const tunnelUsers = statements.findTunnelUsers.all(tunnelId).map(row => row.userId);
            if (tunnelUsers.includes(targetUser.id)) {
                return callback({ error: 'Tunnel already shared with this user' });
            }

            statements.addTunnelUser.run(tunnelId, targetUser.id);

            callback({ success: true });
        } catch (error) {
            logger.error('Tunnel sharing error:', error);
            callback({ error: 'Failed to share tunnel' });
        }
    });

    socket.on('removeTunnelShare', async ({ userId, sessionToken, tunnelId, targetUserId }, callback) => {
        try {
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                return callback({ error: 'Invalid session' });
            }

            const tunnel = statements.findTunnelById.get(tunnelId);
            if (!tunnel) {
                return callback({ error: 'Tunnel not found' });
            }

            const userIdToRemove = targetUserId || userId;
            
            if (targetUserId && tunnel.createdBy !== userId) {
                return callback({ error: 'You do not have permission to remove this share' });
            }

            statements.removeTunnelUser.run(tunnelId, userIdToRemove);

            callback({ success: true });
        } catch (error) {
            logger.error('Share removal error:', error);
            callback({ error: 'Failed to remove share' });
        }
    });

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
                    statements.deleteSSHKeys.run(tunnelId);
                    statements.deleteTunnelTags.run(tunnelId);
                    statements.deleteTunnelUsers.run(tunnelId);
                    statements.deleteTunnel.run(tunnelId, userId);
                } else {
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
    
    socket.on('disconnect', () => {
    });
});

server.listen(8081, () => {
    logger.info('Tunnelix database server running on port 8081');
});

module.exports = { server }; 