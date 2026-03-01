const PAGE_PATHS = [
  "/",
  "/products",
  "/products/running-shoes",
  "/products/t-shirt",
  "/cart",
  "/checkout",
  "/account",
];
const DEVICE_TYPES = ["desktop", "mobile", "tablet"];
const COUPON_CODES = [null, null, null, "SAVE10", "WELCOME20"];
const ORDER_AMOUNTS = [19.99, 29.99, 49.99, 79.99, 99.99, 149.99, 199.99];

class StreamingDemo {
  constructor() {
    this.config = null;
    this.eventHistory = [];
    this.counts = { events: 0, orders: 0, revenue: 0 };
    this.uniqueUsers = new Set();
    this.autoInterval = null;
    this.timelineCanvas = null;
    this.timelineCtx = null;
    this.timelineScale = 1;
    this.timelineCanvasDisplayWidth = 0;
    this.timelineCanvasDisplayHeight = 0;
    this.timelineCategoryColors = {
      event: "#10b981",
      order: "#7c3aed",
    };

    this.init();
  }

  async init() {
    await this.loadConfig();
    this.setupCanvas();
    this.setupEventListeners();
    this.checkApiHealth();
  }

  async loadConfig() {
    const response = await fetch("/config.json");
    if (!response.ok) {
      throw new Error(`Failed to load config.json: ${response.status}`);
    }
    this.config = await response.json();
  }

  setupCanvas() {
    this.timelineCanvas = document.getElementById("eventTimelineChart");
    if (!this.timelineCanvas) return;
    this.timelineCtx = this.timelineCanvas.getContext("2d");
    this.resizeCanvas();
    window.addEventListener("resize", () => this.resizeCanvas());
  }

  setupEventListeners() {
    const rateSlider = document.getElementById("simulationRate");
    rateSlider?.addEventListener("input", () => {
      document.getElementById("simulationRateValue").textContent =
        rateSlider.value;
    });

    document
      .getElementById("burstBtn")
      ?.addEventListener("click", () => this.runBurst());

    const autoBtn = document.getElementById("autoBtn");
    autoBtn?.addEventListener("click", () => {
      if (this.autoInterval) {
        clearInterval(this.autoInterval);
        this.autoInterval = null;
        autoBtn.textContent = "Start auto";
        autoBtn.classList.remove("active");
      } else {
        this.autoInterval = setInterval(() => this.runBurst(), 3000);
        autoBtn.textContent = "Stop auto";
        autoBtn.classList.add("active");
        this.runBurst();
      }
    });

    document
      .getElementById("sendEventBtn")
      ?.addEventListener("click", () => this.sendManualEvent());
    document
      .getElementById("sendOrderBtn")
      ?.addEventListener("click", () => this.sendManualOrder());
  }

  randomUserId() {
    return `user_${Math.random().toString(36).substr(2, 9)}`;
  }

  randomSessionId() {
    return `sess_${Math.random().toString(36).substr(2, 9)}`;
  }

  randomDeviceType() {
    return DEVICE_TYPES[Math.floor(Math.random() * DEVICE_TYPES.length)];
  }

  async runBurst() {
    const count = parseInt(
      document.getElementById("simulationRate")?.value ?? "5",
    );
    const promises = [];
    for (let i = 0; i < count; i++) {
      promises.push(this.simulateUserJourney());
    }
    await Promise.allSettled(promises);
  }

  async simulateUserJourney() {
    const userId = this.randomUserId();
    const sessionId = this.randomSessionId();
    const deviceType = this.randomDeviceType();

    this.uniqueUsers.add(userId);

    const pageCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pageCount; i++) {
      const path = PAGE_PATHS[Math.floor(Math.random() * PAGE_PATHS.length)];
      await this.postEvent({
        event_type: "page_view",
        user_id: userId,
        session_id: sessionId,
        device_type: deviceType,
        page_path: path,
      });
      await sleep(100 + Math.random() * 200);
    }

    if (Math.random() < 0.6) {
      await this.postEvent({
        event_type: "add_to_cart",
        user_id: userId,
        session_id: sessionId,
        device_type: deviceType,
        page_path: "/cart",
      });
    }

    if (Math.random() < 0.3) {
      await this.postEvent({
        event_type: "checkout_start",
        user_id: userId,
        session_id: sessionId,
        device_type: deviceType,
        page_path: "/checkout",
      });
      const amount =
        ORDER_AMOUNTS[Math.floor(Math.random() * ORDER_AMOUNTS.length)];
      const coupon =
        COUPON_CODES[Math.floor(Math.random() * COUPON_CODES.length)];
      await this.postOrder({
        user_id: userId,
        session_id: sessionId,
        device_type: deviceType,
        amount,
        coupon_code: coupon,
      });
    }

    if (Math.random() < 0.05) {
      await this.postEvent({
        event_type: "signup",
        user_id: userId,
        session_id: sessionId,
        device_type: deviceType,
        page_path: "/account",
      });
    }
  }

  apiHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (this.config.api.apiKey) headers["x-api-key"] = this.config.api.apiKey;
    return headers;
  }

  async postEvent(payload) {
    try {
      const res = await fetch(this.config.api.eventsEndpoint, {
        method: "POST",
        headers: this.apiHeaders(),
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        this.counts.events++;
        this.recordEvent(
          "event",
          `${payload.event_type} — ${payload.user_id?.substring(0, 14) ?? "anon"}`,
        );
      }
    } catch {
      // network errors during simulation are silently skipped
    }
  }

  async postOrder(payload) {
    try {
      const res = await fetch(this.config.api.ordersEndpoint, {
        method: "POST",
        headers: this.apiHeaders(),
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        this.counts.orders++;
        this.counts.revenue += payload.amount;
        this.recordEvent(
          "order",
          `order $${payload.amount.toFixed(2)} — ${payload.user_id?.substring(0, 14) ?? "anon"}`,
        );
      }
    } catch {
      // network errors during simulation are silently skipped
    }
  }

  async sendManualEvent() {
    const eventType = document.getElementById("eventType")?.value;
    const pagePath = document.getElementById("manualPagePath")?.value || null;
    await this.postEvent({ event_type: eventType, page_path: pagePath });
    this.updateMetrics();
    this.showNotification("Event sent", "success");
  }

  async sendManualOrder() {
    const amount = parseFloat(document.getElementById("orderAmount")?.value);
    const coupon = document.getElementById("orderCoupon")?.value || null;
    if (!amount || isNaN(amount)) {
      this.showNotification("Enter a valid amount", "error");
      return;
    }
    await this.postOrder({ amount, coupon_code: coupon });
    this.updateMetrics();
    this.showNotification("Order sent", "success");
  }

  recordEvent(category, description) {
    this.eventHistory.push({ category, description, timestamp: new Date() });
    if (this.eventHistory.length > 5000) this.eventHistory.shift();
    this.updateEventLog();
    this.updateMetrics();
    this.drawTimeline();
  }

  updateEventLog() {
    const list = document.getElementById("eventLog");
    const countEl = document.getElementById("eventLogCount");
    if (!list) return;

    const recent = this.eventHistory.slice(-10).reverse();
    list.innerHTML = "";

    if (!recent.length) {
      const li = document.createElement("li");
      li.className = "empty-state";
      li.textContent = "No events recorded yet.";
      list.appendChild(li);
    } else {
      recent.forEach((ev) => {
        const li = document.createElement("li");
        li.className = "event-log-item";

        const meta = document.createElement("div");
        meta.className = "event-log-meta";
        const catEl = document.createElement("span");
        catEl.textContent = ev.category.toUpperCase();
        const timeEl = document.createElement("span");
        timeEl.textContent = ev.timestamp.toLocaleTimeString();
        meta.appendChild(catEl);
        meta.appendChild(timeEl);

        const desc = document.createElement("div");
        desc.className = "event-log-description";
        desc.textContent = ev.description;

        li.appendChild(meta);
        li.appendChild(desc);
        list.appendChild(li);
      });
    }

    if (countEl) {
      const n = this.eventHistory.length;
      countEl.textContent = `${n} ${n === 1 ? "event" : "events"}`;
    }
  }

  updateMetrics() {
    document.getElementById("totalEvents").textContent = this.counts.events;
    document.getElementById("totalOrders").textContent = this.counts.orders;
    document.getElementById("totalRevenue").textContent =
      `$${this.counts.revenue.toFixed(2)}`;
    document.getElementById("uniqueUsers").textContent = this.uniqueUsers.size;
    const lastEv = this.eventHistory[this.eventHistory.length - 1];
    if (lastEv) {
      const el = document.getElementById("lastEventType");
      if (el) el.textContent = lastEv.category;
    }
    const summary = document.getElementById("timelineSummary");
    if (summary && this.eventHistory.length) {
      summary.textContent = `${this.eventHistory.length} events · $${this.counts.revenue.toFixed(2)} revenue`;
    }
  }

  async checkApiHealth() {
    const el = document.getElementById("apiStatus");
    if (!el) return;
    el.textContent = "Checking...";
    el.className = "status-value connecting";
    try {
      const res = await fetch(this.config.api.healthEndpoint);
      el.textContent = res.ok ? "Connected" : "Error";
      el.className = `status-value ${res.ok ? "connected" : "error"}`;
    } catch {
      el.textContent = "Disconnected";
      el.className = "status-value error";
    }
  }

  resizeCanvas() {
    if (!this.timelineCanvas) return;
    const container = this.timelineCanvas.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    this.timelineCanvas.width = Math.floor(rect.width) * ratio;
    this.timelineCanvas.height = Math.floor(rect.height) * ratio;
    this.timelineCanvas.style.width = `${Math.floor(rect.width)}px`;
    this.timelineCanvas.style.height = `${Math.floor(rect.height)}px`;
    this.timelineCanvasDisplayWidth = Math.floor(rect.width);
    this.timelineCanvasDisplayHeight = Math.floor(rect.height);
    this.timelineScale = ratio;
    this.drawTimeline();
  }

  drawTimeline() {
    if (!this.timelineCtx) return;

    const ctx = this.timelineCtx;
    const ratio = this.timelineScale || 1;
    const width =
      this.timelineCanvasDisplayWidth || this.timelineCanvas.clientWidth || 600;
    const height =
      this.timelineCanvasDisplayHeight ||
      this.timelineCanvas.clientHeight ||
      280;
    const padding = 40;
    const chartWidth = Math.max(width - padding * 2, 10);
    const chartHeight = Math.max(height - padding * 2, 10);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.timelineCanvas.width, this.timelineCanvas.height);
    ctx.restore();

    ctx.save();
    ctx.scale(ratio, ratio);

    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    if (!this.eventHistory.length) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Events will appear here once sent.", width / 2, height / 2);
      ctx.restore();
      return;
    }

    const events = this.eventHistory;
    const startTime = events[0].timestamp.getTime();
    const endTime = events[events.length - 1].timestamp.getTime();
    const timeSpan = Math.max(endTime - startTime, 1000);

    const categories = {};
    const cumulativeCounts = {};

    events.forEach((ev) => {
      const key = ev.category;
      if (!categories[key]) {
        categories[key] = {
          color: this.timelineCategoryColors[key] || "#64748b",
          points: [],
        };
        cumulativeCounts[key] = 0;
      }
      cumulativeCounts[key]++;
      categories[key].points.push({
        t: ev.timestamp.getTime(),
        count: cumulativeCounts[key],
      });
    });

    const categoryEntries = Object.entries(categories).filter(
      ([, d]) => d.points.length,
    );
    const maxCount = categoryEntries.length
      ? Math.max(
          ...categoryEntries.map(
            ([, d]) => d.points[d.points.length - 1].count,
          ),
        )
      : 1;
    const yTicks = Math.min(maxCount, 4);

    for (let i = 0; i <= yTicks; i++) {
      const fraction = yTicks === 0 ? 0 : i / yTicks;
      const y = height - padding - fraction * chartHeight;
      ctx.strokeStyle = i === 0 ? "#cbd5e1" : "#f1f5f9";
      ctx.lineWidth = i === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
      ctx.fillStyle = "#94a3b8";
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(String(Math.round(fraction * maxCount)), padding - 8, y + 4);
    }

    categoryEntries.forEach(([key, data]) => {
      ctx.strokeStyle = data.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      data.points.forEach((pt, i) => {
        const x = padding + ((pt.t - startTime) / timeSpan) * chartWidth;
        const y = height - padding - (pt.count / maxCount) * chartHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      const last = data.points[data.points.length - 1];
      const lastX = padding + ((last.t - startTime) / timeSpan) * chartWidth;
      const lastY = height - padding - (last.count / maxCount) * chartHeight;
      ctx.fillStyle = data.color;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(
        `${key} (${last.count})`,
        Math.min(lastX + 8, width - padding),
        lastY - 8,
      );
    });

    const startLabel = new Date(startTime).toLocaleTimeString();
    const endLabel = new Date(endTime).toLocaleTimeString();
    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(startLabel, padding, height - padding + 20);
    ctx.textAlign = "right";
    ctx.fillText(endLabel, width - padding, height - padding + 20);

    ctx.restore();
  }

  showNotification(message, type = "info") {
    const container = document.getElementById("notifications");
    if (!container) return;
    const el = document.createElement("div");
    el.className = `notification notification-${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.animation = "slideOut 0.3s ease forwards";
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

document.addEventListener("DOMContentLoaded", () => new StreamingDemo());
