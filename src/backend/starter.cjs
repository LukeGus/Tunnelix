const database = require('./database.cjs');
const sshServer = require('./ssh.cjs');

const logger = {
    info: (...args) => console.log(`🚀 |  🔧 [${new Date().toISOString()}] INFO:`, ...args),
    error: (...args) => console.error(`🚀 | ❌ [${new Date().toISOString()}] ERROR:`, ...args),
    warn: (...args) => console.warn(`⚠️ [${new Date().toISOString()}] WARN:`, ...args),
    debug: (...args) => console.debug(`🚀 | 🔍 [${new Date().toISOString()}] DEBUG:`, ...args)
};

let isShuttingDown = false;

(async () => {
    try {
        logger.info("Starting all backend servers...");
        
        const servers = [
            database.server,
            sshServer
        ];
        
        logger.info("All servers started successfully");

        const handleShutdown = async () => {
            if (isShuttingDown) {
                logger.warn("Shutdown already in progress, please wait...");
                return;
            }
            
            isShuttingDown = true;
            logger.info("Shutting down servers...");
            
            try {
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
                
                await Promise.all(closePromises);
                
                logger.info("All servers shut down successfully");
            } catch (error) {
                logger.error("Error during shutdown:", error);
            }
            
            setTimeout(() => {
                logger.info("Forcing process exit");
                process.exit(0);
            }, 500);
        };

        process.on('SIGINT', handleShutdown);
        process.on('SIGTERM', handleShutdown);
        process.on('SIGHUP', handleShutdown);
        
        process.on('uncaughtException', (error) => {
            logger.error("Uncaught exception:", error);
        });
        
    } catch (error) {
        logger.error("Failed to start servers:", error);
        process.exit(1);
    }
})();
