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
const COUNTRIES = ["GB", "US", "DE", "FR"];
const REFERRERS = [
  "https://search.example/",
  "https://newsletter.example/",
  "https://partner.example/",
  "https://social.example/",
];
const COUPON_CODES = [null, null, null, "SAVE10", "WELCOME20"];
const ORDER_AMOUNTS = [19.99, 29.99, 49.99, 79.99, 99.99, 149.99, 199.99];
const VISITOR_STORAGE_KEY = "growthbook-demo-visitor";
const ASSIGNMENT_STORAGE_PREFIX = "growthbook-demo-assignment:";

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
      event: "#0f766e",
      exposure: "#dc2626",
      feature: "#d97706",
      order: "#1d4ed8",
    };
    this.visitor = null;

    this.init();
  }

  async init() {
    await this.loadConfig();
    this.initialiseVisitor();
    this.setupCanvas();
    this.setupEventListeners();
    this.syncExperimentForm();
    this.renderVisitor();
    this.refreshAssignmentPreview();
    this.renderGrowthBookStatus();
    this.checkApiHealth();
  }

  async loadConfig() {
    const response = await fetch("/config.json");
    if (!response.ok) {
      throw new Error(`Failed to load config.json: ${response.status}`);
    }

    this.config = await response.json();
  }

  get growthbookConfig() {
    return (
      this.config?.growthbook ?? {
        assignmentView: "experimentation.experiment_assignments",
        featureUsageView: "experimentation.feature_usage",
        sessionMetricsView: "experimentation.session_metrics",
        checkoutFunnelView: "experimentation.checkout_funnel",
        userDayMetricsView: "experimentation.user_day_metrics",
        demoExperiment: {
          key: "checkout-layout-aa",
          featureKey: "checkout-layout",
          variations: [
            { id: "0", label: "classic", value: "classic", conversionMultiplier: 1 },
            { id: "1", label: "modern", value: "modern", conversionMultiplier: 1 },
          ],
        },
      }
    );
  }

  setupCanvas() {
    this.timelineCanvas = document.getElementById("eventTimelineChart");
    if (!this.timelineCanvas) {
      return;
    }

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
    document
      .getElementById("sendExposureBtn")
      ?.addEventListener("click", () => this.sendExposureEvent());
    document
      .getElementById("sendFeatureUsageBtn")
      ?.addEventListener("click", () => this.sendFeatureUsageEvent());
    document
      .getElementById("refreshVisitorBtn")
      ?.addEventListener("click", () => this.replaceVisitor());
    document
      .getElementById("newSessionBtn")
      ?.addEventListener("click", () => this.startNewSession());

    for (const id of [
      "visitorUserId",
      "visitorAnonymousId",
      "visitorSessionId",
      "visitorDeviceType",
      "visitorCountry",
      "visitorReferrer",
      "visitorLoggedIn",
    ]) {
      document.getElementById(id)?.addEventListener("change", () => {
        this.updateVisitorFromForm();
      });
    }

    for (const id of ["experimentKey", "featureKey", "variationId", "featureValue"]) {
      document.getElementById(id)?.addEventListener("change", () => {
        this.refreshAssignmentPreview();
      });
    }
  }

  initialiseVisitor() {
    const saved = this.readJsonFromStorage(VISITOR_STORAGE_KEY);
    this.visitor = this.normaliseVisitor(saved) ?? this.createVisitor();
    this.persistVisitor();
  }

  createVisitor(overrides = {}) {
    return {
      userId: this.randomUserId(),
      anonymousId: `anon_${this.generateRandomString(9)}`,
      sessionId: this.randomSessionId(),
      deviceType: this.randomDeviceType(),
      country: this.randomCountry(),
      referrer: this.randomReferrer(),
      loggedIn: Math.random() < 0.45,
      ...overrides,
    };
  }

  normaliseVisitor(visitor) {
    if (!visitor || typeof visitor !== "object") {
      return null;
    }

    return {
      userId: visitor.userId || this.randomUserId(),
      anonymousId: visitor.anonymousId || `anon_${this.generateRandomString(9)}`,
      sessionId: visitor.sessionId || this.randomSessionId(),
      deviceType: DEVICE_TYPES.includes(visitor.deviceType)
        ? visitor.deviceType
        : this.randomDeviceType(),
      country: COUNTRIES.includes(visitor.country)
        ? visitor.country
        : this.randomCountry(),
      referrer: visitor.referrer || this.randomReferrer(),
      loggedIn: Boolean(visitor.loggedIn),
    };
  }

  replaceVisitor() {
    this.visitor = this.createVisitor();
    this.persistVisitor();
    this.renderVisitor();
    this.refreshAssignmentPreview();
  }

  startNewSession() {
    this.visitor = {
      ...this.visitor,
      sessionId: this.randomSessionId(),
    };
    this.persistVisitor();
    this.renderVisitor();
    this.refreshAssignmentPreview();
  }

  updateVisitorFromForm() {
    this.visitor = this.normaliseVisitor({
      userId: document.getElementById("visitorUserId")?.value,
      anonymousId: document.getElementById("visitorAnonymousId")?.value,
      sessionId: document.getElementById("visitorSessionId")?.value,
      deviceType: document.getElementById("visitorDeviceType")?.value,
      country: document.getElementById("visitorCountry")?.value,
      referrer: document.getElementById("visitorReferrer")?.value,
      loggedIn: document.getElementById("visitorLoggedIn")?.checked,
    });
    this.persistVisitor();
    this.refreshAssignmentPreview();
  }

  renderVisitor() {
    if (!this.visitor) {
      return;
    }

    document.getElementById("visitorUserId").value = this.visitor.userId;
    document.getElementById("visitorAnonymousId").value = this.visitor.anonymousId;
    document.getElementById("visitorSessionId").value = this.visitor.sessionId;
    document.getElementById("visitorDeviceType").value = this.visitor.deviceType;
    document.getElementById("visitorCountry").value = this.visitor.country;
    document.getElementById("visitorReferrer").value = this.visitor.referrer;
    document.getElementById("visitorLoggedIn").checked = this.visitor.loggedIn;
  }

  persistVisitor() {
    window.localStorage.setItem(
      VISITOR_STORAGE_KEY,
      JSON.stringify(this.visitor),
    );
  }

  syncExperimentForm() {
    const experiment = this.growthbookConfig.demoExperiment;
    const assignment = this.getAssignmentForVisitor(this.visitor, experiment.key);

    document.getElementById("experimentKey").value = experiment.key;
    document.getElementById("featureKey").value = experiment.featureKey;
    document.getElementById("variationId").value = assignment.id;
    document.getElementById("featureValue").value = assignment.value;
  }

  renderGrowthBookStatus() {
    const status = document.getElementById("growthbookStatus");
    const appLink = document.getElementById("growthbookAppLink");
    const copy = document.getElementById("growthbookCopy");
    const assignmentViewPill = document.getElementById("assignmentViewPill");
    const featureViewPill = document.getElementById("featureViewPill");

    assignmentViewPill.textContent = `Assignments: ${this.growthbookConfig.assignmentView}`;
    featureViewPill.textContent = `Features: ${this.growthbookConfig.featureUsageView}`;

    if (copy) {
      copy.textContent =
        "The demo emits experiment exposure and feature usage events with dimensions so GrowthBook can query Redshift for assignments, funnels, and user-day metrics.";
    }

    if (this.growthbookConfig.appUrl) {
      status.textContent = "Configured";
      status.className = "status-value connected";
      appLink.href = this.growthbookConfig.appUrl;
      appLink.classList.remove("hidden");
      appLink.textContent = "Open GrowthBook app";
    } else {
      status.textContent = "Warehouse ready";
      status.className = "status-value connecting";
      appLink.classList.add("hidden");
    }
  }

  refreshAssignmentPreview() {
    const experimentKey =
      document.getElementById("experimentKey")?.value ||
      this.growthbookConfig.demoExperiment.key;
    const featureKey =
      document.getElementById("featureKey")?.value ||
      this.growthbookConfig.demoExperiment.featureKey;
    const assignment = this.getAssignmentForVisitor(this.visitor, experimentKey);
    const manualVariation = document.getElementById("variationId")?.value;
    const manualFeatureValue = document.getElementById("featureValue")?.value;

    document.getElementById("variationId").value = manualVariation || assignment.id;
    document.getElementById("featureValue").value =
      manualFeatureValue || assignment.value;

    const summary = document.getElementById("assignmentSummary");
    const badge = document.getElementById("assignmentBadge");
    const summaryText = `${experimentKey}: variation ${document.getElementById("variationId").value} (${featureKey}=${document.getElementById("featureValue").value})`;

    summary.textContent = summaryText;
    badge.textContent = document.getElementById("variationId").value;
  }

  getAssignmentForVisitor(visitor, experimentKey) {
    const experiment = this.resolveExperimentConfig(experimentKey);
    const storageKey = `${ASSIGNMENT_STORAGE_PREFIX}${experimentKey}:${visitor.userId}`;
    const saved = this.readJsonFromStorage(storageKey);
    if (saved && experiment.variations.some((variation) => variation.id === saved.id)) {
      return saved;
    }

    const bucket = this.hashToUnitInterval(`${visitor.userId}:${experimentKey}`);
    const index = Math.min(
      experiment.variations.length - 1,
      Math.floor(bucket * experiment.variations.length),
    );
    const chosen = experiment.variations[index];
    window.localStorage.setItem(storageKey, JSON.stringify(chosen));
    return chosen;
  }

  resolveExperimentConfig(experimentKey) {
    const demoExperiment = this.growthbookConfig.demoExperiment;
    if (experimentKey === demoExperiment.key) {
      return demoExperiment;
    }

    return {
      key: experimentKey,
      featureKey:
        document.getElementById("featureKey")?.value || demoExperiment.featureKey,
      variations: [
        {
          id: document.getElementById("variationId")?.value || "0",
          label: "manual",
          value:
            document.getElementById("featureValue")?.value || "control",
          conversionMultiplier: 1,
        },
      ],
    };
  }

  buildVisitorPayload(visitor = this.visitor) {
    return {
      user_id: visitor.userId,
      anonymous_id: visitor.anonymousId,
      session_id: visitor.sessionId,
      device_type: visitor.deviceType,
      country: visitor.country,
      referrer: visitor.referrer,
      logged_in: visitor.loggedIn,
    };
  }

  buildExperimentPayload(overrides = {}) {
    return {
      experiment_id:
        overrides.experimentId ||
        document.getElementById("experimentKey")?.value ||
        this.growthbookConfig.demoExperiment.key,
      variation_id:
        overrides.variationId || document.getElementById("variationId")?.value,
      feature_key:
        overrides.featureKey ||
        document.getElementById("featureKey")?.value ||
        this.growthbookConfig.demoExperiment.featureKey,
      feature_value:
        overrides.featureValue ||
        document.getElementById("featureValue")?.value,
    };
  }

  async runBurst() {
    const count = parseInt(
      document.getElementById("simulationRate")?.value ?? "5",
      10,
    );
    const promises = [];

    for (let i = 0; i < count; i++) {
      promises.push(this.simulateUserJourney());
    }

    await Promise.allSettled(promises);
  }

  async simulateUserJourney() {
    const visitor = this.createVisitor();
    const experiment = this.resolveExperimentConfig(
      this.growthbookConfig.demoExperiment.key,
    );
    const assignment = this.getAssignmentForVisitor(visitor, experiment.key);
    const conversionMultiplier = Number(assignment.conversionMultiplier ?? 1);

    this.uniqueUsers.add(visitor.userId);

    const pageCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pageCount; i++) {
      const path = PAGE_PATHS[Math.floor(Math.random() * PAGE_PATHS.length)];
      await this.postEvent({
        ...this.buildVisitorPayload(visitor),
        event_type: "page_view",
        page_path: path,
      });
      await sleep(80 + Math.random() * 120);
    }

    await this.postEvent({
      ...this.buildVisitorPayload(visitor),
      event_type: "experiment_viewed",
      page_path: "/checkout",
      ...this.buildExperimentPayload({
        experimentId: experiment.key,
        variationId: assignment.id,
        featureKey: experiment.featureKey,
        featureValue: assignment.value,
      }),
      properties: {
        source: "simulator",
      },
    });

    await this.postEvent({
      ...this.buildVisitorPayload(visitor),
      event_type: "feature_usage",
      page_path: "/checkout",
      ...this.buildExperimentPayload({
        experimentId: experiment.key,
        variationId: assignment.id,
        featureKey: experiment.featureKey,
        featureValue: assignment.value,
      }),
      properties: {
        source: "simulator",
      },
    });

    if (Math.random() < Math.min(0.6 * conversionMultiplier, 0.95)) {
      await this.postEvent({
        ...this.buildVisitorPayload(visitor),
        event_type: "add_to_cart",
        page_path: "/cart",
      });
    }

    if (Math.random() < Math.min(0.3 * conversionMultiplier, 0.95)) {
      await this.postEvent({
        ...this.buildVisitorPayload(visitor),
        event_type: "checkout_start",
        page_path: "/checkout",
      });

      const amount =
        ORDER_AMOUNTS[Math.floor(Math.random() * ORDER_AMOUNTS.length)];
      const coupon =
        COUPON_CODES[Math.floor(Math.random() * COUPON_CODES.length)];

      await this.postOrder({
        ...this.buildVisitorPayload(visitor),
        amount,
        coupon_code: coupon,
      });
    }

    if (Math.random() < 0.08) {
      await this.postEvent({
        ...this.buildVisitorPayload(visitor),
        event_type: "signup",
        page_path: "/account",
      });
    }
  }

  apiHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (this.config.api.apiKey) {
      headers["x-api-key"] = this.config.api.apiKey;
    }

    return headers;
  }

  classifyEventCategory(eventType) {
    if (eventType === "experiment_viewed" || eventType === "viewed_experiment") {
      return "exposure";
    }

    if (eventType === "feature_usage" || eventType === "feature_evaluated") {
      return "feature";
    }

    return "event";
  }

  describeEvent(payload) {
    if (payload.event_type === "experiment_viewed") {
      return `experiment ${payload.experiment_id} → ${payload.variation_id}`;
    }

    if (payload.event_type === "feature_usage") {
      return `feature ${payload.feature_key} = ${payload.feature_value}`;
    }

    return `${payload.event_type} — ${payload.user_id?.substring(0, 14) ?? "anon"}`;
  }

  async postEvent(payload) {
    try {
      const res = await fetch(this.config.api.eventsEndpoint, {
        method: "POST",
        headers: this.apiHeaders(),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        return false;
      }

      this.counts.events++;
      if (payload.user_id) {
        this.uniqueUsers.add(payload.user_id);
      }
      this.recordEvent(
        this.classifyEventCategory(payload.event_type),
        this.describeEvent(payload),
      );
      return true;
    } catch {
      return false;
    }
  }

  async postOrder(payload) {
    try {
      const res = await fetch(this.config.api.ordersEndpoint, {
        method: "POST",
        headers: this.apiHeaders(),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        return false;
      }

      this.counts.orders++;
      this.counts.revenue += payload.amount;
      if (payload.user_id) {
        this.uniqueUsers.add(payload.user_id);
      }
      this.recordEvent(
        "order",
        `order $${payload.amount.toFixed(2)} — ${payload.user_id?.substring(0, 14) ?? "anon"}`,
      );
      return true;
    } catch {
      return false;
    }
  }

  async sendManualEvent() {
    const eventType = document.getElementById("eventType")?.value;
    const pagePath = document.getElementById("manualPagePath")?.value || null;
    const success = await this.postEvent({
      ...this.buildVisitorPayload(),
      event_type: eventType,
      page_path: pagePath,
    });

    this.showNotification(success ? "Event sent" : "Event failed", success ? "success" : "error");
  }

  async sendManualOrder() {
    const amount = parseFloat(document.getElementById("orderAmount")?.value);
    const coupon = document.getElementById("orderCoupon")?.value || null;
    if (!amount || Number.isNaN(amount)) {
      this.showNotification("Enter a valid amount", "error");
      return;
    }

    const success = await this.postOrder({
      ...this.buildVisitorPayload(),
      amount,
      coupon_code: coupon,
    });

    this.showNotification(success ? "Order sent" : "Order failed", success ? "success" : "error");
  }

  async sendExposureEvent() {
    const success = await this.postEvent({
      ...this.buildVisitorPayload(),
      event_type: "experiment_viewed",
      page_path: "/checkout",
      ...this.buildExperimentPayload(),
    });

    this.showNotification(
      success ? "Exposure event sent" : "Exposure event failed",
      success ? "success" : "error",
    );
  }

  async sendFeatureUsageEvent() {
    const success = await this.postEvent({
      ...this.buildVisitorPayload(),
      event_type: "feature_usage",
      page_path: "/checkout",
      ...this.buildExperimentPayload(),
    });

    this.showNotification(
      success ? "Feature usage sent" : "Feature usage failed",
      success ? "success" : "error",
    );
  }

  recordEvent(category, description) {
    this.eventHistory.push({ category, description, timestamp: new Date() });
    if (this.eventHistory.length > 5000) {
      this.eventHistory.shift();
    }

    this.updateEventLog();
    this.updateMetrics();
    this.drawTimeline();
  }

  updateEventLog() {
    const list = document.getElementById("eventLog");
    const countEl = document.getElementById("eventLogCount");
    if (!list) {
      return;
    }

    const recent = this.eventHistory.slice(-10).reverse();
    list.innerHTML = "";

    if (!recent.length) {
      const li = document.createElement("li");
      li.className = "empty-state";
      li.textContent = "No events recorded yet.";
      list.appendChild(li);
    } else {
      recent.forEach((eventItem) => {
        const li = document.createElement("li");
        li.className = "event-log-item";

        const meta = document.createElement("div");
        meta.className = "event-log-meta";

        const category = document.createElement("span");
        category.textContent = eventItem.category.toUpperCase();

        const time = document.createElement("span");
        time.textContent = eventItem.timestamp.toLocaleTimeString();

        meta.appendChild(category);
        meta.appendChild(time);

        const desc = document.createElement("div");
        desc.className = "event-log-description";
        desc.textContent = eventItem.description;

        li.appendChild(meta);
        li.appendChild(desc);
        list.appendChild(li);
      });
    }

    if (countEl) {
      const count = this.eventHistory.length;
      countEl.textContent = `${count} ${count === 1 ? "event" : "events"}`;
    }
  }

  updateMetrics() {
    document.getElementById("totalEvents").textContent = this.counts.events;
    document.getElementById("totalOrders").textContent = this.counts.orders;
    document.getElementById("totalRevenue").textContent =
      `$${this.counts.revenue.toFixed(2)}`;
    document.getElementById("uniqueUsers").textContent = this.uniqueUsers.size;

    const lastEvent = this.eventHistory[this.eventHistory.length - 1];
    if (lastEvent) {
      document.getElementById("lastEventType").textContent = lastEvent.category;
    }

    const summary = document.getElementById("timelineSummary");
    if (summary && this.eventHistory.length) {
      summary.textContent =
        `${this.eventHistory.length} events · $${this.counts.revenue.toFixed(2)} revenue`;
    }
  }

  async checkApiHealth() {
    const el = document.getElementById("apiStatus");
    if (!el) {
      return;
    }

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
    if (!this.timelineCanvas) {
      return;
    }

    const container = this.timelineCanvas.parentElement;
    if (!container) {
      return;
    }

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
    if (!this.timelineCtx) {
      return;
    }

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

    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    if (!this.eventHistory.length) {
      ctx.fillStyle = "#6b7280";
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

    events.forEach((eventItem) => {
      const key = eventItem.category;
      if (!categories[key]) {
        categories[key] = {
          color: this.timelineCategoryColors[key] || "#475569",
          points: [],
        };
        cumulativeCounts[key] = 0;
      }

      cumulativeCounts[key] += 1;
      categories[key].points.push({
        t: eventItem.timestamp.getTime(),
        count: cumulativeCounts[key],
      });
    });

    const categoryEntries = Object.entries(categories).filter(
      ([, data]) => data.points.length,
    );
    const maxCount = categoryEntries.length
      ? Math.max(
          ...categoryEntries.map(([, data]) => data.points[data.points.length - 1].count),
        )
      : 1;
    const yTicks = Math.min(maxCount, 4);

    for (let i = 0; i <= yTicks; i++) {
      const fraction = yTicks === 0 ? 0 : i / yTicks;
      const y = height - padding - fraction * chartHeight;
      ctx.strokeStyle = i === 0 ? "#cbd5e1" : "#eef2f7";
      ctx.lineWidth = i === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
      ctx.fillStyle = "#6b7280";
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
      data.points.forEach((point, index) => {
        const x = padding + ((point.t - startTime) / timeSpan) * chartWidth;
        const y = height - padding - (point.count / maxCount) * chartHeight;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
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

    ctx.fillStyle = "#6b7280";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(new Date(startTime).toLocaleTimeString(), padding, height - padding + 20);
    ctx.textAlign = "right";
    ctx.fillText(new Date(endTime).toLocaleTimeString(), width - padding, height - padding + 20);

    ctx.restore();
  }

  showNotification(message, type = "info") {
    const container = document.getElementById("notifications");
    if (!container) {
      return;
    }

    const el = document.createElement("div");
    el.className = `notification notification-${type}`;
    el.textContent = message;
    container.appendChild(el);

    setTimeout(() => {
      el.style.animation = "slideOut 0.3s ease forwards";
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  generateRandomString(length) {
    const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
    let result = "";
    const cryptoObj =
      (typeof window !== "undefined" && window.crypto) ||
      (typeof self !== "undefined" && self.crypto) ||
      null;

    if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
      const bytes = new Uint8Array(length);
      cryptoObj.getRandomValues(bytes);
      for (let i = 0; i < length; i++) {
        result += chars[bytes[i] % chars.length];
      }
      return result;
    }

    while (result.length < length) {
      result += Math.random().toString(36).slice(2);
    }

    return result.slice(0, length);
  }

  randomUserId() {
    return `user_${this.generateRandomString(9)}`;
  }

  randomSessionId() {
    return `sess_${this.generateRandomString(9)}`;
  }

  randomDeviceType() {
    return DEVICE_TYPES[Math.floor(Math.random() * DEVICE_TYPES.length)];
  }

  randomCountry() {
    return COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
  }

  randomReferrer() {
    return REFERRERS[Math.floor(Math.random() * REFERRERS.length)];
  }

  hashToUnitInterval(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0) / 4294967295;
  }

  readJsonFromStorage(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

document.addEventListener("DOMContentLoaded", () => new StreamingDemo());
