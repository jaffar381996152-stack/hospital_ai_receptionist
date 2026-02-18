module.exports = {
    apps: [{
        name: "hospital-ai-receptionist",
        script: "./server.js",
        instances: "max", // Use all available CPU cores
        exec_mode: "cluster", // Enable clustering mode
        env: {
            NODE_ENV: "development",
        },
        env_production: {
            NODE_ENV: "production",
        },
        // Log configuration
        error_file: "./logs/pm2-error.log",
        out_file: "./logs/pm2-out.log",
        log_date_format: "YYYY-MM-DD HH:mm:ss",
        merge_logs: true
    }]
};
