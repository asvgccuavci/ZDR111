import type { StudentResult, SystemStatus, AuditLog, LogStats, AdminStudent } from "./types";

let adminToken: string | null = localStorage.getItem("neepu_admin_token");

export function getStoredToken(): string | null {
  return adminToken;
}

export function setStoredToken(token: string | null) {
  adminToken = token;
  if (token) {
    localStorage.setItem("neepu_admin_token", token);
  } else {
    localStorage.removeItem("neepu_admin_token");
  }
}

function getAuthHeaders(): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (adminToken) {
    headers["Authorization"] = `Bearer ${adminToken}`;
  }
  return headers;
}

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const res = await fetch("/system/status");
  return res.json();
}

export async function queryStudentGrade(data: {
  className: string;
  name: string;
  password: string;
}): Promise<{ ok: boolean; student?: StudentResult; message?: string; code?: string; remainingSeconds?: number }> {
  const res = await fetch("/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function adminLogin(data: {
  username: string;
  password: string;
}): Promise<{ ok: boolean; token?: string; username?: string; message?: string }> {
  const res = await fetch("/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (json.ok && json.token) {
    setStoredToken(json.token);
  }
  return json;
}

export async function verifyAdminAuth(): Promise<boolean> {
  if (!adminToken) return false;
  try {
    const res = await fetch("/admin/verify", {
      headers: getAuthHeaders(),
    });
    const json = await res.json();
    return json.ok === true;
  } catch {
    return false;
  }
}

export async function fetchAdminSettings(): Promise<{
  ok: boolean;
  settings?: {
    allowQuery: boolean;
    announcement: string;
    maintenanceReason: string;
    allowedClasses: string;
    rateLimitMax: number;
    rateLimitLockout: number;
  };
}> {
  const res = await fetch("/admin/settings", {
    headers: getAuthHeaders(),
  });
  return res.json();
}

export async function updateAdminSettings(settings: {
  allowQuery?: boolean;
  announcement?: string;
  maintenanceReason?: string;
  allowedClasses?: string;
  rateLimitMax?: number;
  rateLimitLockout?: number;
}): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch("/admin/settings", {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(settings),
  });
  return res.json();
}

export async function fetchAdminLogs(filter?: { limit?: number; status?: string }): Promise<{
  ok: boolean;
  stats?: LogStats;
  logs?: AuditLog[];
}> {
  const params = new URLSearchParams();
  if (filter?.limit) params.set("limit", String(filter.limit));
  if (filter?.status) params.set("status", filter.status);

  const res = await fetch(`/admin/logs?${params.toString()}`, {
    headers: getAuthHeaders(),
  });
  return res.json();
}

export async function clearAdminLogs(action: "clear_logs" | "unblock_all_ips"): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch("/admin/logs", {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ action }),
  });
  return res.json();
}

export async function fetchAdminStudents(query?: {
  search?: string;
  class?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  ok: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
  students?: AdminStudent[];
}> {
  const params = new URLSearchParams();
  if (query?.search) params.set("search", query.search);
  if (query?.class) params.set("class", query.class);
  if (query?.page) params.set("page", String(query.page));
  if (query?.pageSize) params.set("pageSize", String(query.pageSize));

  const res = await fetch(`/admin/students?${params.toString()}`, {
    headers: getAuthHeaders(),
  });
  return res.json();
}

export async function saveAdminStudent(student: {
  id?: string;
  studentId: string;
  name: string;
  className: string;
  password?: string;
  courses: any[];
  queryEnabled: boolean;
}): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch("/admin/students", {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(student),
  });
  return res.json();
}

export async function deleteAdminStudent(id: string): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch("/admin/students", {
    method: "DELETE",
    headers: getAuthHeaders(),
    body: JSON.stringify({ id }),
  });
  return res.json();
}
