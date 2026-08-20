export interface Course {
  name: string;
  score: number;
  credit: number;
}

export interface StudentResult {
  name: string;
  className: string;
  studentId: string;
  maskedStudentId: string;
  courses: Course[];
  queryTimestamp: string;
  verificationCode: string;
}

export interface SystemStatus {
  ok: boolean;
  allowQuery: boolean;
  announcement: string;
  maintenanceReason: string;
  allowedClasses: string[];
  totalStudents: number;
  classes: string[];
  serverTime: string;
}

export interface AuditLog {
  id: number;
  timestamp: string;
  ip: string;
  action: string;
  target: string | null;
  status: "SUCCESS" | "FAILED_PASSWORD" | "NOT_FOUND" | "BLOCKED" | "RATE_LIMITED";
  details: string | null;
  userAgent: string | null;
}

export interface LogStats {
  totalQueries: number;
  successCount: number;
  failedCount: number;
  blockedCount: number;
  rateLimitedCount: number;
  successRate: string;
}

export interface AdminStudent {
  id: string;
  studentId: string;
  name: string;
  className: string;
  password?: string;
  courses: Course[];
  queryEnabled: boolean;
  updatedAt: string;
}
