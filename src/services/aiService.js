/**
 * AI Service - Refactored with Provider Abstraction
 * 
 * This service:
 * 1. Uses the provider factory to get the configured AI provider
 * 2. ONLY accepts SafeAIInput (validated, redacted content)
 * 3. Has ZERO vendor-specific code
 * 4. Applies safety filters to AI output
 * 
 * PHI SAFETY: This service NEVER has access to raw user input.
 * All input must come through getSafeAIInput() helper.
 */

const { z } = require('zod');
const { logger } = require('../config/logger');
const SafetyFilter = require('../utils/safetyFilters');
const { validateSafeInput } = require('../utils/safeAIInput');

// Import the provider (singleton from factory)
const aiProvider = require('../providers/providerFactory');

// Zod Schema for Booking Extraction
const bookingSchema = z.object({
    name: z.string().min(2),
    phone: z.string().min(8),
    department: z.string(),
    date: z.string(),
    time: z.string(),
    patient_summary: z.string().optional(),
    is_first_visit: z.boolean().optional()
});

class AIService {
    constructor() {
        this.provider = aiProvider;
        logger.info(`AIService: Initialized with provider = ${this.provider.getName()}`);
    }

    /**
     * Build the system prompt for the AI.
     * 
     * MULTI-TENANT: Prompt includes hospital-specific context.
     * 
     * @param {Object} context - Context data (slots, hours, hospital, etc.)
     * @param {string} language - User's preferred language
     * @returns {string}
     */
    buildSystemPrompt(context, language) {
        const { availableSlots, workingHours, hospital } = context;

        // Get hospital data (MULTI-TENANT: Use hospital-specific config)
        const hospitalName = hospital?.name || 'Al Shifa Hospital';
        const departments = hospital?.departments?.join(', ') || 'General Medicine';
        const emergencyNumber = hospital?.emergency_number || '997';
        const location = hospital?.location || '';

        // Build doctors list from config
        const doctorsList = hospital?.doctors?.length
            ? hospital.doctors.map(d => `- ${d.name} (${d.specialty}, ${d.department})`).join('\n')
            : 'No doctor information available at this time.';

        // Build services list
        const servicesList = hospital?.services?.length
            ? hospital.services.map(s => `- ${s}`).join('\n')
            : 'No services information available at this time.';

        // Build insurance list
        const insuranceList = hospital?.insurance_accepted?.length
            ? hospital.insurance_accepted.join(', ')
            : 'No insurance information available at this time.';

        // Build FAQ
        const faqList = hospital?.faq?.length
            ? hospital.faq.map(f => `- ${f}`).join('\n')
            : '';

        return `
You are a professional Hospital Receptionist for ${hospitalName}.
Role: Triage, Intake, Scheduling.
Tone: Professional, Calm, Concise.
Language: User prefers ${language}. ALWAYS reply in ${language} (or the language the user is speaking if they switch).

=== HOSPITAL INFORMATION (THIS IS YOUR ONLY SOURCE OF TRUTH) ===
- Name: ${hospitalName}
- Location: ${location || 'Not specified'}
- Departments: ${departments}
- Emergency: ${emergencyNumber}
- Working Hours: ${workingHours || 'Please check with reception'}

=== DOCTORS ===
${doctorsList}

=== SERVICES OFFERED ===
${servicesList}

=== ACCEPTED INSURANCE ===
${insuranceList}

=== FREQUENTLY ASKED QUESTIONS ===
${faqList || 'No FAQ available.'}

=== AVAILABLE SLOTS FOR REQUESTED DEPT ===
${availableSlots ? availableSlots : "No slot data loaded yet. Ask the user which department they want."}

=== CRITICAL GROUNDING RULES (MUST FOLLOW) ===
1. **ONLY use the information provided above.** Do NOT invent, fabricate, or assume ANY information not listed above.
2. If the user asks about a doctor, department, service, insurance provider, or any detail NOT listed above, respond: "I don't have that information currently. Please contact our reception directly at ${emergencyNumber} for assistance."
3. **NEVER fabricate** doctor names, phone numbers, prices, services, departments, or insurance providers.
4. **NEVER guess** working hours, availability, or contact details not provided above.
5. **SCOPE**: Only discuss ${hospitalName}. Do NOT mention or compare with other hospitals.
6. **URGENT SYMPTOMS**: If user mentions severe pain, tell them to call ${emergencyNumber} or visit the ER immediately.
7. **BOOKING**: Only confirm if you have Name, Phone, and a Valid Slot from the list above.
8. Check slot availability closely. If user asks "Can I come at 10?", only confirm if "10:00" appears in the Available Slots list above.

**OUTPUT FORMAT**:
If booking is complete, append this JSON block at the very end:
###BOOKING_JSON_START###
{
  "name": "...",
  "phone": "...",
  "department": "...",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "patient_summary": "...",
  "is_first_visit": true/false
}
###BOOKING_JSON_END###
`;
    }

    /**
     * Generate a response from the AI.
     * 
     * @param {SafeAIInput} safeInput - MUST be a SafeAIInput instance
     * @returns {Promise<{reply: string, bookingData?: Object, status: string}>}
     * @throws {Error} If input is not a SafeAIInput instance
     */
    async generateResponse(safeInput) {
        // PHI SAFETY: Validate that input is a SafeAIInput instance
        // This THROWS if raw input is passed
        validateSafeInput(safeInput);

        const { message, history, context, language } = safeInput;

        // Build system prompt
        const systemPrompt = this.buildSystemPrompt(context, language);

        // Build messages array (history is already redacted)
        const messages = [
            ...history.slice(-6), // Keep context short
            { role: 'user', content: message }
        ];

        // Call the provider
        const result = await this.provider.generateResponse({
            messages,
            systemPrompt,
            metadata: {
                maxTokens: 150,
                language
            }
        });

        // Check for errors
        if (result.status === 'error') {
            return {
                reply: result.content,
                status: 'error'
            };
        }

        // Apply safety filter to output
        const safeReply = SafetyFilter.scanAndSanitize(result.content);

        // Process reply for booking data
        return this.processReply(safeReply);
    }

    /**
     * Process the AI reply to extract booking data if present.
     * 
     * @param {string} text - AI response text
     * @returns {{reply: string, bookingData?: Object, status: string}}
     */
    processReply(text) {
        const jsonStart = '###BOOKING_JSON_START###';
        const jsonEnd = '###BOOKING_JSON_END###';

        if (text.includes(jsonStart)) {
            try {
                const startStr = text.split(jsonStart)[1];
                const jsonStr = startStr.split(jsonEnd)[0];
                const jsonData = JSON.parse(jsonStr.trim());

                // Validate with Zod
                const validation = bookingSchema.safeParse(jsonData);

                if (validation.success) {
                    const cleanReply = text.split(jsonStart)[0].trim();
                    return { reply: cleanReply, bookingData: validation.data, status: 'success' };
                } else {
                    logger.warn('AI Booking JSON Validation Failed', validation.error);
                    return { reply: text.split(jsonStart)[0].trim(), status: 'success' };
                }

            } catch (e) {
                logger.error('Failed to parse AI JSON', e);
                return { reply: text.split(jsonStart)[0].trim(), status: 'success' };
            }
        }

        return { reply: text, status: 'success' };
    }

    /**
     * Get the current provider name.
     * @returns {string}
     */
    getProviderName() {
        return this.provider.getName();
    }
}

module.exports = new AIService();
