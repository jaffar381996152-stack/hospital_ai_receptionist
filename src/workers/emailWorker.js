const { Worker } = require('bullmq');
// const nodemailer = require('nodemailer');
const { logger } = require('../config/logger');
const redisClient = require('../config/redis');

const { transporter } = require('../config/email');

const startEmailWorker = () => {
    // Skip if mocking
    if (redisClient.constructor.name === 'MockRedis') return;

    const connection = {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: process.env.REDIS_PORT || 6379,
    };

    const worker = new Worker('emailQueue', async (job) => {
        logger.info(`Processing Email Job ${job.id}`);
        const { details } = job.data;

        const recipient = process.env.BUSINESS_EMAIL || process.env.EMAIL_USER;

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: recipient,
            subject: `New Appointment: ${details.name}`,
            text: `
                Confirmation Code: ${details.otp || 'N/A'} (If applicable)
                Name: ${details.name}
                Department: ${details.department}
                Time: ${details.date} ${details.time}
                Summary: ${details.patient_summary || 'None'}
            `
        });

        logger.info(`Email Sent for Job ${job.id}`);

    }, {
        connection,
        limiter: { max: 10, duration: 1000 } // Rate limit sending
    });

    worker.on('completed', (job) => logger.info(`Email Job ${job.id} Completed`));
    worker.on('failed', (job, err) => logger.error(`Email Job ${job.id} Failed`, err));
};

module.exports = startEmailWorker;
