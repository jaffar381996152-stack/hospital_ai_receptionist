(function () {
    // Load marked.js for markdown parsing
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
    script.onload = function () {
        // Configure marked for better rendering
        if (typeof marked !== 'undefined') {
            marked.setOptions({
                breaks: true,
                gfm: true
            });
        }
    };
    document.head.appendChild(script);

    // 1. Inject Styles (Glassmorphism + Animations)
    const style = document.createElement('style');
    style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&display=swap');

    :root {
        --primary-gradient: linear-gradient(135deg, #2563eb 0%, #06b6d4 100%);
        --glass-bg: rgba(255, 255, 255, 0.85);
        --glass-border: 1px solid rgba(255, 255, 255, 0.5);
        --glass-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.15);
        --user-msg-bg: #2563eb;
        --bot-msg-bg: #ffffff;
        --font-family: 'Outfit', sans-serif;
    }

    .chat-widget-container {
        font-family: var(--font-family);
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
    }

    /* Toggle Button with Pulse */
    .chat-toggle-btn {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: var(--primary-gradient);
        border: none;
        color: white;
        font-size: 28px;
        cursor: pointer;
        box-shadow: 0 4px 15px rgba(37, 99, 235, 0.4);
        transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
    }
    
    .chat-toggle-btn::after {
        content: '';
        position: absolute;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        border: 2px solid #06b6d4;
        animation: pulse-ring 2s infinite;
    }

    .chat-toggle-btn:hover {
        transform: scale(1.1);
    }

    @keyframes pulse-ring {
        0% { transform: scale(1); opacity: 0.7; }
        100% { transform: scale(1.5); opacity: 0; }
    }

    /* Main Window - Glassmorphism */
    .chat-window {
        width: 380px;
        height: 600px;
        max-height: 80vh;
        background: var(--glass-bg);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: var(--glass-border);
        box-shadow: var(--glass-shadow);
        border-radius: 24px;
        display: flex;
        flex-direction: column;
        margin-bottom: 20px;
        transform-origin: bottom right;
        transform: scale(0);
        opacity: 0;
        transition: all 0.4s cubic-bezier(0.19, 1, 0.22, 1);
        overflow: hidden;
    }

    .chat-window.open {
        transform: scale(1);
        opacity: 1;
    }

    /* Header */
    .chat-header {
        background: var(--primary-gradient);
        padding: 15px 20px;
        color: white;
        display: flex;
        justify-content: space-between;
        align-items: center;
        box-shadow: 0 4px 15px rgba(0,0,0,0.05);
    }

    .header-info h3 {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
    }

    .header-info p {
        margin: 2px 0 0;
        font-size: 0.85rem;
        font-weight: bold;
        color: white;
        opacity: 1;
        text-shadow: 0 1px 2px rgba(0,0,0,0.1);
        display: flex;
        align-items: center;
        gap: 5px;
    }

    .online-indicator {
        width: 8px;
        height: 8px;
        background: #4ade80;
        border-radius: 50%;
        display: inline-block;
    }

    .header-right {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    /* Language Selector in Header */
    .language-selector {
        position: relative;
    }

    .language-btn {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        padding: 6px 10px;
        border-radius: 20px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 5px;
        font-family: inherit;
        font-size: 0.8rem;
        transition: background 0.2s;
    }

    .language-btn:hover {
        background: rgba(255,255,255,0.35);
    }

    .language-dropdown {
        position: absolute;
        top: 100%;
        right: 0;
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        margin-top: 8px;
        overflow: hidden;
        display: none;
        min-width: 150px;
        z-index: 100;
    }

    .language-dropdown.show {
        display: block;
    }

    .language-option {
        padding: 12px 15px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 10px;
        color: #1e293b;
        font-size: 0.9rem;
        transition: background 0.2s;
    }

    .language-option:hover {
        background: #f1f5f9;
    }

    .language-option.active {
        background: #e0f2fe;
        color: #2563eb;
    }

    .close-btn {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        transition: background 0.2s;
    }

    .close-btn:hover {
        background: rgba(255,255,255,0.4);
    }

    /* Language Selection Screen */
    .language-selection-screen {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 20px;
        text-align: center;
        overflow-y: auto;
    }

    .language-selection-screen.hidden {
        display: none;
    }

    .language-icon {
        width: 60px;
        height: 60px;
        background: linear-gradient(135deg, #e0f2fe 0%, #dbeafe 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 15px;
        font-size: 30px;
    }

    .language-selection-screen h2 {
        font-size: 1.3rem;
        color: #1e293b;
        margin: 0 0 10px;
        font-weight: 600;
    }

    .language-selection-screen p {
        color: #64748b;
        font-size: 0.95rem;
        margin: 0 0 25px;
    }

    .language-buttons {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 100%;
        max-width: 280px;
    }

    .lang-select-btn {
        padding: 12px 18px;
        border: 2px solid #e2e8f0;
        border-radius: 16px;
        background: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 12px;
        font-family: inherit;
        font-size: 1rem;
        color: #1e293b;
        transition: all 0.2s;
        box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }

    .lang-select-btn:hover {
        border-color: #2563eb;
        background: #f8fafc;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.15);
    }

    .lang-select-btn .flag {
        font-size: 1.5rem;
    }

    .lang-select-btn .lang-name {
        font-weight: 500;
    }

    .lang-select-btn .lang-native {
        color: #64748b;
        margin-left: auto;
        font-size: 0.9rem;
    }

    /* Chat Area (hidden until language selected) */
    .chat-area {
        flex: 1;
        display: none;
        flex-direction: column;
        overflow: hidden;
    }

    .chat-area.active {
        display: flex;
    }

    /* Messages Area */
    .chat-messages {
        flex: 1;
        padding: 20px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 15px;
        scroll-behavior: smooth;
    }

    .message {
        max-width: 80%;
        padding: 12px 16px;
        border-radius: 18px;
        font-size: 0.95rem;
        line-height: 1.5;
        position: relative;
        animation: slideIn 0.3s ease-out forwards;
        opacity: 0;
        transform: translateY(10px);
    }

    @keyframes slideIn {
        to { opacity: 1; transform: translateY(0); }
    }

    .message.bot {
        background: var(--bot-msg-bg);
        color: #1e293b;
        border-bottom-left-radius: 4px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        align-self: flex-start;
    }

    .message.user {
        background: var(--primary-gradient);
        color: white;
        border-bottom-right-radius: 4px;
        align-self: flex-end;
        box-shadow: 0 4px 15px rgba(37, 99, 235, 0.3);
    }

    /* Markdown Styles within Messages */
    .message p { margin: 0 0 0.5em; }
    .message p:last-child { margin-bottom: 0; }
    .message ul, .message ol { margin: 0.5em 0; padding-left: 1.5em; }
    .message li { margin-bottom: 0.3em; }
    .message strong { font-weight: 600; }
    .message em { font-style: italic; }
    .message code { background: rgba(0,0,0,0.1); padding: 2px 4px; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
    .message pre { background: #f1f5f9; padding: 10px; border-radius: 8px; overflow-x: auto; margin: 0.5em 0; }
    .message h1, .message h2, .message h3, .message h4, .message h5, .message h6 {
        margin: 0.5em 0 0.3em;
        font-weight: 600;
    }
    .message h1 { font-size: 1.2em; }
    .message h2 { font-size: 1.1em; }
    .message h3 { font-size: 1.05em; }
    .message hr { border: none; border-top: 1px solid #e2e8f0; margin: 0.8em 0; }
    .message blockquote {
        border-left: 3px solid #2563eb;
        padding-left: 10px;
        margin: 0.5em 0;
        color: #475569;
    }

    /* Quick Chips */
    .quick-chips {
        padding: 10px 20px;
        display: flex;
        gap: 8px;
        overflow-x: auto;
        scrollbar-width: none; /* Hide scrollbar */
    }

    .quick-chips::-webkit-scrollbar {
        display: none;
    }

    .chip {
        background: white;
        border: 1px solid #e2e8f0;
        padding: 8px 14px;
        border-radius: 20px;
        font-size: 0.85rem;
        color: #64748b;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.2s;
        box-shadow: 0 2px 5px rgba(0,0,0,0.05);
    }

    .chip:hover {
        background: #f1f5f9;
        color: #2563eb;
        transform: translateY(-2px);
    }

    /* Input Area */
    .chat-input-area {
        padding: 20px;
        background: rgba(255,255,255,0.6);
        border-top: 1px solid rgba(0,0,0,0.05);
        display: flex;
        gap: 10px;
    }

    .chat-input {
        flex: 1;
        padding: 12px 15px;
        border: 1px solid #e2e8f0;
        border-radius: 25px;
        outline: none;
        font-family: inherit;
        transition: border-color 0.2s;
        background: white;
    }

    .chat-input:focus {
        border-color: #2563eb;
    }

    .send-btn {
        background: var(--primary-gradient);
        border: none;
        width: 45px;
        height: 45px;
        border-radius: 50%;
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s;
        box-shadow: 0 4px 10px rgba(37, 99, 235, 0.3);
    }

    .send-btn:hover {
        transform: scale(1.05);
    }

    /* Typing Indicator */
    .typing-indicator {
        display: none;
        padding: 10px 20px;
        background: white;
        align-self: flex-start;
        border-radius: 20px;
        margin-left: 20px;
        margin-bottom: 10px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.05);
    }

    .dots {
        display: flex;
        gap: 4px;
    }

    .dot {
        width: 8px;
        height: 8px;
        background: #cbd5e1;
        border-radius: 50%;
        animation: bounce 1.4s infinite ease-in-out both;
    }

    .dot:nth-child(1) { animation-delay: -0.32s; }
    .dot:nth-child(2) { animation-delay: -0.16s; }

    @keyframes bounce {
        0%, 80%, 100% { transform: scale(0); }
        40% { transform: scale(1); }
    }

    /* Consent Buttons */
    .consent-buttons {
        display: flex;
        gap: 10px;
        margin-top: 12px;
        justify-content: center;
    }

    .consent-btn {
        padding: 10px 28px;
        border: none;
        border-radius: 25px;
        cursor: pointer;
        font-family: inherit;
        font-size: 0.95rem;
        font-weight: 600;
        transition: all 0.2s;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .consent-btn.yes {
        background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
        color: white;
    }

    .consent-btn.yes:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 15px rgba(34, 197, 94, 0.4);
    }

    .consent-btn.no {
        background: white;
        color: #ef4444;
        border: 2px solid #ef4444;
    }

    .consent-btn.no:hover {
        background: #fef2f2;
        transform: translateY(-2px);
    }

    @media (max-width: 480px) {
        .chat-window {
            width: 100%;
            height: 100%;
            max-height: 100%;
            bottom: 0;
            right: 0;
            border-radius: 0;
        }
        .chat-widget-container {
            bottom: 0;
            right: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
        }
        .chat-window {
            pointer-events: all;
        }
        .chat-toggle-btn {
            position: absolute;
            bottom: 20px;
            right: 20px;
            pointer-events: all;
        }
        .chat-window.open + .chat-toggle-btn {
            display: none;
        }
    }
    `;
    document.head.appendChild(style);

    // Language configuration
    const LANGUAGES = {
        'English': { flag: '🇬🇧', name: 'English', native: '' },
        'Arabic': { flag: '🇸🇦', name: 'Arabic', native: 'العربية' },
        'Roman Arabic': { flag: '🔤', name: 'Arabizi', native: 'Roman Arabic' }
    };

    // 2. Inject HTML Structure
    const widgetContainer = document.createElement('div');
    widgetContainer.className = 'chat-widget-container';
    widgetContainer.innerHTML = `
    <div class="chat-window" id="chat-window">
      <!-- Header -->
      <div class="chat-header">
        <div class="header-info">
          <h3 id="chat-header-name">AI Assistant</h3>
          <p><span class="online-indicator"></span> Always Online</p>
        </div>
        <div class="header-right">
          <!-- Language Selector (hidden until language is chosen) -->
          <div class="language-selector" id="language-selector" style="display: none;">
            <button class="language-btn" id="language-btn">
              <span id="current-lang-flag">🇬🇧</span>
              <span id="current-lang-name">EN</span>
              <span>▼</span>
            </button>
            <div class="language-dropdown" id="language-dropdown">
              <div class="language-option" data-lang="English">
                <span>🇬🇧</span>
                <span>English</span>
              </div>
              <div class="language-option" data-lang="Arabic">
                <span>🇸🇦</span>
                <span>العربية</span>
              </div>
              <div class="language-option" data-lang="Roman Arabic">
                <span>🔤</span>
                <span>Arabizi</span>
              </div>
            </div>
          </div>
          <button class="close-btn" id="chat-close-btn">&times;</button>
        </div>
      </div>

      <!-- Language Selection Screen -->
      <div class="language-selection-screen" id="language-selection-screen">
        <div class="language-icon">🌐</div>
        <h2>Welcome / مرحباً</h2>
        <p>Please select your preferred language<br>الرجاء اختيار اللغة المفضلة</p>
        <div class="language-buttons">
          <button class="lang-select-btn" data-lang="English">
            <span class="flag">🇬🇧</span>
            <span class="lang-name">English</span>
          </button>
          <button class="lang-select-btn" data-lang="Arabic">
            <span class="flag">🇸🇦</span>
            <span class="lang-name">العربية</span>
            <span class="lang-native">Arabic</span>
          </button>
          <button class="lang-select-btn" data-lang="Roman Arabic">
            <span class="flag">🔤</span>
            <span class="lang-name">Arabizi</span>
            <span class="lang-native">Roman Arabic</span>
          </button>
        </div>
      </div>

      <!-- Chat Area (Hidden until language selected) -->
      <div class="chat-area" id="chat-area">
        <!-- Messages -->
        <div class="chat-messages" id="chat-messages"></div>

        <!-- Typing Indicator -->
        <div class="typing-indicator" id="typing-indicator">
          <div class="dots">
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
          </div>
        </div>

        <!-- Quick Chips -->
        <div class="quick-chips" id="quick-chips">
          <div class="chip" data-action="Book Appointment">📅 Book Appointment</div>
          <div class="chip" data-action="Our Doctors">👨‍⚕️ Our Doctors</div>
          <div class="chip" data-action="Working Hours">⏰ Working Hours</div>
        </div>

        <!-- Input Area -->
        <div class="chat-input-area">
          <input type="text" class="chat-input" id="chat-input" placeholder="Type your message...">
          <button class="send-btn" id="chat-send-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Toggle Button -->
    <button class="chat-toggle-btn" id="chat-toggle-btn">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
    </button>
  `;
    document.body.appendChild(widgetContainer);

    // 3. Logic & Event Listeners
    const toggleBtn = document.getElementById('chat-toggle-btn');
    const closeBtn = document.getElementById('chat-close-btn');
    const chatWindow = document.getElementById('chat-window');
    const messagesContainer = document.getElementById('chat-messages');
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    const typingIndicator = document.getElementById('typing-indicator');
    const languageSelectionScreen = document.getElementById('language-selection-screen');
    const chatArea = document.getElementById('chat-area');
    const languageSelector = document.getElementById('language-selector');
    const languageBtn = document.getElementById('language-btn');
    const languageDropdown = document.getElementById('language-dropdown');

    // Helper to get hospital ID from URL
    function getHospitalId() {
        const path = window.location.pathname;
        const segments = path.split('/').filter(segment => segment.length > 0);
        const reservedPaths = ['chat', 'reception', 'api', 'admin', 'login', 'dashboard', 'assets'];

        if (segments.length > 0) {
            const potentialId = segments[0];
            if (!reservedPaths.includes(potentialId)) {
                return potentialId;
            }
        }
        return 'default';
    }

    const currentHospitalId = getHospitalId();
    const STORAGE_KEY_SESSION = `hospital_session_${currentHospitalId}`;
    const STORAGE_KEY_LANG = `hospital_lang_${currentHospitalId}`;

    // Session Management
    let sessionId = localStorage.getItem(STORAGE_KEY_SESSION);
    if (!sessionId) {
        sessionId = 'sess_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem(STORAGE_KEY_SESSION, sessionId);
    }

    // Language State
    let currentLanguage = localStorage.getItem(STORAGE_KEY_LANG);
    let consentGiven = false;
    let isOpen = false;

    // API endpoints
    function getApiEndpoint() {
        if (currentHospitalId !== 'default') {
            return `/${currentHospitalId}/chat`;
        }
        return '/chat';
    }

    function getLanguageEndpoint() {
        return `/${currentHospitalId}/set-language`;
    }

    function getConsentEndpoint() {
        return `/${currentHospitalId}/set-consent`;
    }

    function getSessionStatusEndpoint() {
        return `/${currentHospitalId}/session-status`;
    }

    /**
     * Initialize UI based on server session state.
     * Checks the backend to see if language/consent are already set for this hospital.
     */
    async function initializeLanguageUI() {
        // If we have a stored language, try to restore from server
        if (currentHospitalId !== 'default') {
            try {
                const res = await fetch(getSessionStatusEndpoint());
                const status = await res.json();

                if (status.language && status.consentGiven) {
                    // Fully set up - go straight to chat
                    currentLanguage = status.language;
                    consentGiven = true;
                    localStorage.setItem(STORAGE_KEY_LANG, currentLanguage);
                    showChatArea();
                    updateLanguageSelector(currentLanguage);
                    return;
                } else if (status.language && !status.consentGiven) {
                    // Language set but consent not given - show consent
                    currentLanguage = status.language;
                    localStorage.setItem(STORAGE_KEY_LANG, currentLanguage);
                    showChatArea();
                    updateLanguageSelector(currentLanguage);
                    showConsentDisclaimer();
                    return;
                }
            } catch (e) {
                console.log('Session status check failed, starting fresh');
            }
        }

        // No server-side state - check local storage
        if (currentLanguage) {
            // We have a local language but need to verify server
            // Show language screen to re-select
            currentLanguage = null;
            localStorage.removeItem(STORAGE_KEY_LANG);
        }
        // Show language selection screen (default)
    }

    function showChatArea() {
        languageSelectionScreen.classList.add('hidden');
        chatArea.classList.add('active');
        languageSelector.style.display = 'block';
    }

    /**
     * Reset the widget back to language selection screen.
     * Called when session expires (needsLanguage from backend).
     */
    function resetToLanguageSelection() {
        // Clear state
        currentLanguage = null;
        consentGiven = false;
        localStorage.removeItem(STORAGE_KEY_LANG);

        // Reset UI: hide chat area, show language selection screen
        chatArea.classList.remove('active');
        languageSelectionScreen.classList.remove('hidden');
        languageSelector.style.display = 'none';

        // Clear messages
        messagesContainer.innerHTML = '';
    }

    /**
     * Show consent disclaimer with Yes/No buttons in the chat area
     */
    function showConsentDisclaimer() {
        const lang = currentLanguage;
        let disclaimerText, yesText, noText;

        if (lang === 'Arabic') {
            disclaimerText = '⚠️ **تنبيه هام** ⚠️\n\nيوفر هذا المساعد الآلي مساعدة إدارية فقط ولا يقدم **نصائح طبية**.\n\nالذكاء الاصطناعي قد يخطئ. في حالات الطوارئ، يرجى الاتصال بـ **997** فوراً.\n\nهل توافق على المتابعة؟';
            yesText = 'نعم، أوافق';
            noText = 'لا';
        } else if (lang === 'Roman Arabic') {
            disclaimerText = '⚠️ **Tanbih Ham** ⚠️\n\nHatha al-musa3ed yuqadim musa3ada idariyah faqat wa **LA** yuqadim nasa\'ih tibbiyah.\n\nAl-AI mumkin yaghlata. Fi halat al-tawari, itasil bi **997** fawran.\n\nHal tuwafiq?';
            yesText = 'Aywa, Muwafiq';
            noText = 'La';
        } else {
            disclaimerText = '⚠️ **IMPORTANT DISCLAIMER** ⚠️\n\nThis chatbot provides administrative assistance only and does **NOT** offer medical advice.\n\nAI can make mistakes. In a medical emergency, please call **997** immediately.\n\nDo you agree to proceed?';
            yesText = 'Yes, I Agree';
            noText = 'No';
        }

        addMessage(disclaimerText, 'bot');
        addConsentButtons(yesText, noText);
    }

    /**
     * Add consent Yes/No buttons to the chat
     */
    function addConsentButtons(yesText, noText) {
        const btnContainer = document.createElement('div');
        btnContainer.className = 'consent-buttons';
        btnContainer.id = 'consent-buttons';

        const yesBtn = document.createElement('button');
        yesBtn.className = 'consent-btn yes';
        yesBtn.textContent = yesText;
        yesBtn.addEventListener('click', () => handleConsent(true));

        const noBtn = document.createElement('button');
        noBtn.className = 'consent-btn no';
        noBtn.textContent = noText;
        noBtn.addEventListener('click', () => handleConsent(false));

        btnContainer.appendChild(yesBtn);
        btnContainer.appendChild(noBtn);

        messagesContainer.appendChild(btnContainer);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    /**
     * Handle consent button click
     */
    async function handleConsent(agreed) {
        // Remove consent buttons
        const btns = document.getElementById('consent-buttons');
        if (btns) btns.remove();

        // Show user's choice as a message
        addMessage(agreed ? '✅ Yes, I agree' : '❌ No', 'user');

        typingIndicator.style.display = 'block';

        try {
            const response = await fetch(getConsentEndpoint(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ consent: agreed })
            });

            const data = await response.json();
            typingIndicator.style.display = 'none';

            if (data.consentGiven) {
                consentGiven = true;
                addMessage(data.message, 'bot');
                input.focus();
            } else {
                // Consent denied - show message and re-show buttons
                addMessage(data.message, 'bot');
                const lang = currentLanguage;
                const yesText = lang === 'Arabic' ? 'نعم، أوافق' : (lang === 'Roman Arabic' ? 'Aywa, Muwafiq' : 'Yes, I Agree');
                const noText = lang === 'Arabic' ? 'لا' : (lang === 'Roman Arabic' ? 'La' : 'No');
                addConsentButtons(yesText, noText);
            }
        } catch (error) {
            typingIndicator.style.display = 'none';
            addMessage('Connection error. Please try again.', 'bot');
        }
    }

    function updateLanguageSelector(lang) {
        const langConfig = LANGUAGES[lang] || LANGUAGES['English'];
        document.getElementById('current-lang-flag').textContent = langConfig.flag;
        document.getElementById('current-lang-name').textContent = lang === 'Roman Arabic' ? 'AR' : lang.substring(0, 2).toUpperCase();

        // Update active state in dropdown
        document.querySelectorAll('.language-option').forEach(opt => {
            opt.classList.toggle('active', opt.dataset.lang === lang);
        });
    }

    function toggleChat() {
        isOpen = !isOpen;
        if (isOpen) {
            chatWindow.classList.add('open');
            if (currentLanguage) {
                input.focus();
            }
        } else {
            chatWindow.classList.remove('open');
            languageDropdown.classList.remove('show');
        }
    }

    // Parse markdown with fallback
    function parseMarkdown(text) {
        if (typeof marked !== 'undefined' && marked.parse) {
            try {
                return marked.parse(text);
            } catch (e) {
                console.error('Marked parsing error:', e);
                return escapeHtml(text).replace(/\n/g, '<br>');
            }
        }
        // Fallback: basic markdown parsing
        return basicMarkdownParse(text);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function basicMarkdownParse(text) {
        // Simple markdown fallback parser
        let html = escapeHtml(text);

        // Headers (## text)
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

        // Bold (**text** or __text__)
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

        // Italic (*text* or _text_)
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

        // Horizontal rule
        html = html.replace(/^---$/gm, '<hr>');

        // Unordered lists (* item or - item)
        html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');

        // Wrap consecutive list items in <ul>
        html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

        // Numbered lists (1. item)
        html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

        // Line breaks
        html = html.replace(/\n/g, '<br>');

        // Clean up extra <br> after block elements
        html = html.replace(/<\/(h[1-6]|ul|ol|li|hr)><br>/g, '</$1>');

        return html;
    }

    function addMessage(text, sender) {
        const div = document.createElement('div');
        div.classList.add('message', sender);

        if (sender === 'bot') {
            div.innerHTML = parseMarkdown(text);
        } else {
            div.textContent = text;
        }
        messagesContainer.appendChild(div);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Welcome messages per language
    const WELCOME_MESSAGES = {
        'English': "Hello! I'm your AI health assistant at Al Shifa Hospital. I can help you book appointments with our specialists. How can I help you today?",
        'Arabic': "مرحباً! أنا مساعد الرعاية الصحية الذكي في مستشفى الشفاء. يمكنني مساعدتك في حجز المواعيد مع أطبائنا المتخصصين. كيف يمكنني مساعدتك اليوم؟",
        'Roman Arabic': "Marhaba! Ana AI assistant fi mostashfa Al Shifa. Agdar asa3dak fi 7ajz maw3ed ma3 el doctors. Kif agdar asa3dak el yom?"
    };

    /**
     * Handle language selection via button click.
     * Calls dedicated /set-language endpoint, then shows consent disclaimer.
     */
    async function selectLanguage(lang) {
        currentLanguage = lang;
        localStorage.setItem(STORAGE_KEY_LANG, lang);

        showChatArea();
        updateLanguageSelector(lang);

        // Clear previous messages
        messagesContainer.innerHTML = '';

        // Show typing indicator
        typingIndicator.style.display = 'block';

        // Send language selection to dedicated endpoint
        try {
            const response = await fetch(getLanguageEndpoint(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ language: lang })
            });

            const data = await response.json();
            typingIndicator.style.display = 'none';

            if (data.needsConsent) {
                // Language set, now show consent disclaimer with buttons
                showConsentDisclaimer();
            } else {
                // Consent already given (shouldn't normally happen on first visit)
                consentGiven = true;
                addMessage(data.message || WELCOME_MESSAGES[lang] || WELCOME_MESSAGES['English'], 'bot');
                input.focus();
            }
        } catch (error) {
            typingIndicator.style.display = 'none';
            // Fallback: show consent disclaimer anyway
            showConsentDisclaimer();
        }
    }

    /**
     * Handle language change from the header dropdown.
     * Calls dedicated /set-language endpoint.
     */
    async function changeLanguage(lang) {
        if (lang === currentLanguage) return;

        currentLanguage = lang;
        localStorage.setItem(STORAGE_KEY_LANG, lang);
        updateLanguageSelector(lang);
        languageDropdown.classList.remove('show');

        // Notify backend of language change via dedicated endpoint
        try {
            const response = await fetch(getLanguageEndpoint(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ language: lang })
            });

            const data = await response.json();
            if (data.message) {
                addMessage(data.message, 'bot');
            }
        } catch (error) {
            console.error('Language change error:', error);
        }
    }

    async function sendMessage(overrideText) {
        const text = overrideText || input.value.trim();
        if (!text) return;

        // User Message
        addMessage(text, 'user');
        input.value = '';

        // Show Typing
        typingIndicator.style.display = 'block';
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        try {
            const response = await fetch(getApiEndpoint(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, sessionId: sessionId })
            });

            const data = await response.json();

            // Hide Typing
            typingIndicator.style.display = 'none';

            if (data.needsConsent) {
                // Server says consent is needed - show consent buttons
                if (data.reply) addMessage(data.reply, 'bot');
                const lang = currentLanguage;
                const yesText = lang === 'Arabic' ? 'نعم، أوافق' : (lang === 'Roman Arabic' ? 'Aywa, Muwafiq' : 'Yes, I Agree');
                const noText = lang === 'Arabic' ? 'لا' : (lang === 'Roman Arabic' ? 'La' : 'No');
                addConsentButtons(yesText, noText);
            } else if (data.needsLanguage) {
                // Server says language is needed (session expired) - re-show language selection screen
                if (data.reply) addMessage(data.reply, 'bot');
                resetToLanguageSelection();
            } else if (data.reply) {
                addMessage(data.reply, 'bot');
            } else if (data.error) {
                addMessage(`Error: ${data.error}`, 'bot');
            }
        } catch (error) {
            typingIndicator.style.display = 'none';
            addMessage('Sorry, connection issue.', 'bot');
        }
    }

    // Expose chip function globally
    window.sendChip = (text) => {
        sendMessage(text);
    };

    // Events
    toggleBtn.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', toggleChat);
    sendBtn.addEventListener('click', () => sendMessage());
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // Language selection buttons
    document.querySelectorAll('.lang-select-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectLanguage(btn.dataset.lang);
        });
    });

    // Language dropdown toggle
    languageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        languageDropdown.classList.toggle('show');
    });

    // Language change from dropdown
    document.querySelectorAll('.language-option').forEach(opt => {
        opt.addEventListener('click', () => {
            changeLanguage(opt.dataset.lang);
        });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
        languageDropdown.classList.remove('show');
    });

    // Quick chips event listeners
    document.querySelectorAll('.chip[data-action]').forEach(chip => {
        chip.addEventListener('click', () => {
            const action = chip.dataset.action;
            if (action) {
                sendMessage(action);
            }
        });
    });

    // Initialize on load
    initializeLanguageUI();

})();
