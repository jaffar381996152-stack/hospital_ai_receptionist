const { logger } = require('./logger');

/**
 * Base database adapter class
 */
class DBAdapter {
    async query(sql, params = []) { throw new Error('Method not implemented'); }
    async get(sql, params = []) { throw new Error('Method not implemented'); }
    async execute(sql, params = []) { throw new Error('Method not implemented'); }
    async transaction(callback) { throw new Error('Method not implemented'); }
}

/**
 * PostgreSQL database adapter
 */
class PostgresAdapter extends DBAdapter {
    constructor(pool) {
        super();
        this.pool = pool;
    }

    async query(sql, params = []) {
        try {
            const res = await this.pool.query(sql, params);
            return res.rows;
        } catch (err) {
            logger.error(`PG Query Error: ${sql}`, err);
            throw err;
        }
    }

    async get(sql, params = []) {
        try {
            const res = await this.pool.query(sql, params);
            return res.rows[0];
        } catch (err) {
            logger.error(`PG Get Error: ${sql}`, err);
            throw err;
        }
    }

    async execute(sql, params = []) {
        try {
            const res = await this.pool.query(sql, params);
            return { rowCount: res.rowCount, changes: res.rowCount, rows: res.rows };
        } catch (err) {
            logger.error(`PG Execute Error: ${sql}`, err);
            throw err;
        }
    }

    async transaction(callback) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }
}

module.exports = { PostgresAdapter };
