const CONFIG = {
    selectors: {
        textarea: ['textarea[data-id="root"]', '#prompt-textarea'],
        sendButton: ['button[data-id="send"]', 'button[type="submit"]']
    },
    serverUrl: localStorage.getItem('CB_SERVER_URL') || 'https://your-app-name.railway.app',
    clientToken: localStorage.getItem('CB_CLIENT_TOKEN')
};

class ContextOverlay {
    constructor() {
        this.init();
    }

    async init() {
        this.injectStyles();
        this.createOverlay();
        this.setupEventListeners();
        
        new MutationObserver(() => this.attachToTextarea())
            .observe(document.body, { childList: true, subtree: true });
    }

    createOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'context-overlay';
        overlay.innerHTML = `
            <input type="text" placeholder="Type your message...">
            <button>Send</button>
        `;
        document.body.appendChild(overlay);
    }

    injectStyles() {
        const style = document.createElement('link');
        style.rel = 'stylesheet';
        style.href = chrome.runtime.getURL('overlay.css');
        document.head.appendChild(style);
    }

    setupEventListeners() {
        const input = document.querySelector('.context-overlay input');
        const button = document.querySelector('.context-overlay button');

        button.addEventListener('click', () => this.handleSubmit(input.value));
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleSubmit(input.value);
            }
        });
    }

    async handleSubmit(text) {
        if (!text.trim()) return;

        try {
            const response = await fetch(`${CONFIG.serverUrl}/v1/context/summarize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Client-Token': CONFIG.clientToken
                },
                body: JSON.stringify({ prompt: text })
            });

            if (!response.ok) {
                throw new Error('Server response not ok');
            }

            const data = await response.json();
            this.injectPrompt(data.finalPrompt);
            
            // Clear input after successful submission
            document.querySelector('.context-overlay input').value = '';

        } catch (error) {
            console.error('Failed to process prompt:', error);
            alert('Failed to process your message. Please try again.');
        }
    }

    injectPrompt(prompt) {
        const textarea = this.findTextarea();
        if (!textarea) {
            console.error('ChatGPT textarea not found');
            return;
        }

        textarea.value = prompt;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        
        const button = this.findSendButton();
        if (button) {
            button.click();
        }
    }

    findTextarea() {
        for (const selector of CONFIG.selectors.textarea) {
            const element = document.querySelector(selector);
            if (element) return element;
        }
        return null;
    }

    findSendButton() {
        for (const selector of CONFIG.selectors.sendButton) {
            const element = document.querySelector(selector);
            if (element) return element;
        }
        return null;
    }

    attachToTextarea() {
        const textarea = this.findTextarea();
        if (textarea && !textarea.dataset.contextBrokerAttached) {
            textarea.dataset.contextBrokerAttached = 'true';
            // Additional textarea-specific setup if needed
        }
    }
}

// Initialize the overlay
new ContextOverlay();