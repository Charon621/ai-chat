import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bot,
  ChevronDown,
  Copy,
  FileText,
  Image as ImageIcon,
  Menu,
  MessageCirclePlus,
  Paperclip,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import "./styles.css";

const STORAGE_KEY = "momo-ai-conversations-v1";
const DEFAULT_MODEL = "qwen";

const MODEL_META = {
  qwen: { icon: "Q", brand: "通义千问", className: "qwen", src: "/provider-icons/qwen.ico" },
  glm: { icon: "G", brand: "智谱 GLM", className: "glm", src: "/provider-icons/glm.svg" },
  kimi: { icon: "K", brand: "Kimi", className: "kimi", src: "/provider-icons/kimi.ico" },
  deepseek: { icon: "D", brand: "DeepSeek", className: "deepseek", src: "/provider-icons/deepseek.ico" },
};

function newId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createConversation(modelId = DEFAULT_MODEL) {
  const now = Date.now();
  return {
    id: newId(),
    title: "新的聊天",
    modelId,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function loadConversations() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) && parsed.length ? parsed : [createConversation()];
  } catch {
    return [createConversation()];
  }
}

function saveConversations(conversations) {
  const slim = conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      attachments: (message.attachments || []).map(({ id, name, type, size, kind }) => ({
        id,
        name,
        type,
        size,
        kind,
      })),
    })),
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
}

function App() {
  const [models, setModels] = useState([]);
  const [conversations, setConversations] = useState(loadConversations);
  const [activeId, setActiveId] = useState(() => conversations[0]?.id);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef(null);
  const fileInputRef = useRef(null);
  const scrollerRef = useRef(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) || conversations[0],
    [activeId, conversations]
  );

  const activeModel = models.find((model) => model.id === activeConversation?.modelId) || models[0];

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!query) return sorted;
    return sorted.filter((conversation) => {
      const haystack = [
        conversation.title,
        conversation.messages.map((message) => message.content).join(" "),
        conversation.messages.flatMap((message) => (message.attachments || []).map((item) => item.name)).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [conversations, searchQuery]);

  useEffect(() => {
    fetch("/api/models")
      .then((res) => res.json())
      .then((data) => setModels(data.models || []))
      .catch(() => setError("模型列表加载失败，请确认服务端已启动。"));
  }, []);

  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [activeConversation?.messages, isSending]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  function updateConversation(id, updater) {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === id ? { ...updater(conversation), updatedAt: Date.now() } : conversation
      )
    );
  }

  function startNewChat(modelId = activeConversation?.modelId || DEFAULT_MODEL) {
    const conversation = createConversation(modelId);
    setConversations((current) => [conversation, ...current]);
    setActiveId(conversation.id);
    setInput("");
    setAttachments([]);
    setDrawerOpen(false);
  }

  function selectModel(modelId) {
    updateConversation(activeConversation.id, (conversation) => ({ ...conversation, modelId }));
    setModelSheetOpen(false);
  }

  async function handleFiles(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const prepared = [];
    for (const file of files) {
      if (file.size > 18 * 1024 * 1024) {
        prepared.push({
          id: newId(),
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          kind: "error",
          error: "文件超过 18MB，建议压缩或拆分后再传。",
        });
        continue;
      }

      const isImage = file.type.startsWith("image/");
      const isText = isTextFile(file);
      prepared.push({
        id: newId(),
        name: file.name,
        type: file.type || guessMime(file.name),
        size: file.size,
        kind: isImage ? "image" : "file",
        ...(isText ? { text: await readAsText(file) } : { dataUrl: await readAsDataUrl(file) }),
      });
    }

    setAttachments((current) => [...current, ...prepared]);
    event.target.value = "";
  }

  async function sendMessage() {
    if (isSending || (!input.trim() && !attachments.length)) return;
    setError("");

    const conversationId = activeConversation.id;
    const userMessage = {
      id: newId(),
      role: "user",
      content: input.trim(),
      attachments,
      createdAt: Date.now(),
    };
    const assistantMessage = {
      id: newId(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };

    const nextTitle =
      activeConversation.title === "新的聊天"
        ? makeTitle(userMessage.content, attachments)
        : activeConversation.title;

    const requestMessages = [...activeConversation.messages, userMessage];
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      title: nextTitle,
      messages: [...conversation.messages, userMessage, assistantMessage],
    }));

    setInput("");
    setAttachments([]);
    setIsSending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          modelId: activeConversation.modelId || DEFAULT_MODEL,
          messages: requestMessages,
        }),
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        throw new Error(cleanError(text));
      }

      await readStream(response, (chunk) => {
        updateConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === assistantMessage.id ? { ...message, content: message.content + chunk } : message
          ),
        }));
      });
    } catch (err) {
      if (err.name !== "AbortError") {
        const message = err.message || "发送失败了";
        setError(message);
        updateConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((item) =>
            item.id === assistantMessage.id ? { ...item, content: `出错了：${message}` } : item
          ),
        }));
      }
    } finally {
      setIsSending(false);
      abortRef.current = null;
    }
  }

  function stopSending() {
    abortRef.current?.abort();
    setIsSending(false);
  }

  function deleteConversation(id) {
    setConversations((current) => {
      const next = current.filter((conversation) => conversation.id !== id);
      if (!next.length) {
        const fresh = createConversation();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (activeId === id) setActiveId(next[0].id);
      return next;
    });
  }

  function clearCurrentChat() {
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      title: "新的聊天",
      messages: [],
    }));
  }

  return (
    <main className="app-shell">
      <aside className={`history-panel ${drawerOpen ? "open" : ""}`}>
        <div className="history-top">
          <div>
            <p className="eyebrow">历史记录</p>
            <h1>AI Chat</h1>
          </div>
          <button type="button" className="icon-btn" onClick={() => setDrawerOpen(false)} aria-label="关闭记录">
            <X size={20} />
          </button>
        </div>

        <label className="search-box">
          <Search size={17} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索聊天记录"
          />
        </label>

        <button type="button" className="new-chat-btn" onClick={() => startNewChat()}>
          <MessageCirclePlus size={18} />
          新聊天
        </button>

        <div className="history-list">
          {filteredConversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`history-item ${conversation.id === activeConversation.id ? "active" : ""}`}
            >
              <button
                type="button"
                className="history-main"
                onClick={() => {
                  setActiveId(conversation.id);
                  setDrawerOpen(false);
                }}
              >
                <span>{conversation.title}</span>
                <small>{formatDate(conversation.updatedAt)}</small>
              </button>
              <button
                type="button"
                className="history-delete"
                onClick={() => deleteConversation(conversation.id)}
                aria-label="删除聊天"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </aside>
      {drawerOpen && <button className="backdrop" onClick={() => setDrawerOpen(false)} aria-label="关闭遮罩" />}

      <section className="chat-stage">
        <header className="top-bar">
          <button type="button" className="icon-btn" onClick={() => setDrawerOpen(true)} aria-label="打开记录">
            <Menu size={22} />
          </button>
          <button type="button" className="model-pill" onClick={() => setModelSheetOpen(true)}>
            <ModelIcon model={activeModel} />
            <span>
              {activeModel?.name || "千问"}
              <b>{activeModel?.model || "qwen3.7-plus"}</b>
            </span>
            <ChevronDown size={17} />
          </button>
          <button type="button" className="icon-btn" onClick={clearCurrentChat} aria-label="清空当前聊天">
            <Trash2 size={19} />
          </button>
        </header>

        <div className="chat-scroll" ref={scrollerRef}>
          {!activeConversation?.messages.length ? (
            <EmptyState onPrompt={setInput} activeModel={activeModel} models={models} />
          ) : (
            <div className="message-list">
              {activeConversation.messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="toast">
            <Sparkles size={16} />
            {error}
          </div>
        )}

        <footer className="composer-wrap">
          {!!attachments.length && (
            <div className="attachment-strip">
              {attachments.map((file) => (
                <div className={`attachment-chip ${file.kind}`} key={file.id}>
                  {file.kind === "image" && file.dataUrl ? (
                    <img src={file.dataUrl} alt="" />
                  ) : (
                    <FileText size={17} />
                  )}
                  <span>{file.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((current) => current.filter((item) => item.id !== file.id))}
                    aria-label="移除附件"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="composer">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={handleFiles}
              accept="image/*,.txt,.md,.csv,.json,.js,.ts,.tsx,.jsx,.py,.html,.css,.pdf,.docx,.xlsx,.xls"
            />
            <button type="button" className="icon-btn attach" onClick={() => fileInputRef.current?.click()} aria-label="上传附件">
              <Paperclip size={21} />
            </button>
            <textarea
              value={input}
              rows={1}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="问点什么，或上传图片/文件..."
            />
            <button type="button" className="send-btn" onClick={isSending ? stopSending : sendMessage} aria-label="发送">
              {isSending ? <Square size={18} fill="currentColor" /> : <Send size={19} />}
            </button>
          </div>
        </footer>
      </section>

      {modelSheetOpen && (
        <div className="sheet-layer" onClick={() => setModelSheetOpen(false)}>
          <section className="model-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-head">
              <div>
                <p className="eyebrow">选择模型</p>
                <h2>切换 AI</h2>
              </div>
              <button type="button" className="icon-btn" onClick={() => setModelSheetOpen(false)} aria-label="关闭模型选择">
                <X size={20} />
              </button>
            </div>
            <div className="model-grid">
              {models.map((model) => (
                <button
                  type="button"
                  key={model.id}
                  className={`model-card ${model.id === activeConversation.modelId ? "selected" : ""}`}
                  onClick={() => selectModel(model.id)}
                >
                  <ModelIcon model={model} size="large" />
                  <span className="model-copy">
                    <strong>{model.name}</strong>
                    <small>{model.model}</small>
                    <em>{model.tone}</em>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function EmptyState({ onPrompt, activeModel, models }) {
  const prompts = ["帮我整理今天的想法", "分析这张图片", "总结上传的文件"];
  const shownModels = models.length ? models : [{ id: "qwen", name: "千问", model: "qwen3.7-plus" }];

  return (
    <div className="empty-state">
      <div className="welcome-panel">
        <div className="welcome-title">
          <ModelIcon model={activeModel || shownModels[0]} size="large" />
          <div>
            <p className="eyebrow">私人 AI 助手</p>
            <h2>今天想问点什么？</h2>
          </div>
        </div>
        <p className="welcome-copy">默认使用千问。需要视觉、长文或推理时，可以点顶部模型切换。</p>
        <div className="model-strip">
          {shownModels.map((model) => (
            <span key={model.id} className="mini-model">
              <ModelIcon model={model} />
              {model.name}
            </span>
          ))}
        </div>
      </div>
      <div className="prompt-row">
        {prompts.map((prompt) => (
          <button type="button" key={prompt} onClick={() => onPrompt(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function ModelIcon({ model, size = "normal" }) {
  const meta = MODEL_META[model?.id] || { icon: "AI", brand: model?.name || "AI", className: "default" };
  return (
    <span className={`model-icon ${meta.className} ${size}`} aria-label={meta.brand} title={meta.brand}>
      {meta.src ? <img src={meta.src} alt="" /> : meta.icon}
    </span>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === "user";
  return (
    <article className={`message ${isUser ? "user" : "assistant"}`}>
      <div className="avatar">{isUser ? <Sparkles size={17} /> : <Bot size={18} />}</div>
      <div className="bubble">
        {!!message.attachments?.length && (
          <div className="bubble-files">
            {message.attachments.map((file) => (
              <span key={file.id || file.name}>
                {file.kind === "image" ? <ImageIcon size={14} /> : <FileText size={14} />}
                {file.name}
              </span>
            ))}
          </div>
        )}
        <div className="message-text">{message.content || (message.role === "assistant" ? "正在思考..." : "")}</div>
        {!isUser && message.content && (
          <button type="button" className="copy-btn" onClick={() => navigator.clipboard?.writeText(message.content)}>
            <Copy size={14} />
            复制
          </button>
        )}
      </div>
    </article>
  );
}

async function readStream(response, onChunk) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.replace(/^data:\s*/, "");
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || "";
        if (delta) onChunk(delta);
      } catch {
        continue;
      }
    }
  }
}

function isTextFile(file) {
  const lower = file.name.toLowerCase();
  return (
    file.type.startsWith("text/") ||
    [".md", ".json", ".csv", ".js", ".ts", ".tsx", ".jsx", ".py", ".html", ".css", ".xml", ".log"].some((ext) =>
      lower.endsWith(ext)
    )
  );
}

function guessMime(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/octet-stream";
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function makeTitle(content, files) {
  const text = content || files.map((file) => file.name).join("、") || "新的聊天";
  return text.replace(/\s+/g, " ").slice(0, 24);
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function cleanError(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed.error || text;
  } catch {
    return text || "请求失败";
  }
}

createRoot(document.getElementById("root")).render(<App />);
