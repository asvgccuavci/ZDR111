import "./style.css";
import {
  fetchSystemStatus,
  queryStudentGrade,
  adminLogin,
  verifyAdminAuth,
  fetchAdminSettings,
  updateAdminSettings,
  fetchAdminLogs,
  clearAdminLogs,
  fetchAdminStudents,
  saveAdminStudent,
  deleteAdminStudent,
  setStoredToken,
} from "./api";
import type { StudentResult, Course, AdminStudent, AuditLog } from "./types";

// =========================================================================
// UI Helpers & Toasts
// =========================================================================
function showToast(message: string, type: "success" | "error" | "warning" | "info" = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const icons: Record<string, string> = {
    success: "✅",
    error: "❌",
    warning: "⚠️",
    info: "ℹ️",
  };

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || "ℹ️"}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// =========================================================================
// Initialization & Global State
// =========================================================================
let currentSystemStatus: any = null;
let currentAdminPage = 1;
let currentStudentSearch = "";

async function initSystem() {
  try {
    const status = await fetchSystemStatus();
    currentSystemStatus = status;

    // Update Status Pill
    const indicator = document.getElementById("statusIndicator");
    const statusText = document.getElementById("statusText");
    if (indicator && statusText) {
      if (status.allowQuery) {
        indicator.className = "status-pill";
        statusText.textContent = "成绩查询通道开放中";
      } else {
        indicator.className = "status-pill disabled";
        statusText.textContent = "通道维护 / 暂停查询";
      }
    }

    // Update Student Count
    const countEl = document.getElementById("totalStudentsCount");
    if (countEl && status.totalStudents) {
      countEl.textContent = String(status.totalStudents);
    }

    // Populate class datalist
    const datalist = document.getElementById("classList");
    if (datalist && status.classes) {
      datalist.innerHTML = status.classes.map(c => `<option value="${c}">`).join("");
      const hint = document.getElementById("classCountHint");
      if (hint) hint.textContent = `${status.classes.length}个班级`;
    }

    // Show announcement if present
    const announcementBanner = document.getElementById("announcementBanner");
    const announcementText = document.getElementById("announcementText");
    if (announcementBanner && announcementText && status.announcement) {
      announcementText.textContent = status.announcement;
      announcementBanner.style.display = "flex";
    }
  } catch (err) {
    console.error("Failed to load system status:", err);
  }
}

// =========================================================================
// Student Query & Grade Rendering
// =========================================================================
function calculateGPA(courses: Course[]) {
  let totalCredits = 0;
  let weightedSum = 0;
  let gpaSum = 0;
  let passedCredits = 0;

  courses.forEach(c => {
    totalCredits += c.credit;
    weightedSum += c.score * c.credit;
    if (c.score >= 60) passedCredits += c.credit;

    // 4.0 GPA standard
    let gpaPoint = 0;
    if (c.score >= 90) gpaPoint = 4.0;
    else if (c.score >= 85) gpaPoint = 3.7;
    else if (c.score >= 82) gpaPoint = 3.3;
    else if (c.score >= 78) gpaPoint = 3.0;
    else if (c.score >= 75) gpaPoint = 2.7;
    else if (c.score >= 72) gpaPoint = 2.3;
    else if (c.score >= 68) gpaPoint = 2.0;
    else if (c.score >= 64) gpaPoint = 1.5;
    else if (c.score >= 60) gpaPoint = 1.0;
    else gpaPoint = 0;

    gpaSum += gpaPoint * c.credit;
  });

  const avgScore = totalCredits > 0 ? (weightedSum / totalCredits).toFixed(2) : "0.00";
  const gpa = totalCredits > 0 ? (gpaSum / totalCredits).toFixed(2) : "0.00";

  return { totalCredits, passedCredits, avgScore, gpa };
}

function renderGradeReport(student: StudentResult) {
  const container = document.getElementById("resultContainer");
  if (!container) return;

  const { totalCredits, passedCredits, avgScore, gpa } = calculateGPA(student.courses);
  const formattedTime = new Date(student.queryTimestamp).toLocaleString("zh-CN");

  // Generate dynamic watermark items
  const watermarkText = `${student.name} · ${student.maskedStudentId} · ${formattedTime}`;
  const watermarks = Array.from({ length: 8 })
    .map(() => `<div class="watermark-item">${watermarkText}</div>`)
    .join("");

  // Generate course table rows
  const courseRows = student.courses
    .map(c => {
      let levelClass = "good";
      let levelText = "良好";
      if (c.score >= 90) {
        levelClass = "excellent";
        levelText = "优秀";
      } else if (c.score >= 75) {
        levelClass = "good";
        levelText = "良好";
      } else if (c.score >= 60) {
        levelClass = "pass";
        levelText = "及格";
      } else {
        levelClass = "fail";
        levelText = "不合格/重修";
      }

      return `
        <tr>
          <td>
            <div style="font-weight: 600; color: #f1f5f9;">${c.name}</div>
          </td>
          <td style="color: #94a3b8;">${c.credit.toFixed(1)} 学分</td>
          <td class="score-cell">
            <span class="score-badge ${levelClass}">${c.score.toFixed(1)}</span>
          </td>
          <td>
            <span style="font-size: 12px; color: ${c.score >= 60 ? '#34d399' : '#f87171'}; font-weight: 600;">
              ${levelText}
            </span>
          </td>
        </tr>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="grade-report-card" id="printableTranscript">
      <!-- Watermark overlay -->
      <div class="watermark-overlay">
        ${watermarks}
      </div>

      <!-- Student Banner -->
      <div class="student-banner">
        <div class="student-info-meta">
          <div class="student-avatar">${student.name.slice(0, 1)}</div>
          <div class="student-details">
            <h2>
              ${student.name}
              <span class="class-tag">${student.className}</span>
            </h2>
            <div class="student-meta-list">
              <span>学号: <strong>${student.maskedStudentId}</strong></span>
              <span>学院: <strong>自动化工程学院</strong></span>
              <span>查询验证时间: <strong>${formattedTime}</strong></span>
            </div>
          </div>
        </div>

        <div class="student-metrics">
          <div class="metric-box">
            <div class="val">${avgScore}</div>
            <div class="label">加权平均分</div>
          </div>
          <div class="metric-box">
            <div class="val">${gpa}</div>
            <div class="label">平均学分绩点(GPA)</div>
          </div>
          <div class="metric-box">
            <div class="val">${totalCredits.toFixed(1)}</div>
            <div class="label">已修总学分</div>
          </div>
        </div>
      </div>

      <!-- Course Grade Table -->
      <div class="grade-table-wrapper">
        <div class="table-header-bar">
          <h3><span>📚</span> 课程考核成绩通知清单 (${student.courses.length} 门)</h3>
          <span style="font-size: 12.5px; color: #34d399; font-weight: 600;">
            已获学分：${passedCredits.toFixed(1)} / ${totalCredits.toFixed(1)}
          </span>
        </div>

        <div style="overflow-x: auto;">
          <table class="grade-table">
            <thead>
              <tr>
                <th>课程名称</th>
                <th>学分</th>
                <th>成绩 / 得分</th>
                <th>考核等级</th>
              </tr>
            </thead>
            <tbody>
              ${courseRows}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Report Footer with digital verification code -->
      <div class="report-footer">
        <div class="verification-meta">
          <div>数字防伪校验码: <span class="verification-code">${student.verificationCode}</span></div>
          <div>本成绩单由东北电力大学自动化工程学院教务管理与成绩发布系统生成</div>
        </div>
        <div class="report-actions">
          <button id="printReportBtn" class="btn btn-secondary" style="padding: 6px 14px; font-size: 12.5px;">
            🖨️ 打印 / 保存为PDF
          </button>
          <button id="copySummaryBtn" class="btn btn-secondary" style="padding: 6px 14px; font-size: 12.5px;">
            📋 复制成绩摘要
          </button>
        </div>
      </div>
    </div>
  `;

  // Attach Print and Copy Actions
  document.getElementById("printReportBtn")?.addEventListener("click", () => {
    window.print();
  });

  document.getElementById("copySummaryBtn")?.addEventListener("click", () => {
    const summary = `【东北电力大学自动化工程学院·成绩单】\n学生：${student.name}（${student.className}）\n加权平均分：${avgScore}分 | GPA：${gpa}\n总学分：${totalCredits}学分 | 课程数：${student.courses.length}门\n防伪校验码：${student.verificationCode}`;
    navigator.clipboard.writeText(summary).then(() => {
      showToast("成绩摘要已复制到剪贴板", "success");
    });
  });
}

// =========================================================================
// Form Submissions & Event Listeners
// =========================================================================
function setupEventListeners() {
  // Toggle password visibility
  const togglePwBtn = document.getElementById("togglePwBtn");
  const queryPwInput = document.getElementById("queryPassword") as HTMLInputElement;
  if (togglePwBtn && queryPwInput) {
    togglePwBtn.addEventListener("click", () => {
      if (queryPwInput.type === "password") {
        queryPwInput.type = "text";
        togglePwBtn.textContent = "🔒";
      } else {
        queryPwInput.type = "password";
        togglePwBtn.textContent = "👁️";
      }
    });
  }

  // Auto-format birth date (digits only, max 8)
  queryPwInput?.addEventListener("input", () => {
    queryPwInput.value = queryPwInput.value.replace(/\D/g, "").slice(0, 8);
  });

  // Quick class chips
  document.querySelectorAll(".chip[data-class]").forEach(chip => {
    chip.addEventListener("click", () => {
      const cls = chip.getAttribute("data-class") || "";
      const classInput = document.getElementById("queryClass") as HTMLInputElement;
      if (classInput) {
        classInput.value = cls;
        classInput.focus();
      }
    });
  });

  // Reset form button
  document.getElementById("resetSearchBtn")?.addEventListener("click", () => {
    (document.getElementById("gradeQueryForm") as HTMLFormElement)?.reset();
    const container = document.getElementById("resultContainer");
    if (container) {
      container.innerHTML = `
        <div class="empty-placeholder">
          <div class="icon">📑</div>
          <h3>暂无查询结果</h3>
          <p>请在上表单中完整输入班级、姓名及8位出生年月密码后点击“立即查询”</p>
        </div>
      `;
    }
  });

  // Close announcement banner
  document.getElementById("closeAnnouncementBtn")?.addEventListener("click", () => {
    const banner = document.getElementById("announcementBanner");
    if (banner) banner.style.display = "none";
  });

  // Main Query Form Submit
  document.getElementById("gradeQueryForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const className = (document.getElementById("queryClass") as HTMLInputElement)?.value.trim();
    const name = (document.getElementById("queryName") as HTMLInputElement)?.value.trim();
    const password = (document.getElementById("queryPassword") as HTMLInputElement)?.value.trim();

    if (!className || !name || !password) {
      showToast("请完整填写班级、姓名和8位出生年月密码", "warning");
      return;
    }

    if (password.length !== 8) {
      showToast("密码格式须为8位出生年月，例如 20060119", "warning");
      return;
    }

    const submitBtn = document.getElementById("submitSearchBtn") as HTMLButtonElement;
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>⏳ 正在多维鉴权核验...</span>`;

    try {
      const res = await queryStudentGrade({ className, name, password });
      if (res.ok && res.student) {
        showToast(`验证通过！欢迎 ${res.student.name} 同学`, "success");
        renderGradeReport(res.student);
      } else {
        showToast(res.message || "查询失败，请核对信息", "error");
        const container = document.getElementById("resultContainer");
        if (container) {
          container.innerHTML = `
            <div class="empty-placeholder" style="border-color: rgba(239, 68, 68, 0.3);">
              <div class="icon" style="color: #f87171;">⚠️</div>
              <h3 style="color: #f87171;">${res.message || "未查到成绩"}</h3>
              <p>${res.code === "QUERY_DISABLED" ? "请留意学院教务处最新开放通知" : "请确认班级名称、姓名及8位出生年月是否完全匹配"}</p>
            </div>
          `;
        }
      }
    } catch (err) {
      console.error("Query failed:", err);
      showToast("网络通信异常，请稍后再试", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  });

  // =========================================================================
  // Admin Management Portal
  // =========================================================================
  const openAdminBtn = document.getElementById("openAdminBtn");
  const adminLoginModal = document.getElementById("adminLoginModal");
  const adminConsoleModal = document.getElementById("adminConsoleModal");
  const closeAdminLoginModal = document.getElementById("closeAdminLoginModal");
  const closeAdminConsoleModal = document.getElementById("closeAdminConsoleModal");

  openAdminBtn?.addEventListener("click", async () => {
    const isAuthed = await verifyAdminAuth();
    if (isAuthed) {
      openAdminConsole();
    } else {
      if (adminLoginModal) adminLoginModal.style.display = "flex";
    }
  });

  closeAdminLoginModal?.addEventListener("click", () => {
    if (adminLoginModal) adminLoginModal.style.display = "none";
  });

  closeAdminConsoleModal?.addEventListener("click", () => {
    if (adminConsoleModal) adminConsoleModal.style.display = "none";
  });

  // Admin Login Form
  document.getElementById("adminLoginForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const username = (document.getElementById("adminUsername") as HTMLInputElement)?.value.trim();
    const password = (document.getElementById("adminPassword") as HTMLInputElement)?.value.trim();

    if (!username || !password) {
      showToast("请输入管理员账号及密码", "warning");
      return;
    }

    const loginBtn = document.getElementById("adminLoginBtn") as HTMLButtonElement;
    loginBtn.disabled = true;
    loginBtn.innerHTML = "<span>⏳ 鉴权核验中...</span>";

    try {
      const res = await adminLogin({ username, password });
      if (res.ok) {
        showToast("管理员身份认证成功！", "success");
        if (adminLoginModal) adminLoginModal.style.display = "none";
        openAdminConsole();
      } else {
        showToast(res.message || "管理员账号或密码错误", "error");
      }
    } catch (err) {
      showToast("认证请求失败，请检查网络", "error");
    } finally {
      loginBtn.disabled = false;
      loginBtn.innerHTML = "<span>🔓 登录管理控制台</span>";
    }
  });

  // Admin Logout
  document.getElementById("adminLogoutBtn")?.addEventListener("click", () => {
    setStoredToken(null);
    if (adminConsoleModal) adminConsoleModal.style.display = "none";
    showToast("已安全退出管理员控制台", "info");
  });

  // Admin Tabs Switching
  document.querySelectorAll(".tab-btn[data-tab]").forEach(tabBtn => {
    tabBtn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".admin-tab-pane").forEach(p => ((p as HTMLElement).style.display = "none"));

      tabBtn.classList.add("active");
      const targetId = tabBtn.getAttribute("data-tab");
      if (targetId) {
        const pane = document.getElementById(targetId);
        if (pane) pane.style.display = "block";
      }

      if (targetId === "tab-logs") loadAdminLogs();
      if (targetId === "tab-students") loadAdminStudents();
    });
  });

  // Master Query Switch Toggle
  const masterQuerySwitch = document.getElementById("masterQuerySwitch") as HTMLInputElement;
  const masterSwitchStatusText = document.getElementById("masterSwitchStatusText");
  masterQuerySwitch?.addEventListener("change", async () => {
    const isAllowed = masterQuerySwitch.checked;
    if (masterSwitchStatusText) {
      masterSwitchStatusText.textContent = isAllowed ? "已允许查询" : "已关闭/维护中";
      masterSwitchStatusText.style.color = isAllowed ? "var(--success)" : "var(--danger)";
    }
    const res = await updateAdminSettings({ allowQuery: isAllowed });
    if (res.ok) {
      showToast(`查成绩总开关已更新为：${isAllowed ? "【开启】" : "【关闭】"}`, isAllowed ? "success" : "warning");
      initSystem(); // refresh public status badge
    } else {
      showToast("更新开关状态失败", "error");
    }
  });

  // Save Settings Form
  document.getElementById("adminSettingsForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const announcement = (document.getElementById("settingAnnouncement") as HTMLTextAreaElement)?.value;
    const maintenanceReason = (document.getElementById("settingMaintenanceReason") as HTMLInputElement)?.value;
    const allowedClasses = (document.getElementById("settingAllowedClasses") as HTMLInputElement)?.value;
    const rateLimitMax = parseInt((document.getElementById("settingRateLimitMax") as HTMLInputElement)?.value, 10);
    const rateLimitLockout = parseInt((document.getElementById("settingRateLimitLockout") as HTMLInputElement)?.value, 10);

    const res = await updateAdminSettings({
      announcement,
      maintenanceReason,
      allowedClasses,
      rateLimitMax,
      rateLimitLockout,
    });

    if (res.ok) {
      showToast("系统安全及权限设置已成功保存", "success");
      initSystem();
    } else {
      showToast("设置保存失败", "error");
    }
  });

  // Logs Filter & Refresh
  document.getElementById("logStatusFilter")?.addEventListener("change", () => loadAdminLogs());
  document.getElementById("refreshLogsBtn")?.addEventListener("click", () => loadAdminLogs());

  document.getElementById("clearLogsBtn")?.addEventListener("click", async () => {
    if (confirm("确定要清空所有安全审计日志吗？")) {
      const res = await clearAdminLogs("clear_logs");
      if (res.ok) {
        showToast("日志已清空", "success");
        loadAdminLogs();
      }
    }
  });

  document.getElementById("unblockIpsBtn")?.addEventListener("click", async () => {
    const res = await clearAdminLogs("unblock_all_ips");
    if (res.ok) {
      showToast("所有IP访问限制已解除", "success");
      loadAdminLogs();
    }
  });

  // Student Search & Pagination
  document.getElementById("searchStudentBtn")?.addEventListener("click", () => {
    currentStudentSearch = (document.getElementById("studentSearchInput") as HTMLInputElement)?.value.trim();
    currentAdminPage = 1;
    loadAdminStudents();
  });

  document.getElementById("studentSearchInput")?.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      currentStudentSearch = (document.getElementById("studentSearchInput") as HTMLInputElement)?.value.trim();
      currentAdminPage = 1;
      loadAdminStudents();
    }
  });

  document.getElementById("prevPageBtn")?.addEventListener("click", () => {
    if (currentAdminPage > 1) {
      currentAdminPage--;
      loadAdminStudents();
    }
  });

  document.getElementById("nextPageBtn")?.addEventListener("click", () => {
    currentAdminPage++;
    loadAdminStudents();
  });

  document.getElementById("addNewStudentBtn")?.addEventListener("click", () => {
    openEditStudentModal();
  });

  // Save Student Form
  document.getElementById("editStudentForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const id = (document.getElementById("editStudentIdHidden") as HTMLInputElement)?.value;
    const studentId = (document.getElementById("editStudentId") as HTMLInputElement)?.value.trim();
    const name = (document.getElementById("editStudentName") as HTMLInputElement)?.value.trim();
    const className = (document.getElementById("editStudentClass") as HTMLInputElement)?.value.trim();
    const password = (document.getElementById("editStudentPassword") as HTMLInputElement)?.value.trim();
    const queryEnabled = (document.getElementById("editStudentQueryEnabled") as HTMLSelectElement)?.value === "true";
    const coursesJson = (document.getElementById("editStudentCoursesJson") as HTMLTextAreaElement)?.value.trim();

    let courses = [];
    try {
      courses = JSON.parse(coursesJson || "[]");
    } catch {
      showToast("课程JSON格式有误，请核对", "error");
      return;
    }

    const res = await saveAdminStudent({
      id: id || undefined,
      studentId,
      name,
      className,
      password,
      courses,
      queryEnabled,
    });

    if (res.ok) {
      showToast("学生记录已成功保存", "success");
      const editModal = document.getElementById("editStudentModal");
      if (editModal) editModal.style.display = "none";
      loadAdminStudents();
    } else {
      showToast("保存失败", "error");
    }
  });

  document.getElementById("closeEditStudentModal")?.addEventListener("click", () => {
    const editModal = document.getElementById("editStudentModal");
    if (editModal) editModal.style.display = "none";
  });
}

// =========================================================================
// Admin Console Data Loaders
// =========================================================================
async function openAdminConsole() {
  const consoleModal = document.getElementById("adminConsoleModal");
  if (consoleModal) consoleModal.style.display = "flex";

  // Load Settings
  try {
    const { settings } = await fetchAdminSettings();
    if (settings) {
      const masterQuerySwitch = document.getElementById("masterQuerySwitch") as HTMLInputElement;
      const masterSwitchStatusText = document.getElementById("masterSwitchStatusText");
      if (masterQuerySwitch) masterQuerySwitch.checked = settings.allowQuery;
      if (masterSwitchStatusText) {
        masterSwitchStatusText.textContent = settings.allowQuery ? "已允许查询" : "已关闭/维护中";
        masterSwitchStatusText.style.color = settings.allowQuery ? "var(--success)" : "var(--danger)";
      }

      (document.getElementById("settingAnnouncement") as HTMLTextAreaElement).value = settings.announcement || "";
      (document.getElementById("settingMaintenanceReason") as HTMLInputElement).value = settings.maintenanceReason || "";
      (document.getElementById("settingAllowedClasses") as HTMLInputElement).value = settings.allowedClasses || "ALL";
      (document.getElementById("settingRateLimitMax") as HTMLInputElement).value = String(settings.rateLimitMax || 5);
      (document.getElementById("settingRateLimitLockout") as HTMLInputElement).value = String(settings.rateLimitLockout || 15);
    }
  } catch (err) {
    console.error("Failed to load settings:", err);
  }
}

async function loadAdminLogs() {
  const statusFilter = (document.getElementById("logStatusFilter") as HTMLSelectElement)?.value;
  const tbody = document.getElementById("logsTableBody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px;">正在加载实时日志...</td></tr>`;

  try {
    const { stats, logs } = await fetchAdminLogs({ limit: 60, status: statusFilter || undefined });

    if (stats) {
      document.getElementById("statTotalQueries")!.textContent = String(stats.totalQueries);
      document.getElementById("statSuccessCount")!.textContent = String(stats.successCount);
      document.getElementById("statFailedCount")!.textContent = String(stats.failedCount);
      document.getElementById("statBlockedCount")!.textContent = String(stats.blockedCount + stats.rateLimitedCount);
    }

    if (!logs || logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--text-muted);">暂无审计日志记录</td></tr>`;
      return;
    }

    tbody.innerHTML = logs
      .map(log => {
        const timeStr = new Date(log.timestamp).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        return `
          <tr>
            <td style="font-family: var(--font-mono); font-size: 11.5px;">${timeStr}</td>
            <td style="font-family: var(--font-mono); color: var(--primary);">${log.ip}</td>
            <td><span style="font-weight: 600;">${log.action}</span></td>
            <td>${log.target || "--"}</td>
            <td><span class="log-badge ${log.status}">${log.status}</span></td>
            <td style="color: var(--text-muted); font-size: 11.5px;">${log.details || "--"}</td>
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: #f87171; padding: 20px;">加载日志失败</td></tr>`;
  }
}

async function loadAdminStudents() {
  const tbody = document.getElementById("studentTableBody");
  const paginationInfo = document.getElementById("studentPaginationInfo");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px;">正在查询学生名单...</td></tr>`;

  try {
    const res = await fetchAdminStudents({
      search: currentStudentSearch,
      page: currentAdminPage,
      pageSize: 20,
    });

    if (res.ok && res.students) {
      if (paginationInfo) {
        const total = res.total || 0;
        const totalPages = Math.ceil(total / 20) || 1;
        paginationInfo.textContent = `共 ${total} 名学生 · 第 ${res.page} / ${totalPages} 页`;
      }

      if (res.students.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px; color: var(--text-muted);">未找到匹配的学生记录</td></tr>`;
        return;
      }

      tbody.innerHTML = res.students
        .map(s => {
          return `
            <tr>
              <td style="font-family: var(--font-mono);">${s.studentId}</td>
              <td style="font-weight: 700; color: #fff;">${s.name}</td>
              <td><span class="chip">${s.className}</span></td>
              <td style="font-family: var(--font-mono); color: var(--primary);">${s.password || "20060101"}</td>
              <td>${s.courses.length} 门</td>
              <td>
                <span style="color: ${s.queryEnabled ? 'var(--success)' : 'var(--danger)'}; font-weight: 600;">
                  ${s.queryEnabled ? '● 正常' : '● 锁定'}
                </span>
              </td>
              <td>
                <button class="btn btn-secondary edit-student-btn" data-student='${JSON.stringify(s).replace(/'/g, "&apos;")}' style="padding: 3px 8px; font-size: 11.5px;">
                  编辑
                </button>
              </td>
            </tr>
          `;
        })
        .join("");

      // Attach edit events
      document.querySelectorAll(".edit-student-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const raw = btn.getAttribute("data-student");
          if (raw) {
            const student: AdminStudent = JSON.parse(raw);
            openEditStudentModal(student);
          }
        });
      });
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: #f87171; padding: 20px;">加载学生名单失败</td></tr>`;
  }
}

function openEditStudentModal(student?: AdminStudent) {
  const modal = document.getElementById("editStudentModal");
  const title = document.getElementById("editStudentModalTitle");
  const deleteBtn = document.getElementById("deleteStudentBtn");
  if (!modal) return;

  if (student) {
    if (title) title.textContent = `编辑学生：${student.name}`;
    (document.getElementById("editStudentIdHidden") as HTMLInputElement).value = student.id;
    (document.getElementById("editStudentId") as HTMLInputElement).value = student.studentId;
    (document.getElementById("editStudentName") as HTMLInputElement).value = student.name;
    (document.getElementById("editStudentClass") as HTMLInputElement).value = student.className;
    (document.getElementById("editStudentPassword") as HTMLInputElement).value = student.password || "20060101";
    (document.getElementById("editStudentQueryEnabled") as HTMLSelectElement).value = String(student.queryEnabled !== false);
    (document.getElementById("editStudentCoursesJson") as HTMLTextAreaElement).value = JSON.stringify(student.courses, null, 2);

    if (deleteBtn) {
      deleteBtn.style.display = "inline-flex";
      deleteBtn.onclick = async () => {
        if (confirm(`确定要彻底删除学生「${student.name}」的成绩记录吗？`)) {
          const res = await deleteAdminStudent(student.id);
          if (res.ok) {
            showToast("学生记录已删除", "success");
            modal.style.display = "none";
            loadAdminStudents();
          }
        }
      };
    }
  } else {
    if (title) title.textContent = "新增学生档案与成绩";
    (document.getElementById("editStudentIdHidden") as HTMLInputElement).value = "";
    (document.getElementById("editStudentId") as HTMLInputElement).value = "";
    (document.getElementById("editStudentName") as HTMLInputElement).value = "";
    (document.getElementById("editStudentClass") as HTMLInputElement).value = "自动241";
    (document.getElementById("editStudentPassword") as HTMLInputElement).value = "20060101";
    (document.getElementById("editStudentQueryEnabled") as HTMLSelectElement).value = "true";
    (document.getElementById("editStudentCoursesJson") as HTMLTextAreaElement).value = "[]";

    if (deleteBtn) deleteBtn.style.display = "none";
  }

  modal.style.display = "flex";
}

// =========================================================================
// Start App
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  initSystem();
});
