/**
 * Querya - Advanced AI Assistant
 * agent.js
 * v2.8.0 (Updated: AI Pipe integration + bug fixes)
 * Author: Gaurav Tomar (Original) & Assistant (fixes)
 *
 * Notes:
 * - Default provider is AI Pipe (https://aipipe.org).
 * - Paste your AI Pipe token in Settings (NOT an OpenAI key).
 * - Works without streaming; add SSE later if needed.
 * - Gracefully degrades when optional libs (marked/hljs) are missing.
 */

class Querya {
  constructor() {
    this.version = '2.8.0';
    this.initialized = false;

    // ---- Reactive state ----
    this.state = new Proxy({
      conversations: new Map(),
      currentConversationId: null,
      isProcessing: false,
      settings: this.getDefaultSettings(),
      performance: { startTime: Date.now(), responseTime: 0, apiCalls: 0, memoryUsage: 0 },
      ui: { theme: 'auto', sidebarOpen: true, voiceEnabled: false, performanceMonitorOpen: false }
    }, {
      set: (target, property, value) => {
        const oldValue = target[property];
        target[property] = value;
        try { this.onStateChange(property, value, oldValue); } catch (_) {}
        return true;
      }
    });

    // ---- Misc singletons ----
    this.tools = this.initializeTools();
    this.eventBus = new EventTarget();
    this.cache = new Map();
    this.performanceObserver = null;
    this.memoryMonitor = null;
    this.speechRecognition = null;

    // ---- Supported uploads ----
    this.supportedFileTypes = [
      '.txt', '.json', '.csv', '.md', '.js', '.py', '.html', '.css',
      '.xml', '.yaml', '.yml', '.sql', '.log'
    ];

    // ---- Binds ----
    this.debouncedUpdateModelOptions = this.debounce(() => this.updateModelOptions(), 500);

    // ---- Boot ----
    this.init();
  }

  // =========================
  // ========== INIT =========
  // =========================
  async init() {
    try {
      await this.showLoadingScreen();
      await Promise.all([
        this.initializeUI(),
        this.loadSettings(),
        this.initializePerformanceMonitoring(),
        this.initializeVoice(),
        this.loadConversationHistory()
      ]);
      this.setupEventListeners();
      this.setupDragAndDrop();
      this.setupContextMenu();
      this.applySettings();
      this.initialized = true;
      this.hideLoadingScreen();
      this.emit('app:initialized');
      this.showWelcomeMessage();
      console.log(`Querya v${this.version} initialized`);
    } catch (error) {
      console.error('Failed to initialize Querya:', error);
      this.showToast('error', 'Initialization Error', `Failed to start: ${error.message || error}`);
      try { this.hideLoadingScreen(); } catch (_) {}
    }
  }

  getDefaultSettings() {
    return {
      llm: {
        provider: 'aipipe',
        apiKey: '',
        model: 'openai/gpt-4o-mini',
        maxTokens: 2000,
        temperature: 0.7,
        baseUrl: 'https://aipipe.org' // customize if self-hosted proxy
      },
      ui: { theme: 'auto', animationsEnabled: true, soundEnabled: false, fontSize: 'medium' },
      voice: { enabled: false, outputEnabled: false, language: 'en-US', speechRate: 1.0 },
      advanced: { autoSave: true, analyticsEnabled: false, maxHistory: 100 }
    };
  }

  initializeTools() {
    return [
      { type: "function", function: { name: "web_search", description: "Search the web for current information", parameters: { type: "object", properties: { query: { type: "string" }, results: { type: "integer", default: 5 } }, required: ["query"] } } },
      { type: "function", function: { name: "execute_code", description: "Execute JavaScript code safely", parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } } },
      { type: "function", function: { name: "process_file", description: "Process and analyze uploaded files", parameters: { type: "object", properties: { fileId: { type: "string" }, operation: { type: "string", default: "analyze" } }, required: ["fileId"] } } },
      { type: "function", function: { name: "create_visualization", description: "Create data visualizations", parameters: { type: "object", properties: { data: { type: "string" }, type: { type: "string", default: "line" }, title: { type: "string" } }, required: ["data"] } } }
    ];
  }

  // =========================
  // ======= LOADING UI ======
  // =========================
  async showLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    const progressBar = loadingScreen ? loadingScreen.querySelector('.loading-progress') : null;

    if (loadingScreen) {
      loadingScreen.style.display = 'flex';
      loadingScreen.classList.remove('hidden');
    }

    return new Promise(resolve => {
      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 15;
        if (progressBar) progressBar.style.width = `${Math.min(progress, 100)}%`;
        if (progress >= 100) {
          clearInterval(interval);
          setTimeout(resolve, 400);
        }
      }, 90);
    });
  }

  hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    if (!loadingScreen) return;
    loadingScreen.classList.add('hidden');
    setTimeout(() => { loadingScreen.style.display = 'none'; }, 350);
  }

  // =========================
  // ========= UI ============
  // =========================
  async initializeUI() {
    this.elements = {
      app: document.getElementById('app'),
      sidebar: document.getElementById('sidebar'),
      messagesContainer: document.getElementById('messages-container'),
      messages: document.getElementById('messages'),
      welcomeScreen: document.getElementById('welcome-screen'),
      userInput: document.getElementById('user-input'),
      sendButton: document.getElementById('send-message'),
      settingsModal: document.getElementById('settings-modal'),
      contextMenu: document.getElementById('context-menu'),
      typingIndicator: document.getElementById('typing-indicator'),
      conversationList: document.getElementById('conversation-list'),
      fileDropZone: document.getElementById('file-drop-zone'),
      performanceMonitor: document.getElementById('performance-monitor'),
      charCount: document.getElementById('char-count')
    };

    // Markdown + highlighting (optional)
    if (window.marked && window.hljs) {
      marked.setOptions({
        highlight: (code, lang) => {
          try {
            if (hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
          } catch (_) {}
          try { return hljs.highlightAuto(code).value; } catch (_) {}
          return code;
        },
        breaks: true, gfm: true
      });
    }

    // Enter-to-send button state
    if (this.elements.sendButton) {
      this.elements.sendButton.disabled = false;
    }

    this.initializeAutoResize();
    this.initializeThemeDetection();

    // Ensure provider lock to AI Pipe
    this.lockProviderToAIpipe();

    // Populate models after DOM ready
    setTimeout(() => this.updateModelOptions().catch(() => {}), 300);
  }

  initializeAutoResize() {
    const textarea = this.elements.userInput;
    if (!textarea) return;
    textarea.style.overflow = 'hidden';
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
      this.updateCharCount();
    });
  }

  initializeThemeDetection() {
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq && typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', () => this.updateTheme());
      }
      setTimeout(() => this.updateTheme(), 50);
    } catch (_) {}
  }

  lockProviderToAIpipe() {
    const prov = document.getElementById('llm-provider');
    if (!prov) return;
    // Force to AI Pipe only
    prov.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = 'aipipe';
    opt.textContent = 'AI Pipe';
    prov.appendChild(opt);
    prov.value = 'aipipe';
    prov.disabled = true; // prevent accidental change
  }

  // =========================
  // ===== PERFORMANCE =======
  // =========================
  async initializePerformanceMonitoring() {
    try {
      if ('PerformanceObserver' in window) {
        this.performanceObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'measure' && entry.name === 'llm-response') {
              this.state.performance.responseTime = Math.round(entry.duration);
              this.updatePerformanceDisplay();
            }
          }
        });
        this.performanceObserver.observe({ type: 'measure', buffered: true });
      }
      if (performance && performance.memory) {
        this.memoryMonitor = setInterval(() => {
          try {
            this.state.performance.memoryUsage = Math.round(performance.memory.usedJSHeapSize / (1024 * 1024));
            this.updatePerformanceDisplay();
          } catch (_) {}
        }, 5000);
      }
    } catch (error) {
      console.warn('Performance monitoring not available:', error);
    }
  }

  // =========================
  // ========= VOICE =========
  // =========================
  async initializeVoice() {
    try {
      const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
      if (SpeechRecognition) {
        this.speechRecognition = new SpeechRecognition();
        this.speechRecognition.continuous = false;
        this.speechRecognition.interimResults = true;
        this.speechRecognition.onresult = (event) => {
          const last = event.results[event.results.length - 1];
          if (!last) return;
          if (last.isFinal) {
            this.elements.userInput.value = last[0].transcript;
            this.updateCharCount();
            this.stopVoiceInput();
          }
        };
        this.speechRecognition.onerror = (event) => {
          console.error('Speech recognition error:', event.error);
          this.stopVoiceInput();
          this.showToast('error', 'Voice Error', event.error || 'Unknown error');
        };
      }
    } catch (error) {
      console.warn('Voice capabilities not available:', error);
    }
  }

  // =========================
  // ====== EVENT WIRING =====
  // =========================
  setupEventListeners() {
    try {
      this.elements.sendButton?.addEventListener('click', () => this.sendMessage());
      this.elements.userInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
      });

      document.getElementById('voice-input')?.addEventListener('click', () => this.toggleVoiceInput());
      document.getElementById('attach-file')?.addEventListener('click', () => document.getElementById('file-input')?.click());
      document.getElementById('file-input')?.addEventListener('change', (e) => this.handleFileSelection(e));
      document.getElementById('voice-toggle')?.addEventListener('click', () => this.toggleVoiceInput());
      document.getElementById('theme-toggle')?.addEventListener('click', () => this.toggleTheme());
      document.getElementById('fullscreen-toggle')?.addEventListener('click', () => this.toggleFullscreen());
      document.getElementById('settings-toggle')?.addEventListener('click', () => this.openSettings());
      document.getElementById('new-chat')?.addEventListener('click', () => this.createNewConversation());
      document.getElementById('clear-chat')?.addEventListener('click', () => this.clearConversationMessages());
      document.getElementById('export-chat')?.addEventListener('click', () => this.exportConversation());
      document.getElementById('share-chat')?.addEventListener('click', () => this.showToast('info', 'Coming Soon', 'Share is coming soon.'));
      document.getElementById('toggle-perf')?.addEventListener('click', () => this.togglePerformanceMonitor());
      document.getElementById('close-settings')?.addEventListener('click', () => this.closeSettings());
      document.getElementById('save-settings')?.addEventListener('click', () => this.saveAndApplySettings());
      document.querySelector('.toggle-visibility')?.addEventListener('click', (e) => this.toggleApiKeyVisibility(e));
      document.getElementById('llm-provider')?.addEventListener('change', () => this.updateModelOptions());
      document.getElementById('api-key')?.addEventListener('input', this.debouncedUpdateModelOptions);
      document.getElementById('clear-all-data')?.addEventListener('click', () => this.clearAllData());

      document.querySelectorAll('.tab-btn').forEach(btn =>
        btn.addEventListener('click', e => this.switchSettingsTab(e.target.dataset.tab)));

      ['temperature', 'speech-rate'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.addEventListener('input', () => {
          const valueSpan = input.parentNode.querySelector('.range-value');
          if (valueSpan) valueSpan.textContent = id === 'speech-rate' ? `${input.value}x` : input.value;
        });
      });

      // Welcome quick actions
      document.querySelectorAll('.quick-action').forEach(btn => {
        btn.addEventListener('click', () => {
          const prompt = btn.dataset.prompt || btn.textContent;
          if (!prompt) return;
          this.elements.userInput.value = prompt;
          this.updateCharCount();
          this.sendMessage();
        });
      });

      // char count
      this.elements.userInput?.addEventListener('input', () => this.updateCharCount());

      // context menu actions
      this.elements.contextMenu?.querySelectorAll('.context-item').forEach(item => {
        item.addEventListener('click', () => {
          const action = item.dataset.action;
          this.handleContextAction(action);
          this.hideContextMenu();
        });
      });
    } catch (e) {
      console.warn('Error wiring event listeners', e);
    }
  }

  // =========================
  // ======= DRAG & DROP =====
  // =========================
  setupDragAndDrop() {
    const dropZone = this.elements.fileDropZone;
    const container = this.elements.messagesContainer;
    if (!container) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt =>
      container.addEventListener(evt, this.preventDefaults, false));

    ['dragenter', 'dragover'].forEach(evt =>
      container.addEventListener(evt, () => dropZone?.classList.add('active'), false));

    ['dragleave', 'drop'].forEach(evt =>
      container.addEventListener(evt, () => dropZone?.classList.remove('active'), false));

    container.addEventListener('drop', e => {
      if (!e.dataTransfer) return;
      this.handleFiles(Array.from(e.dataTransfer.files));
    }, false);

    dropZone?.addEventListener('click', () => document.getElementById('file-input')?.click());
  }

  // =========================
  // ===== CONTEXT MENU ======
  // =========================
  setupContextMenu() {
    if (!this.elements.messages) return;
    this.elements.messages.addEventListener('contextmenu', e => {
      e.preventDefault();
      const messageElement = e.target.closest('.message');
      if (messageElement) this.showContextMenu(e.clientX, e.clientY, messageElement);
    });
    document.addEventListener('click', (e) => {
      const menu = this.elements.contextMenu;
      if (!menu) return;
      if (!menu.contains(e.target)) menu.classList.remove('active');
    });
  }

  // =========================
  // ======= MESSAGING =======
  // =========================
  async sendMessage() {
    const inputEl = this.elements.userInput;
    const input = inputEl ? inputEl.value.trim() : '';
    if (!input || this.state.isProcessing) return;

    // Guard: require API key for real calls
    if (!this.state.settings.llm.apiKey) {
      this.addMessage('assistant', '_Demo mode_: add your **AI Pipe token** in Settings to use real models.');
    }

    // Warn if user pasted an OpenAI key by mistake
    if (this.state.settings.llm.provider === 'aipipe' && /^sk-[a-zA-Z0-9]{20,}/.test(this.state.settings.llm.apiKey || '')) {
      this.showToast('warning', 'Likely Wrong Key', 'That looks like an OpenAI key. Please paste your **AI Pipe** token.');
    }

    this.state.isProcessing = true;
    this.updateUIState();
    const convId = this.state.currentConversationId || this.createNewConversation();
    this.addMessage('user', input, convId);
    if (inputEl) { inputEl.value = ''; inputEl.style.height = 'auto'; this.updateCharCount(); }
    this.hideWelcomeScreen();
    this.showTypingIndicator();

    try {
      await this.agentLoop(convId);
    } catch (error) {
      console.error('Agent loop error:', error);
      this.addMessage('system', `An error occurred: ${error.message || error}`, convId);
      this.showToast('error', 'Agent Error', error.message || 'Unknown error');
    } finally {
      this.state.isProcessing = false;
      this.updateUIState();
      this.hideTypingIndicator();
      this.saveCurrentConversation();
    }
  }

  async agentLoop(conversationId) {
    const conversation = this.state.conversations.get(conversationId);
    if (!conversation) return;

    let maxTurns = 5;
    while (maxTurns-- > 0) {
      try {
        const t0 = performance.now?.() || Date.now();
        const responseData = await this.callLLM(conversation);
        const t1 = performance.now?.() || Date.now();
        if (performance?.measure) {
          try {
            performance.measure('llm-response', { start: t0, end: t1 });
          } catch (_) { this.state.performance.responseTime = Math.round(t1 - t0); }
        } else {
          this.state.performance.responseTime = Math.round(t1 - t0);
        }

        this.state.performance.apiCalls = (this.state.performance.apiCalls || 0) + 1;
        this.updatePerformanceDisplay();

        const response = this.parseAPIResponse(responseData, this.state.settings.llm.provider);
        if (response && response.content) {
          this.addMessage('assistant', response.content, conversationId);
        }

        if (response && response.tool_calls && response.tool_calls.length > 0) {
          // Tool-usage simulation
          this.addMessage('assistant', `Using tools: ${response.tool_calls.map(tc => tc.function.name).join(', ')}`, conversationId);
          conversation.messages.push({ role: 'assistant', content: null, tool_calls: response.tool_calls });
          const toolResults = await Promise.all(response.tool_calls.map(tc => this.executeTool(tc)));
          toolResults.forEach((result, index) => {
            conversation.messages.push({
              role: 'tool',
              tool_call_id: response.tool_calls[index].id,
              name: response.tool_calls[index].function.name,
              content: JSON.stringify(result)
            });
            this.addMessage('tool', JSON.stringify(result), conversationId);
          });
          // loop again to let model consume tool outputs
        } else {
          break;
        }
      } catch (err) {
        console.error('Error during agent loop iteration:', err);
        this.addMessage('system', `Agent iteration error: ${err.message || err}`, conversationId);
        break;
      }
    }
  }

  // =========================
  // ======== LLM I/O ========
  // =========================
  async callLLM(conversation) {
    // Compose OpenAI-style messages for compatibility
    const messagesForApi = conversation.messages.map(m => {
      if (m.role === 'tool') {
        return { role: 'system', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
      }
      return { role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
    }).filter(m => !!m.content);

    const { provider, apiKey, model, maxTokens, temperature, baseUrl } = this.state.settings.llm || {};
    if (!provider) throw new Error('No LLM provider configured.');

    // Demo fallback
    if (!apiKey) {
      return { choices: [{ message: { content: "💡 Demo response: add your AI Pipe token in Settings to query real models." } }] };
    }

    // ---- AI Pipe only ----
    if (provider !== 'aipipe') {
      throw new Error('Only AI Pipe is supported in this build. (Provider forced to AI Pipe)');
    }

    // Primary: OpenRouter-compatible endpoint via AI Pipe
    const apiUrl = `${baseUrl.replace(/\/+$/,'')}/openrouter/v1/chat/completions`;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
    const body = {
      model: model || 'openai/gpt-4o-mini',
      messages: messagesForApi.map(m => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
      temperature
    };

    try {
      const resp = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!resp.ok) {
        let errText = `${resp.status} ${resp.statusText}`;
        try { const errJson = await resp.json(); errText = errJson.error?.message || JSON.stringify(errJson); } catch (_) {}
        // Helpful hint for wrong model vs token
        throw new Error(`AI Pipe error (${resp.status}): ${errText}. Tip: ensure your token has access to **${body.model}**, or pick a listed model in Settings.`);
      }
      const data = await resp.json();
      return data;
    } catch (err) {
      // Retry once via OpenAI-compatible endpoint if OpenRouter path fails hard
      try {
        const altUrl = `${baseUrl.replace(/\/+$/,'')}/openai/v1/chat/completions`;
        const resp2 = await fetch(altUrl, { method: 'POST', headers, body: JSON.stringify({
          model: body.model,
          messages: body.messages,
          max_tokens: body.max_tokens,
          temperature: body.temperature
        })});
        if (!resp2.ok) {
          let errText = `${resp2.status} ${resp2.statusText}`;
          try { const errJson = await resp2.json(); errText = errJson.error?.message || JSON.stringify(errJson); } catch (_) {}
          throw new Error(`AI Pipe (fallback) error (${resp2.status}): ${errText}`);
        }
        return await resp2.json();
      } catch (err2) {
        throw new Error(err2.message || err.message || 'Network error');
      }
    }
  }

  parseAPIResponse(data, provider) {
    try {
      // OpenAI/OpenRouter-like
      if (data?.choices?.length) {
        const msg = data.choices[0].message || {};
        return { content: msg.content || data.choices[0].text || '' };
      }
      // Some providers return {candidates:[{content:{parts:[{text:"..."}]}}]}
      if (data?.candidates?.length) {
        const parts = data.candidates[0].content?.parts || data.candidates[0].content || [];
        const text = Array.isArray(parts) ? parts.map(p => p.text || p).join('') : parts;
        return { content: text };
      }
      // Fallback dump
      return { content: typeof data === 'string' ? data : 'Received an unrecognized response format.' };
    } catch (e) {
      console.error('Error parsing API response:', e, data);
      throw new Error('Could not parse the API response.');
    }
  }

  // =========================
  // ======= TOOLS (stubs) ===
  // =========================
  async executeTool(toolCall) {
    const func = toolCall.function || {};
    const name = func.name || 'unknown';
    let args = {};
    try {
      if (toolCall.arguments) {
        args = typeof toolCall.arguments === 'string' ? JSON.parse(toolCall.arguments) : toolCall.arguments;
      }
    } catch (_) { args = {}; }

    this.addMessage('system', `Executing tool: ${name}`, this.state.currentConversationId);
    switch (name) {
      case 'web_search': return await this.executeWebSearch(args);
      case 'execute_code': return await this.executeCode(args);
      case 'process_file': return await this.processFile(args);
      case 'create_visualization': return await this.createVisualization(args);
      default: return { error: `Unknown tool: ${name}` };
    }
  }

  async executeWebSearch({ query, results = 5 }) { return { status: `Simulated search for: ${query}`, items: [] }; }
  async executeCode({ code }) { return { output: `Simulated execution of: ${code}` }; }
  async processFile({ fileId, operation }) { return { result: `Simulated ${operation} on file ${fileId}` }; }
  async createVisualization({ data, type, title }) { return { chartUrl: `Simulated ${type} chart titled "${title}"` }; }

  // =========================
  // ====== UI MESSAGES ======
  // =========================
  addMessage(role, content, conversationId) {
    try {
      const convId = conversationId || this.state.currentConversationId;
      if (!convId) return;
      const conversation = this.state.conversations.get(convId);
      if (!conversation || content === null || content === undefined) return;

      const message = { id: `msg_${Date.now()}`, role, content, timestamp: Date.now() };
      conversation.messages.push(message);

      if (role !== 'system' && typeof content === 'string') {
        conversation.preview = content.substring(0, 100);
        if (!conversation.title || conversation.title === 'New Conversation') {
          conversation.title = content.substring(0, 30) || 'Conversation';
        }
        conversation.updatedAt = Date.now();
        this.updateConversationList();
      }

      this.displayMessage(message);
      this.scrollToBottom();
    } catch (e) {
      console.error('addMessage error', e);
    }
  }

  displayMessage(message) {
    try {
      if (!this.elements.messages) return;
      const messageEl = document.createElement('div');
      messageEl.className = `message ${message.role}`;
      messageEl.dataset.messageId = message.id;

      const senderName = { user: 'You', assistant: 'Querya', system: 'System', tool: 'Tool' }[message.role] || message.role;
      const avatarIcon = { user: 'fa-user', assistant: 'fa-robot', system: 'fa-cog', tool: 'fa-wrench' }[message.role] || 'fa-comment';

      let processedContent = '';
      if (typeof message.content === 'string' && window.marked) {
        try { processedContent = marked.parse(message.content); }
        catch { processedContent = `<p>${this.escapeHtml(message.content)}</p>`; }
      } else if (typeof message.content === 'string') {
        processedContent = `<p>${this.escapeHtml(message.content)}</p>`;
      } else {
        processedContent = `<pre><code>${this.escapeHtml(JSON.stringify(message.content, null, 2))}</code></pre>`;
      }

      messageEl.innerHTML = `
        <div class="message-header">
          <div class="message-avatar ${message.role}"><i class="fas ${avatarIcon}"></i></div>
          <div class="message-info"><div class="message-sender">${this.escapeHtml(senderName)}</div></div>
        </div>
        <div class="message-content">${processedContent}</div>
      `;

      this.elements.messages.appendChild(messageEl);

      if (window.hljs) {
        messageEl.querySelectorAll('pre code').forEach(block => {
          try { hljs.highlightElement(block); } catch (_) {}
        });
      }
    } catch (e) {
      console.error('displayMessage error', e);
    }
  }

  // =========================
  // ===== CONVERSATIONS =====
  // =========================
  createNewConversation() {
    const id = `conv_${Date.now()}`;
    const convObj = { id, title: 'New Conversation', messages: [], createdAt: Date.now(), updatedAt: Date.now(), preview: '...' };
    this.state.conversations.set(id, convObj);
    this.loadConversation(id);
    return id;
  }

  loadConversation(id) {
    if (!id) return;
    this.state.currentConversationId = id;
    const conversation = this.state.conversations.get(id);
    if (!this.elements.messages) return;

    this.elements.messages.innerHTML = '';
    if (conversation && conversation.messages && conversation.messages.length) {
      this.hideWelcomeScreen();
      conversation.messages.forEach(msg => this.displayMessage(msg));
    } else {
      this.showWelcomeScreen();
    }
    this.updateConversationList();
    this.updateChatHeader();
  }

  clearConversationMessages() {
    if (!this.state.currentConversationId) return;
    if (!confirm('Clear all messages in this conversation?')) return;
    const conv = this.state.conversations.get(this.state.currentConversationId);
    if (!conv) return;
    conv.messages = [];
    conv.preview = 'Cleared';
    conv.updatedAt = Date.now();
    this.loadConversation(this.state.currentConversationId);
    this.saveCurrentConversation();
  }

  async loadConversationHistory() {
    try {
      const stored = localStorage.getItem('agentflow_conversations');
      if (stored) {
        const parsed = JSON.parse(stored);
        let entries = [];
        if (Array.isArray(parsed)) entries = parsed;
        else if (typeof parsed === 'object') entries = Object.entries(parsed);
        this.state.conversations = new Map(entries.map(([k, v]) => [k, v]));
        Array.from(this.state.conversations.values()).forEach(conv => {
          conv.updatedAt = conv.updatedAt || conv.createdAt || Date.now();
          conv.messages = conv.messages || [];
        });
        const recent = Array.from(this.state.conversations.values()).sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (recent) this.loadConversation(recent.id); else this.createNewConversation();
      } else {
        this.createNewConversation();
      }
    } catch (e) {
      console.warn('Could not load conversation history, starting fresh.', e);
      this.state.conversations = new Map();
      this.createNewConversation();
    }
  }

  saveCurrentConversation() {
    try {
      if (this.state.settings.advanced.autoSave) {
        localStorage.setItem('agentflow_conversations', JSON.stringify(Array.from(this.state.conversations.entries())));
      }
    } catch (e) {
      console.warn('Could not save conversation', e);
    }
  }

  // =========================
  // ======= SETTINGS ========
  // =========================
  openSettings() {
    this.populateSettingsForm();
    this.elements.settingsModal?.classList.add('active');
  }
  closeSettings() { this.elements.settingsModal?.classList.remove('active'); }

  populateSettingsForm() {
    const s = this.state.settings || this.getDefaultSettings();
    const provEl = document.getElementById('llm-provider');
    const apiKeyEl = document.getElementById('api-key');
    const maxTokensEl = document.getElementById('max-tokens');
    const tempEl = document.getElementById('temperature');
    const baseUrlEl = document.getElementById('base-url');

    if (provEl) { this.lockProviderToAIpipe(); provEl.value = 'aipipe'; }
    if (apiKeyEl) apiKeyEl.value = s.llm.apiKey || '';
    if (maxTokensEl) maxTokensEl.value = s.llm.maxTokens || 2000;
    if (tempEl) tempEl.value = s.llm.temperature || 0.7;
    if (baseUrlEl) baseUrlEl.value = s.llm.baseUrl || 'https://aipipe.org';

    try { document.querySelector(`input[name="theme"][value="${s.ui.theme}"]`).checked = true; } catch (_) {}
    const el = (id, v) => { const e = document.getElementById(id); if (e != null) e.checked = !!v; };
    el('animations-enabled', s.ui.animationsEnabled);
    el('sound-enabled', s.ui.soundEnabled);
    const fs = document.getElementById('font-size'); if (fs) fs.value = s.ui.fontSize || 'medium';
    el('voice-enabled', s.voice.enabled);
    el('voice-output-enabled', s.voice.outputEnabled);
    const vl = document.getElementById('voice-language'); if (vl) vl.value = s.voice.language || 'en-US';
    const sr = document.getElementById('speech-rate'); if (sr) sr.value = s.voice.speechRate || 1.0;
    el('auto-save', s.advanced.autoSave);
    el('analytics-enabled', s.advanced.analyticsEnabled);
    const mh = document.getElementById('max-history'); if (mh) mh.value = s.advanced.maxHistory || 100;

    this.updateModelOptions().catch(() => {});
  }

  updateSettingsFromForm() {
    const s = this.state.settings || this.getDefaultSettings();
    s.llm.provider = 'aipipe';
    s.llm.apiKey = document.getElementById('api-key')?.value || s.llm.apiKey;
    s.llm.model = document.getElementById('model-name')?.value || s.llm.model;
    s.llm.maxTokens = parseInt(document.getElementById('max-tokens')?.value || s.llm.maxTokens, 10);
    s.llm.temperature = parseFloat(document.getElementById('temperature')?.value || s.llm.temperature);
    s.llm.baseUrl = document.getElementById('base-url')?.value || s.llm.baseUrl;

    s.ui.theme = document.querySelector('input[name="theme"]:checked')?.value || s.ui.theme;
    s.ui.animationsEnabled = document.getElementById('animations-enabled')?.checked;
    s.ui.soundEnabled = document.getElementById('sound-enabled')?.checked;
    s.ui.fontSize = document.getElementById('font-size')?.value || s.ui.fontSize;

    s.voice.enabled = document.getElementById('voice-enabled')?.checked;
    s.voice.outputEnabled = document.getElementById('voice-output-enabled')?.checked;
    s.voice.language = document.getElementById('voice-language')?.value || s.voice.language;
    s.voice.speechRate = parseFloat(document.getElementById('speech-rate')?.value || s.voice.speechRate);

    s.advanced.autoSave = document.getElementById('auto-save')?.checked;
    s.advanced.analyticsEnabled = document.getElementById('analytics-enabled')?.checked;
    s.advanced.maxHistory = parseInt(document.getElementById('max-history')?.value || s.advanced.maxHistory, 10);

    this.state.settings = s;
  }

  saveAndApplySettings() {
    try {
      this.updateSettingsFromForm();
      this.applySettings();
      localStorage.setItem('agentflow_settings', JSON.stringify(this.state.settings));
      this.showToast('success', 'Settings Saved', 'Your settings have been updated.');
      this.closeSettings();
    } catch (e) {
      this.showToast('error', 'Save Failed', e.message || 'Could not save settings');
    }
  }

  applySettings() {
    try {
      this.updateTheme();
      const font = { 'small': '0.875rem', 'medium': '1rem', 'large': '1.125rem' }[this.state.settings.ui.fontSize] || '1rem';
      document.documentElement.style.setProperty('--font-size-base', font);
    } catch (_) {}
  }

  async loadSettings() {
    try {
      const stored = localStorage.getItem('agentflow_settings');
      if (stored) {
        const loaded = JSON.parse(stored);
        this.state.settings = {
          ...this.getDefaultSettings(),
          ...loaded,
          llm: { ...this.getDefaultSettings().llm, ...(loaded.llm || {}) },
          ui: { ...this.getDefaultSettings().ui, ...(loaded.ui || {}) },
          voice: { ...this.getDefaultSettings().voice, ...(loaded.voice || {}) },
          advanced: { ...this.getDefaultSettings().advanced, ...(loaded.advanced || {}) }
        };
      }
    } catch (e) {
      console.warn('Could not load settings, using defaults', e);
    }
  }

  clearAllData() {
    if (confirm('DANGER: This will delete ALL data and settings. Continue?')) {
      localStorage.clear();
      window.location.reload();
    }
  }

  // =========================
  // ===== MODEL PICKER ======
  // =========================
  async updateModelOptions() {
    const modelSelect = document.getElementById('model-name');
    const apiKeyEl = document.getElementById('api-key');
    if (!modelSelect) return;

    modelSelect.innerHTML = '<option>Loading…</option>';
    modelSelect.disabled = true;

    try {
      const models = await this.fetchAIpipeModels(apiKeyEl?.value || '', (this.state.settings.llm.baseUrl || 'https://aipipe.org'));
      modelSelect.innerHTML = '';
      if (!models || !models.length) {
        modelSelect.innerHTML = '<option>No models available for your token.</option>';
        modelSelect.disabled = false;
        return;
      }
      models.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        modelSelect.appendChild(opt);
      });

      const current = this.state.settings.llm.model;
      if (models.includes(current)) modelSelect.value = current;
      else {
        this.state.settings.llm.model = models[0];
        modelSelect.value = models[0];
      }
    } catch (error) {
      console.error('updateModelOptions error', error);
      this.showToast('error', 'Model List Error', error.message || 'Check AI Pipe token or network.');
      modelSelect.innerHTML = `<option value="">AI Pipe token required to load models.</option>`;
    } finally {
      modelSelect.disabled = false;
    }
  }

  async fetchAIpipeModels(token, baseUrl = 'https://aipipe.org') {
    if (!token) throw new Error('AI Pipe token required');
    const cacheKey = `models_aipipe_${baseUrl}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
    const all = [];

    // Try OpenRouter-style list
    try {
      const r1 = await fetch(`${baseUrl.replace(/\/+$/,'')}/openrouter/v1/models`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (r1.ok) {
        const d1 = await r1.json();
        if (Array.isArray(d1?.models)) all.push(...d1.models.map(m => m.name || m.id));
        else if (Array.isArray(d1)) all.push(...d1.map(m => m.name || m.id));
      }
    } catch (_) {}

    // Try OpenAI-style list
    try {
      const r2 = await fetch(`${baseUrl.replace(/\/+$/,'')}/openai/v1/models`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (r2.ok) {
        const d2 = await r2.json();
        if (Array.isArray(d2?.data)) all.push(...d2.data.map(m => m.id || m.name));
      }
    } catch (_) {}

    // Fallback curated list
    const fallback = [
      'openai/gpt-4o-mini',
      'openai/gpt-4o',
      'openai/gpt-4.1',
      'openai/gpt-3.5-turbo'
    ];

    const finalList = uniq([...all, ...fallback]);
    if (!finalList.length) throw new Error('No models returned by AI Pipe. Check your token permissions.');
    this.cache.set(cacheKey, finalList);
    return finalList;
  }

  // =========================
  // ======= HEADER/UX =======
  // =========================
  updateConversationList() {
    try {
      const conversations = Array.from(this.state.conversations.values()).sort((a, b) => b.updatedAt - a.updatedAt);
      if (!this.elements.conversationList) return;
      this.elements.conversationList.innerHTML = conversations.map(conv => `
        <div class="conversation-item ${conv.id === this.state.currentConversationId ? 'active' : ''}" data-conversation-id="${conv.id}">
          <div class="conversation-title">${this.escapeHtml(conv.title || 'Conversation')}</div>
          <div class="conversation-preview">${this.escapeHtml(conv.preview || '')}</div>
        </div>`).join('');
      this.elements.conversationList.querySelectorAll('.conversation-item').forEach(item => {
        item.addEventListener('click', () => this.loadConversation(item.dataset.conversationId));
      });
      const totals = {
        conversations: this.state.conversations.size,
        messages: Array.from(this.state.conversations.values()).reduce((s, c) => s + (c.messages?.length || 0), 0)
      };
      const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      setTxt('total-conversations', totals.conversations);
      setTxt('total-messages', totals.messages);
    } catch (e) {
      console.warn('updateConversationList error', e);
    }
  }

  updateChatHeader() {
    try {
      const conv = this.state.conversations.get(this.state.currentConversationId);
      if (conv) {
        const t = document.getElementById('chat-title');
        const d = document.getElementById('chat-description');
        if (t) t.textContent = this.escapeHtml(conv.title || 'Conversation');
        if (d) d.textContent = `Created on ${new Date(conv.createdAt).toLocaleDateString()}`;
      }
    } catch (_) {}
  }

  updateUIState() {
    if (!this.elements.sendButton) return;
    this.elements.sendButton.disabled = this.state.isProcessing;
    this.elements.sendButton.innerHTML = this.state.isProcessing ? '<i class="fas fa-spinner fa-spin"></i>' : '<i class="fas fa-paper-plane"></i>';
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    this.state.settings.ui.theme = next;
    this.applySettings();
  }

  updateTheme() {
    const pref = this.state.settings?.ui?.theme || 'auto';
    const system = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const theme = pref === 'auto' ? system : pref;
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.getElementById('theme-toggle')?.querySelector('i');
    if (icon) icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
  }

  toggleApiKeyVisibility(event) {
    try {
      const input = event.currentTarget?.previousElementSibling;
      const icon = event.currentTarget?.querySelector('i');
      if (!input) return;
      if (input.type === 'password') {
        input.type = 'text'; icon?.classList?.replace('fa-eye', 'fa-eye-slash');
      } else {
        input.type = 'password'; icon?.classList?.replace('fa-eye-slash', 'fa-eye');
      }
    } catch (_) {}
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(err => console.error('Fullscreen error:', err));
    } else {
      document.exitFullscreen?.();
    }
  }

  toggleVoiceInput() {
    if (!this.speechRecognition) return this.showToast('error', 'Voice Not Supported', 'Browser does not support SpeechRecognition.');
    this.state.ui.voiceEnabled ? this.stopVoiceInput() : this.startVoiceInput();
  }

  startVoiceInput() {
    try {
      this.state.ui.voiceEnabled = true;
      this.speechRecognition.lang = this.state.settings.voice.language || 'en-US';
      this.speechRecognition.start();
      document.querySelectorAll('#voice-toggle, #voice-input').forEach(btn => btn?.classList?.add('active'));
    } catch (e) {
      this.showToast('error', 'Voice Error', e.message || 'Could not start voice input.');
    }
  }

  stopVoiceInput() {
    try {
      this.state.ui.voiceEnabled = false;
      this.speechRecognition?.stop();
      document.querySelectorAll('#voice-toggle, #voice-input').forEach(btn => btn?.classList?.remove('active'));
    } catch (_) {}
  }

  // =========================
  // ====== UTILITIES ========
  // =========================
  debounce(func, delay) {
    let timeout;
    return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), delay); };
  }

  showTypingIndicator() { this.elements.typingIndicator?.classList.add('active'); }
  hideTypingIndicator() { this.elements.typingIndicator?.classList.remove('active'); }
  showWelcomeScreen() { if (this.elements.welcomeScreen) this.elements.welcomeScreen.style.display = 'flex'; }
  hideWelcomeScreen() { if (this.elements.welcomeScreen) this.elements.welcomeScreen.style.display = 'none'; }

  showWelcomeMessage() {
    const conv = this.state.conversations.get(this.state.currentConversationId);
    if (conv && conv.messages.length === 0) {
      this.addMessage('assistant', 'Welcome to **Querya** (AI Pipe mode). Paste your AI Pipe token in **Settings → API Key** to get started.');
    }
  }

  scrollToBottom() {
    try {
      if (!this.elements.messagesContainer) return;
      this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
    } catch (_) {}
  }

  escapeHtml(text = '') {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showToast(type, title, message) {
    try {
      const container = document.getElementById('toast-container');
      if (!container) return;
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      const icon = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' }[type] || 'fa-info-circle';
      toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${icon}"></i></div>
        <div class="toast-content">
          <div class="toast-title">${this.escapeHtml(title)}</div>
          <div class="toast-message">${this.escapeHtml(message)}</div>
        </div>
        <button class="toast-close" aria-label="Close">&times;</button>`;
      toast.querySelector('.toast-close').onclick = () => toast.remove();
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 5000);
    } catch (_) {}
  }

  preventDefaults(e) { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} }

  onStateChange(_property, _value, _oldValue) { /* hook for observability if needed */ }

  emit(eventName, data) { this.eventBus.dispatchEvent(new CustomEvent(eventName, { detail: data })); }

  handleFileSelection(e) { if (!e || !e.target) return; this.handleFiles(Array.from(e.target.files || [])); }

  handleFiles(files) {
    files.forEach(file => {
      if (this.supportedFileTypes.some(type => file.name.toLowerCase().endsWith(type))) {
        const convId = this.state.currentConversationId || this.createNewConversation();
        this.addMessage('system', `File uploaded: ${file.name} (size: ${file.size} bytes). Processing placeholder added.`, convId);
      } else {
        this.showToast('warning', 'Unsupported File', `${file.name} is not a supported file type.`);
      }
    });
  }

  exportConversation() {
    try {
      const conv = this.state.conversations.get(this.state.currentConversationId);
      if (!conv) return this.showToast('error', 'Export Failed', 'No active conversation.');
      let content = `# ${conv.title}\n\n`;
      conv.messages.forEach(msg => {
        const sender = (msg.role || 'unknown').replace(/^./, c => c.toUpperCase());
        content += `**${sender}**: ${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}\n\n`;
      });
      const blob = new Blob([content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(conv.title || 'conversation').replace(/\s+/g, '_')}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      this.showToast('error', 'Export Failed', e.message || 'Could not export conversation');
    }
  }

  togglePerformanceMonitor() { this.elements.performanceMonitor?.classList.toggle('active'); }

  updatePerformanceDisplay() {
    try {
      const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      setTxt('response-time', `${this.state.performance.responseTime}ms`);
      setTxt('memory-usage', `${this.state.performance.memoryUsage}MB`);
      setTxt('api-calls', this.state.performance.apiCalls || 0);
    } catch (_) {}
  }

  updateCharCount() {
    try {
      const count = this.elements.userInput ? this.elements.userInput.value.length : 0;
      if (this.elements.charCount) this.elements.charCount.textContent = count;
    } catch (_) {}
  }

  switchSettingsTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.toggle('active', content.id === `${tabId}-tab`));
  }

  closeAllModals() { document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active')); }

  hideContextMenu() { this.elements.contextMenu?.classList.remove('active'); }

  showContextMenu(x, y, el) {
    const menu = this.elements.contextMenu;
    if (!menu) return;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.add('active');
    menu.dataset.messageId = el.dataset.messageId || '';
  }

  handleContextAction(action) {
    const msgId = this.elements.contextMenu?.dataset.messageId;
    if (!msgId) return this.showToast('warning', 'No message selected', '');
    const conv = this.state.conversations.get(this.state.currentConversationId);
    if (!conv) return;
    const msg = conv.messages.find(m => m.id === msgId);
    if (!msg) return;

    switch (action) {
      case 'copy':
        navigator.clipboard?.writeText(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
        this.showToast('success', 'Copied', 'Message copied to clipboard.');
        break;
      case 'edit':
        if (typeof msg.content === 'string') {
          this.elements.userInput.value = msg.content;
          this.updateCharCount();
          this.showToast('info', 'Edit', 'Message loaded into input for editing.');
        } else {
          this.showToast('warning', 'Edit Not Supported', 'Cannot edit structured/tool messages.');
        }
        break;
      case 'delete':
        conv.messages = conv.messages.filter(m => m.id !== msgId);
        this.saveCurrentConversation();
        this.loadConversation(this.state.currentConversationId);
        this.showToast('success', 'Deleted', 'Message deleted.');
        break;
      case 'bookmark':
        msg.bookmarked = true;
        this.showToast('success', 'Bookmarked', 'Message bookmarked.');
        break;
      default:
        this.showToast('info', 'Action', `Action: ${action}`);
    }
  }
}

// ---- Boot ----
document.addEventListener('DOMContentLoaded', () => {
  window.agentFlow = new Querya();
});
