const database = require('./database.cjs');
const sshServer = require('./ssh.cjs');

const logger = {
    info: (...args) => console.log(`🚀 |  🔧 [${new Date().toISOString()}] INFO:`, ...args),
    error: (...args) => console.error(`🚀 | ❌ [${new Date().toISOString()}] ERROR:`, ...args),
    warn: (...args) => console.warn(`⚠️ [${new Date().toISOString()}] WARN:`, ...args),
    debug: (...args) => console.debug(`🚀 | 🔍 [${new Date().toISOString()}] DEBUG:`, ...args)
};

// Flag to prevent multiple shutdown attempts
let isShuttingDown = false;

(async () => {
    try {
        logger.info("Starting all backend servers...");
        
        // Store server references for shutdown
        const servers = [
            database.server,
            sshServer
        ];
        
        logger.info("All servers started successfully");

        // Handle shutdown signals
        const handleShutdown = async () => {
            // Prevent multiple shutdown attempts
            if (isShuttingDown) {
                logger.warn("Shutdown already in progress, please wait...");
                return;
            }
            
            isShuttingDown = true;
            logger.info("Shutting down servers...");
            
            try {
                // Close all servers with a timeout
                const closePromises = servers.map(server => {
                    if (server && typeof server.close === 'function') {
                        return Promise.race([
                            new Promise(resolve => server.close(resolve)),
                            new Promise(resolve => setTimeout(() => {
                                logger.warn("Server close timed out, forcing shutdown");
                                resolve();
                            }, 3000))
                        ]);
                    }
                    return Promise.resolve();
                });
                
                // Wait for all servers to close or timeout
                await Promise.all(closePromises);
                
                logger.info("All servers shut down successfully");
            } catch (error) {
                logger.error("Error during shutdown:", error);
            }
            
            // Force exit after a short delay if still running
            setTimeout(() => {
                logger.info("Forcing process exit");
                process.exit(0);
            }, 500);
        };

        // Register shutdown handlers
        process.on('SIGINT', handleShutdown);
        process.on('SIGTERM', handleShutdown);
        process.on('SIGHUP', handleShutdown);
        
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error("Uncaught exception:", error);
        });
        
    } catch (error) {
        logger.error("Failed to start servers:", error);
        process.exit(1);
    }
})();
