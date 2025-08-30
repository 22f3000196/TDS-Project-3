# 🌐 LLM Agent — **Querya**
**Browser-Based Multi-Tool Reasoning** · [Live Demo](https://tds-bonus-project-llm-agent.vercel.app/)

**GyaanSetu** is a lightweight, browser-native LLM agent that blends natural-language reasoning with external tools (search, pipelines, in-browser JS execution). It demonstrates how a modern agent can **call tools iteratively** until a task is complete — all with a **minimal, hackable UI** and a **vanilla JavaScript core**.

---

## 🚀 Features

### 🤖 Multi-Provider Model Picker
- Works with **AI Pipe** proxy (default), **OpenAI**, **Google (Gemini)**, **Anthropic (Claude)**, etc.
- Dynamic model dropdown; settings are persisted locally.

### 🔁 Reasoning Loop Agent
- User → LLM → (optional) **tool calls** → LLM with tool results → respond.
- OpenAI-style **function/tool calling** payloads.

### 🧰 Built-in Tool Stubs
- 🔎 **Web Search** — scaffold to plug your search API.
- ⚡ **JavaScript Sandbox** — safe, client-side code execution.
- 📄 **File Processor** — accept uploads and simulate analysis.
- 📈 **Visualization** — simple charting stub.

### 🖥️ Modern UI/UX
- Sticky composer, drag-and-drop files, **dark/light/auto** theme.
- **Performance monitor** (response time, memory, API calls).
- **Conversations** sidebar (create/export/clear & delete-current).
- **Share** (Web Share / clipboard fallback) & **export** chat.
- **Voice input** (when supported).
- **PWA-ready** (manifest + SW hooks).

---

## 📋 Overview

### Goal
Build a minimal agent that can:
1. Accept user input in the browser.
2. Query an LLM for reasoning.
3. Dynamically trigger **tool calls**.
4. Loop until no more tools are needed.

### Agent Loop (Concept)
```python
def loop(llm):
    messages = [user_input()]
    while True:
        output, tool_calls = llm(messages, tools)
        print("Agent:", output)
        if tool_calls:
            messages += [handle_tool_call(tc) for tc in tool_calls]
        else:
            break
```

### Implementation
This loop is implemented in **vanilla JS** (see `agentLoop()` and `executeTool()` in `agent.js`) using OpenAI-style chat messages and function calls.

---

## 🛠️ Getting Started

### Prerequisites
- A modern browser (Chrome/Edge/Firefox).
- An API key for at least one provider:
  - **[AI Pipe](https://aipipe.org/)** (recommended; proxies many models)
  - Optional: OpenAI / Anthropic / Google

### Setup
1. **Clone** the repo:
   ```bash
   git clone https://github.com/23f1000805/tds-bonus-project-LLM-Agent.git
   cd tds-bonus-project-LLM-Agent
   ```
2. **Open** `index.html` in your browser.  
   *(No backend; runs fully client-side.)*
3. Open **Settings (⚙️)** → paste your **API key** → pick a **provider** and **model**.

> Models not loading? Check the browser console for network/CORS errors and verify the key.

---

## 🎨 What’s Included

- **Model Picker** with provider & model fetch.
- **Agent Loop** with tool/function calling.
- **Error UI** via toasts/system messages.
- **Minimal, readable code** so you can extend quickly.

---

## 🧪 Example Interaction

**User:** Interview me to create a blog post.  
**Agent:** Great! What’s the topic?  

**User:** IBM.  
**Agent:** I’ll search IBM to gather recent facts.  
→ *calls `web_search("IBM")`*  

**Agent:** IBM is a global tech company founded in 1911…  
**User:** Next step, please.  
**Agent:** Here’s a suggested outline…

---

## 📂 Project Structure

```
├── index.html        # UI (chat, settings, PWA hooks)
├── agent.js          # Core agent loop, provider calls, tool stubs
├── styles.css        # Modern responsive styles (dark/light/auto)
└── README.md         # This file
```

---

## 🔧 Configuration Notes

- **Providers & Models**  
  Choose provider & model from **Settings**. Models are fetched (where supported) and cached in-memory for the session.

- **Tools**  
  The tool functions live in `agent.js`:
  - `executeWebSearch`, `executeCode`, `processFile`, `createVisualization`  
  Replace stubs with your API logic (SerpAPI, Google CSE, internal pipelines, etc.).

- **Security**  
  Keys are stored in **localStorage** in this POC. For production, proxy requests via your backend to keep secrets safe.

---

## 🧰 Troubleshooting

- **Models don’t load:** check provider selection → API key → console/network tab for 401/403 or CORS.
- **No responses:** try another (smaller) model; some require billing enablement.
- **Voice input missing:** `SpeechRecognition` isn’t supported on all browsers/OSes.

---

## ✅ Evaluation Criteria

| Criteria               | Marks |
|------------------------|:----:|
| Output functionality   | 1.0  |
| Code quality & clarity | 0.5  |
| UI/UX polish & extras  | 0.5  |
| **Total**              | **2.0** |

---

## 🙌 Acknowledgements

- **AI Pipe** for proxy/workflows  
- **OpenAI / Anthropic / Google** for LLM providers  
- **Bootstrap**, **Font Awesome** for UI  
- **highlight.js**, **marked** for code/markdown rendering

---

## 🔮 Roadmap

- Conversation persistence (IndexedDB)
- Streaming token UX
- More tools: document parsing, charting, SQL
- Authenticated share links

---

## 📝 License

MIT — free to use, modify, and distribute. Contributions welcome!
