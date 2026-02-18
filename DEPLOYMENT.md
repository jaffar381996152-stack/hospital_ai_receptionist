# Deployment Guide - Oracle Cloud (Saudi Arabia Region)

This guide details the security and infrastructure steps required to deploy the Hospital AI Receptionist production build.

## 1. Server Hardening (Oracle Linux / Ubuntu)

### User Permissions
- Create a dedicated user for the application:
  ```bash
  sudo useradd -m -s /bin/bash hospital_app
  sudo usermod -aG sudo hospital_app
  ```
- **File Permissions**:
  - Restrict the SQLite database to the owner only:
    ```bash
    chmod 0600 database.sqlite
    ```
  - Ensure `.env` is readable ONLY by the app user:
    ```bash
    chmod 0400 .env
    ```

### OS Security
- **Firewall (UFW/IPtables)**:
  - Allow SSH (22), HTTP (80), HTTPS (443).
  - **Block** direct access to Redis (6379) from external IPs.
- **Fail2Ban**: Install to prevent brute-force attacks on SSH.

## 2. Data Encryption (At Rest)

Since we store patient data in `database.sqlite` and Redis, **Disk Encryption is Mandatory**.

### Oracle Cloud Block Volume Encryption
1.  When creating the Compute Instance, check **"Encrypt with Oracle-managed keys"** (Default) or use **"Customer-managed keys"** (Vault) for higher compliance.
2.  **LUKS Encryption (Linux)**:
    - If mounting a separate volume for data, format with LUKS:
      ```bash
      sudo cryptsetup luksFormat /dev/sdb
      sudo cryptsetup luksOpen /dev/sdb secure_data
      sudo mkfs.ext4 /dev/mapper/secure_data
      sudo mount /dev/mapper/secure_data /opt/hospital_data
      ```
    - Store `database.sqlite` in `/opt/hospital_data`.

## 3. Infrastructure Services

### Redis (Session & Queue)
- **Production Config**:
  - Enable persistence (AOF/RDB).
  - Set a strong `requirepass` password in `redis.conf`.
  - Bind to `127.0.0.1` ONLY.

### HTTPS (Nginx Reverse Proxy)
- Run the Node app on port 3000 (localhost only).
- Expose via Nginx on port 443 with SSL (Let's Encrypt).
  ```nginx
  server {
      listen 443 ssl;
      server_name your-hospital-domain.sa;
      location / {
          proxy_pass http://localhost:3000;
          proxy_set_header X-Forwarded-For $remote_addr;
      }
  }
  ```

## 4. Monitoring & Logs
- **Application Logs**: Located in `./logs/combined.log` and `./logs/error.log`.
- **Rotation**: Configure `logrotate` to prevent disk fill-up.
- **Audit**: Monitor specific patterns in logs: `SAFETY_VIOLATION`, `EMERGENCY`.

## 5. Backup Strategy
- **Automated Script** (Daily):
  1. Stop App (or Lock DB).
  2. Copy `database.sqlite`.
  3. Encrypt backup.
  4. Upload to Oracle Object Storage (Archive Tier).
  ```bash
  # Example Cron
  0 2 * * * /usr/local/bin/backup_hospital_data.sh
  ```

## 6. Database Management (PostgreSQL)

### Backup & Restore
For production data safety, generic SQL dumps are recommended.

#### Backup
```bash
# Dump entire database to compressed file
pg_dump "$DATABASE_URL" | gzip > hospital_backup_$(date +%Y%m%d).sql.gz
```

#### Restore
```bash
# WARNING: This overwrites existing data
gunzip -c hospital_backup_YYYYMMDD.sql.gz | psql "$DATABASE_URL"
```

### Disaster Recovery
1. **Stop Application**: `npm stop`
2. **Verify Backup**: Ensure backup file size is reasonable.
3. **Restore**: Run restore command.
4. **Run Migrations**: `npm run migrate` (ensures schema matches code).
5. **Start Application**: `npm start`

### Monitoring
- Ensure `DATABASE_URL` uses SSL (`sslmode=require`) in production.
- Monitor connection pool usage (default max: 20).
