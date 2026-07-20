(() => {
  const state = {
    accessToken: "",
    staffUser: null,
    selectedConversationPhone: ""
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setStatus(form, message, type = "") {
    const box = $(".form-status", form);
    if (!box) return;
    box.className = `form-status ${type}`;
    box.textContent = message || "";
  }

  function setLoading(form, loading) {
    $$("button", form).forEach((button) => {
      button.disabled = loading;
      if (loading && !button.dataset.originalText) button.dataset.originalText = button.textContent;
      if (loading) button.textContent = "Working...";
      if (!loading && button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
      }
    });
  }

  function formPayload(form) {
    const data = {};
    new FormData(form).forEach((value, key) => {
      const field = form.elements[key];
      if (field?.type === "checkbox") data[key] = field.checked;
      else if (field?.type === "number") data[key] = Number(value);
      else data[key] = String(value).trim();
    });
    $$("input[type='checkbox']", form).forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(data, field.name)) data[field.name] = false;
    });
    return data;
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const init = {
      method: options.method || "GET",
      credentials: "include",
      headers
    };

    if (options.auth && state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    let response = await fetch(path, init);
    if (response.status === 401 && options.auth && !options._retried) {
      const refreshed = await refreshSession(false);
      if (refreshed) return api(path, { ...options, _retried: true });
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.error?.message || `Request failed: ${response.status}`);
    }
    return data;
  }

  async function refreshSession(throwOnError = true) {
    try {
      const data = await api("/api/auth/refresh", { method: "POST" });
      state.accessToken = data.accessToken;
      state.staffUser = data.user;
      return true;
    } catch (error) {
      state.accessToken = "";
      state.staffUser = null;
      if (throwOnError) throw error;
      return false;
    }
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  async function populateSlots(form) {
    const dateInput = $("input[name='date']", form);
    const timeSelect = $("select[name='time']", form);
    if (!dateInput || !timeSelect || !dateInput.value) return;
    timeSelect.innerHTML = "<option value=''>Loading slots...</option>";
    try {
      const data = await api(`/api/availability/slots?date=${encodeURIComponent(dateInput.value)}`);
      const available = data.slots.filter((slot) => slot.available);
      if (!available.length) {
        timeSelect.innerHTML = "<option value=''>No available slots</option>";
        return;
      }
      timeSelect.innerHTML = "<option value=''>Select time</option>" + available
        .map((slot) => `<option value="${escapeHtml(slot.time)}">${escapeHtml(slot.time)}</option>`)
        .join("");
    } catch (error) {
      timeSelect.innerHTML = "<option value=''>Unable to load slots</option>";
    }
  }

  function bindSlotLoaders() {
    ["booking-form", "reschedule-form", "manual-form"].forEach((id) => {
      const form = document.getElementById(id);
      const dateInput = form?.querySelector("input[name='date']");
      if (!form || !dateInput) return;
      dateInput.min = todayIso();
      dateInput.addEventListener("change", () => populateSlots(form));
    });
  }

  function updateTokenCard(appointment) {
    const card = $("#token-card");
    if (!card || !appointment) return;
    card.classList.remove("empty");
    Object.entries({
      appointmentId: appointment.appointmentId,
      tokenNumber: appointment.tokenNumber,
      date: appointment.date,
      time: appointment.time,
      status: appointment.status
    }).forEach(([key, value]) => {
      const target = card.querySelector(`[data-token='${key}']`);
      if (target) target.textContent = value || "---";
    });
  }

  async function handlePublicForm(form, path, successText) {
    setLoading(form, true);
    setStatus(form, "Submitting securely...");
    try {
      const data = await api(path, { method: "POST", body: formPayload(form) });
      updateTokenCard(data.appointment);
      setStatus(form, successText, "success");
      if (path === "/api/appointments") form.reset();
    } catch (error) {
      setStatus(form, error.message, "error");
    } finally {
      setLoading(form, false);
    }
  }

  function bindPublicForms() {
    $("#booking-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      handlePublicForm(event.currentTarget, "/api/appointments", "Appointment created successfully.");
    });
    $("#lookup-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      handlePublicForm(event.currentTarget, "/api/appointments/lookup", "Appointment found.");
    });
    $("#reschedule-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      handlePublicForm(event.currentTarget, "/api/appointments/reschedule", "Appointment rescheduled successfully.");
    });
    $("#cancel-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      handlePublicForm(event.currentTarget, "/api/appointments/cancel", "Appointment cancelled successfully.");
    });
  }

  function bindTabs() {
    $$("[data-public-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        $$("[data-public-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
        $$(".form-panels .panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === button.dataset.publicTab));
      });
    });

    $$("[data-staff-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        $$("[data-staff-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
        $$(".staff-panel").forEach((panel) => panel.classList.toggle("active", panel.id === button.dataset.staffTab));
      });
    });
  }

  async function loadPublicSettings() {
    try {
      const [doctorData] = await Promise.all([
        api("/api/settings/doctor-profile"),
        api("/api/settings/clinic")
      ]);
      const profile = doctorData.doctorProfile || {};
      $("#doctor-name").textContent = profile.doctorName || "Dr. Khurram";
      $("#doctor-contact").textContent = profile.contactNumber || "+92 335 7504478";
      $("#doctor-specialty").textContent = profile.specialty || "Pending verification";
      $("#doctor-qualifications").textContent = profile.qualifications || "Pending verification";
      $("#doctor-experience").textContent = profile.experience || "Pending verification";
      $("#doctor-location").textContent = profile.clinicLocation || "Pending verification";
      $("#doctor-biography").textContent = profile.biography || "Staff can add the verified professional biography after approval.";
      if (profile.profileImageUrl) $("#doctor-image").src = profile.profileImageUrl;
    } catch (error) {
      console.warn("Settings load failed", error.message);
    }
  }

  async function initStaffAuth() {
    const setupForm = $("#setup-form");
    const loginForm = $("#login-form");
    try {
      const status = await api("/api/auth/setup-status");
      setupForm.classList.toggle("hidden", !status.setupRequired);
      loginForm.classList.toggle("hidden", status.setupRequired);
      await refreshSession(false);
      if (state.accessToken) showDashboard();
    } catch (error) {
      loginForm.classList.remove("hidden");
    }
  }

  function showDashboard() {
    $("#staff-auth").classList.add("hidden");
    $("#staff-dashboard").classList.remove("hidden");
    $("#staff-user").textContent = state.staffUser?.name || "Signed in";
    $("#staff-role").textContent = state.staffUser?.role || "";
    loadDashboardData();
  }

  function showLogin() {
    $("#staff-auth").classList.remove("hidden");
    $("#staff-dashboard").classList.add("hidden");
    $("#setup-form").classList.add("hidden");
    $("#login-form").classList.remove("hidden");
  }

  function bindAuthForms() {
    $("#setup-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      setLoading(form, true);
      setStatus(form, "Creating Super Admin...");
      try {
        await api("/api/auth/setup", { method: "POST", body: formPayload(form) });
        setStatus(form, "Super Admin created. Please sign in.", "success");
        $("#login-form").classList.remove("hidden");
      } catch (error) {
        setStatus(form, error.message, "error");
      } finally {
        setLoading(form, false);
      }
    });

    $("#login-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      setLoading(form, true);
      setStatus(form, "Signing in...");
      try {
        const data = await api("/api/auth/login", { method: "POST", body: formPayload(form) });
        state.accessToken = data.accessToken;
        state.staffUser = data.user;
        setStatus(form, "Signed in.", "success");
        showDashboard();
      } catch (error) {
        setStatus(form, error.message, "error");
      } finally {
        setLoading(form, false);
      }
    });

    $("#logout-button")?.addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST" }).catch(() => {});
      state.accessToken = "";
      state.staffUser = null;
      showLogin();
    });
  }

  function appointmentQuery() {
    const params = new URLSearchParams();
    const search = $("#appointment-search").value.trim();
    const date = $("#appointment-date-filter").value;
    const status = $("#appointment-status-filter").value;
    if (search) params.set("search", search);
    if (date) params.set("date", date);
    if (status) params.set("status", status);
    return params.toString();
  }

  async function loadAppointments() {
    const target = $("#appointments-table");
    target.className = "table-card empty-state";
    target.textContent = "Loading appointments...";
    try {
      const qs = appointmentQuery();
      const data = await api(`/api/appointments${qs ? `?${qs}` : ""}`, { auth: true });
      if (!data.appointments.length) {
        target.textContent = "No appointments match the current filters.";
        return;
      }
      target.className = "table-card";
      target.innerHTML = `
        <table>
          <thead><tr><th>ID</th><th>Patient</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${data.appointments.map((appointment) => `
              <tr>
                <td><strong>${escapeHtml(appointment.appointmentId)}</strong><br><span class="badge">Token ${escapeHtml(appointment.tokenNumber)}</span></td>
                <td>${escapeHtml(appointment.patientSnapshot?.fullName)}<br>${escapeHtml(appointment.patientSnapshot?.phoneMasked)}</td>
                <td>${escapeHtml(appointment.date)}<br>${escapeHtml(appointment.time)}</td>
                <td><span class="badge">${escapeHtml(appointment.status)}</span><br>${escapeHtml(appointment.reminderStatus)}</td>
                <td>
                  <button class="button ghost" type="button" data-status="visited" data-id="${escapeHtml(appointment._id)}">Visited</button>
                  <button class="button ghost" type="button" data-status="no_show" data-id="${escapeHtml(appointment._id)}">No-show</button>
                  <button class="button ghost" type="button" data-reschedule="${escapeHtml(appointment.appointmentId)}">Reschedule</button>
                  <button class="button danger" type="button" data-cancel="${escapeHtml(appointment.appointmentId)}">Cancel</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>`;
    } catch (error) {
      target.className = "table-card empty-state";
      target.textContent = error.message;
    }
  }

  function bindAppointmentActions() {
    ["appointment-search", "appointment-date-filter", "appointment-status-filter"].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", () => loadAppointments());
    });
    $("#refresh-appointments")?.addEventListener("click", loadAppointments);
    $("#appointments-table")?.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      try {
        if (button.dataset.status) {
          await api(`/api/appointments/${button.dataset.id}/status`, {
            method: "PATCH",
            auth: true,
            body: { status: button.dataset.status }
          });
        }
        if (button.dataset.cancel) {
          const reason = prompt("Cancellation reason") || "Cancelled by staff";
          await api(`/api/appointments/${button.dataset.cancel}/cancel`, {
            method: "POST",
            auth: true,
            body: { reason }
          });
        }
        if (button.dataset.reschedule) {
          const date = prompt("New date (YYYY-MM-DD)");
          const time = prompt("New time (HH:mm)");
          if (!date || !time) return;
          await api(`/api/appointments/${button.dataset.reschedule}/reschedule`, {
            method: "POST",
            auth: true,
            body: { date, time, reason: "Rescheduled by staff" }
          });
        }
        loadAppointments();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  async function loadConversations() {
    const list = $("#conversation-list");
    list.className = "list-card empty-state";
    list.textContent = "Loading conversations...";
    try {
      const data = await api("/api/whatsapp/conversations", { auth: true });
      if (!data.conversations.length) {
        list.textContent = "No WhatsApp conversations yet.";
        return;
      }
      list.className = "list-card";
      list.innerHTML = data.conversations.map((conversation) => `
        <button class="list-item" type="button" data-phone="${escapeHtml(conversation.phoneE164)}">
          <strong>${escapeHtml(conversation.phoneE164)}</strong>
          <span>${escapeHtml(conversation.intent)} · ${escapeHtml(conversation.state)}</span>
          <span class="badge">${conversation.aiPaused ? "Staff takeover" : conversation.humanRequired ? "Needs staff" : "AI active"}</span>
        </button>
      `).join("");
    } catch (error) {
      list.textContent = error.message;
    }
  }

  async function loadMessages(phone) {
    state.selectedConversationPhone = phone;
    const box = $("#message-list");
    box.className = "message-list empty-state";
    box.textContent = "Loading messages...";
    try {
      const data = await api(`/api/whatsapp/conversations/${encodeURIComponent(phone)}/messages`, { auth: true });
      box.className = "message-list";
      box.innerHTML = `
        <div class="toolbar">
          <button class="button ghost" type="button" data-takeover="${escapeHtml(phone)}">Take over</button>
          <button class="button ghost" type="button" data-release="${escapeHtml(phone)}">Return to AI</button>
        </div>
        ${data.messages.reverse().map((message) => `
          <div class="message ${message.direction === "outgoing" ? "outgoing" : ""}">
            ${escapeHtml(message.body || message.messageType)}
            <small>${escapeHtml(message.status)} · ${new Date(message.createdAt).toLocaleString()}</small>
          </div>
        `).join("") || "<p class='empty-state'>No messages in this conversation.</p>"}`;
    } catch (error) {
      box.textContent = error.message;
    }
  }

  function bindConversations() {
    $("#refresh-conversations")?.addEventListener("click", loadConversations);
    $("#conversation-list")?.addEventListener("click", (event) => {
      const item = event.target.closest("[data-phone]");
      if (!item) return;
      $$(".list-item", $("#conversation-list")).forEach((node) => node.classList.remove("active"));
      item.classList.add("active");
      loadMessages(item.dataset.phone);
    });
    $("#message-list")?.addEventListener("click", async (event) => {
      const takeover = event.target.closest("[data-takeover]")?.dataset.takeover;
      const release = event.target.closest("[data-release]")?.dataset.release;
      if (!takeover && !release) return;
      const phone = takeover || release;
      const action = takeover ? "takeover" : "release";
      try {
        await api(`/api/whatsapp/conversations/${encodeURIComponent(phone)}/${action}`, { method: "POST", auth: true });
        await loadConversations();
        await loadMessages(phone);
      } catch (error) {
        alert(error.message);
      }
    });
    $("#staff-message-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.selectedConversationPhone) {
        alert("Select a conversation first.");
        return;
      }
      const form = event.currentTarget;
      setLoading(form, true);
      try {
        await api(`/api/whatsapp/conversations/${encodeURIComponent(state.selectedConversationPhone)}/send`, {
          method: "POST",
          auth: true,
          body: formPayload(form)
        });
        form.reset();
        await loadMessages(state.selectedConversationPhone);
      } catch (error) {
        alert(error.message);
      } finally {
        setLoading(form, false);
      }
    });
  }

  async function loadSettingsForms() {
    try {
      const [doctor, clinic] = await Promise.all([
        api("/api/settings/doctor-profile"),
        api("/api/settings/clinic")
      ]);
      const doctorForm = $("#doctor-settings-form");
      Object.entries(doctor.doctorProfile || {}).forEach(([key, value]) => {
        if (doctorForm.elements[key]) doctorForm.elements[key].value = value || "";
      });
      const clinicForm = $("#clinic-settings-form");
      Object.entries(clinic.clinic || {}).forEach(([key, value]) => {
        if (clinicForm.elements[key]) clinicForm.elements[key].value = Array.isArray(value) ? value.join(",") : value || "";
      });
    } catch (error) {
      console.warn(error.message);
    }
  }

  function bindSettingsForms() {
    $("#doctor-settings-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      setLoading(form, true);
      setStatus(form, "Saving profile...");
      try {
        await api("/api/settings/doctor-profile", { method: "PUT", auth: true, body: formPayload(form) });
        setStatus(form, "Doctor profile saved.", "success");
        await loadPublicSettings();
      } catch (error) {
        setStatus(form, error.message, "error");
      } finally {
        setLoading(form, false);
      }
    });

    $("#clinic-settings-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = formPayload(form);
      payload.reminderIntervalsMinutes = String(payload.reminderIntervalsMinutes || "")
        .split(",")
        .map((item) => Number(item.trim()))
        .filter(Number.isFinite);
      payload.weeklyHours = [
        { day: 1, isOpen: true, start: "09:00", end: "16:00" },
        { day: 2, isOpen: true, start: "09:00", end: "16:00" },
        { day: 3, isOpen: true, start: "09:00", end: "16:00" },
        { day: 4, isOpen: true, start: "09:00", end: "16:00" },
        { day: 5, isOpen: true, start: "09:00", end: "16:00" },
        { day: 6, isOpen: false, start: "09:00", end: "16:00" },
        { day: 7, isOpen: false, start: "09:00", end: "16:00" }
      ];
      setLoading(form, true);
      setStatus(form, "Saving clinic settings...");
      try {
        await api("/api/settings/clinic", { method: "PUT", auth: true, body: payload });
        setStatus(form, "Clinic settings saved.", "success");
      } catch (error) {
        setStatus(form, error.message, "error");
      } finally {
        setLoading(form, false);
      }
    });

    $("#block-date-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      setLoading(form, true);
      setStatus(form, "Blocking date...");
      try {
        await api("/api/availability/block-date", { method: "POST", auth: true, body: formPayload(form) });
        setStatus(form, "Date blocked.", "success");
      } catch (error) {
        setStatus(form, error.message, "error");
      } finally {
        setLoading(form, false);
      }
    });

    $("[data-unblock-date]")?.addEventListener("click", async () => {
      const form = $("#block-date-form");
      setLoading(form, true);
      try {
        await api("/api/availability/unblock-date", { method: "POST", auth: true, body: { date: form.elements.date.value } });
        setStatus(form, "Date unblocked.", "success");
      } catch (error) {
        setStatus(form, error.message, "error");
      } finally {
        setLoading(form, false);
      }
    });

    $("#block-slot-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      setLoading(form, true);
      setStatus(form, "Blocking slot...");
      try {
        await api("/api/availability/block-slot", { method: "POST", auth: true, body: formPayload(form) });
        setStatus(form, "Slot blocked.", "success");
      } catch (error) {
        setStatus(form, error.message, "error");
      } finally {
        setLoading(form, false);
      }
    });

    $("[data-unblock-slot]")?.addEventListener("click", async () => {
      const form = $("#block-slot-form");
      setLoading(form, true);
      try {
        await api("/api/availability/unblock-slot", {
          method: "POST",
          auth: true,
          body: { date: form.elements.date.value, time: form.elements.time.value }
        });
        setStatus(form, "Slot unblocked.", "success");
      } catch (error) {
        setStatus(form, error.message, "error");
      } finally {
        setLoading(form, false);
      }
    });
  }

  function bindManualForm() {
    $("#manual-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      setLoading(form, true);
      setStatus(form, "Creating manual appointment...");
      try {
        const payload = { ...formPayload(form), consentGiven: true };
        await api("/api/appointments/manual", { method: "POST", auth: true, body: payload });
        setStatus(form, "Manual appointment created.", "success");
        form.reset();
        await loadAppointments();
      } catch (error) {
        setStatus(form, error.message, "error");
      } finally {
        setLoading(form, false);
      }
    });
  }

  async function loadUsers() {
    const target = $("#staff-users-list");
    target.className = "table-card empty-state";
    target.textContent = "Loading users...";
    try {
      const data = await api("/api/auth/users", { auth: true });
      if (!data.users.length) {
        target.textContent = "No staff users loaded.";
        return;
      }
      target.className = "table-card";
      target.innerHTML = `
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
          <tbody>${data.users.map((user) => `
            <tr>
              <td>${escapeHtml(user.name)}</td>
              <td>${escapeHtml(user.email)}</td>
              <td>${escapeHtml(user.role)}</td>
              <td>${user.isActive ? "Active" : "Inactive"}</td>
            </tr>
          `).join("")}</tbody>
        </table>`;
    } catch (error) {
      target.textContent = error.message;
    }
  }

  function bindUserForm() {
    $("#staff-user-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      setLoading(form, true);
      setStatus(form, "Creating staff user...");
      try {
        await api("/api/auth/users", { method: "POST", auth: true, body: formPayload(form) });
        setStatus(form, "Staff user created.", "success");
        form.reset();
        await loadUsers();
      } catch (error) {
        setStatus(form, error.message, "error");
      } finally {
        setLoading(form, false);
      }
    });
  }

  async function loadAuditLogs() {
    const target = $("#audit-list");
    target.className = "table-card empty-state";
    target.textContent = "Loading audit logs...";
    try {
      const data = await api("/api/settings/audit-logs?limit=100", { auth: true });
      if (!data.auditLogs.length) {
        target.textContent = "No audit logs yet.";
        return;
      }
      target.className = "table-card";
      target.innerHTML = `
        <table>
          <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th></tr></thead>
          <tbody>${data.auditLogs.map((log) => `
            <tr>
              <td>${new Date(log.createdAt).toLocaleString()}</td>
              <td>${escapeHtml(log.actorType)} ${escapeHtml(log.actorPhone || "")}</td>
              <td>${escapeHtml(log.action)}</td>
              <td>${escapeHtml(log.entityType)} ${escapeHtml(log.entityId || "")}</td>
            </tr>
          `).join("")}</tbody>
        </table>`;
    } catch (error) {
      target.textContent = error.message;
    }
  }

  function bindAudit() {
    $("#refresh-audit")?.addEventListener("click", loadAuditLogs);
  }

  function loadDashboardData() {
    loadAppointments();
    loadConversations();
    loadSettingsForms();
    loadUsers();
    loadAuditLogs();
  }

  function bindNavigation() {
    $(".menu-toggle")?.addEventListener("click", (event) => {
      const nav = $("#main-nav");
      const open = nav.classList.toggle("open");
      event.currentTarget.setAttribute("aria-expanded", String(open));
    });
    $$("#main-nav a").forEach((link) => {
      link.addEventListener("click", () => $("#main-nav").classList.remove("open"));
    });
  }

  function init() {
    $("#year").textContent = new Date().getFullYear();
    $$("input[type='date']").forEach((input) => {
      input.min = todayIso();
    });
    bindNavigation();
    bindTabs();
    bindSlotLoaders();
    bindPublicForms();
    bindAuthForms();
    bindAppointmentActions();
    bindConversations();
    bindSettingsForms();
    bindManualForm();
    bindUserForm();
    bindAudit();
    loadPublicSettings();
    initStaffAuth();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
