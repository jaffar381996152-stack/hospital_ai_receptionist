/**
 * Hospital Configuration Loader
 * 
 * Loads and validates hospital configurations for multi-tenant support.
 * Provides methods to retrieve hospital config by ID.
 * 
 * ISOLATION: Each hospital has its own isolated configuration.
 * No cross-tenant config sharing occurs.
 */

const path = require('path');
const fs = require('fs');
const { logger } = require('./logger');

// Default hospital ID for backward compatibility
const DEFAULT_HOSPITAL_ID = 'default';

// Hospital configurations cache
let hospitalsConfig = null;

/**
 * Load hospital configurations from JSON file.
 * Called once at startup.
 */
function loadHospitals() {
    const configPath = path.join(__dirname, '../../data/hospitals.json');

    try {
        const rawData = fs.readFileSync(configPath, 'utf8');
        hospitalsConfig = JSON.parse(rawData);

        const hospitalCount = Object.keys(hospitalsConfig).length;
        logger.info(`HospitalConfig: Loaded ${hospitalCount} hospital(s)`);

        // Validate default exists
        if (!hospitalsConfig[DEFAULT_HOSPITAL_ID]) {
            logger.warn(`HospitalConfig: No '${DEFAULT_HOSPITAL_ID}' hospital found. System may fail for legacy requests.`);
        }

        return hospitalsConfig;
    } catch (err) {
        logger.error(`HospitalConfig: Failed to load hospitals.json: ${err.message}`);

        // Fallback to minimal default config
        hospitalsConfig = {
            [DEFAULT_HOSPITAL_ID]: {
                id: DEFAULT_HOSPITAL_ID,
                name: 'Hospital',
                departments: ['General Medicine'],
                working_hours: '08:00-18:00',
                default_language: 'English',
                supported_languages: ['English'],
                emergency_number: '997',
                escalation_contact: { email: 'admin@hospital.com', phone: '000' }
            }
        };

        return hospitalsConfig;
    }
}

/**
 * Get configuration for a specific hospital.
 * 
 * @param {string} hospitalId - Hospital identifier
 * @returns {Object|null} Hospital configuration or null if not found
 */
function getHospitalConfig(hospitalId) {
    if (!hospitalsConfig) loadHospitals();
    return hospitalsConfig[hospitalId] || null;
}

/**
 * Get default hospital configuration.
 * Used for backward compatibility when no hospital_id is provided.
 * 
 * @returns {Object} Default hospital configuration
 */
function getDefaultHospital() {
    if (!hospitalsConfig) loadHospitals();
    return hospitalsConfig[DEFAULT_HOSPITAL_ID];
}

/**
 * Check if a hospital ID is valid.
 * 
 * @param {string} hospitalId - Hospital identifier
 * @returns {boolean}
 */
function isValidHospital(hospitalId) {
    if (!hospitalsConfig) loadHospitals();
    return hospitalId && hospitalsConfig.hasOwnProperty(hospitalId);
}

/**
 * Get all hospital IDs.
 * 
 * @returns {string[]} Array of hospital IDs
 */
function getAllHospitalIds() {
    if (!hospitalsConfig) loadHospitals();
    return Object.keys(hospitalsConfig);
}

module.exports = {
    loadHospitals,
    getHospitalConfig,
    getDefaultHospital,
    isValidHospital,
    getAllHospitalIds,
    DEFAULT_HOSPITAL_ID
};
