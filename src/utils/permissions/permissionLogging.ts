/**
 * Permission Telemetry and Logging
 * Tracks permission decisions and usage patterns
 *
 * Based on Claude Code's permissionLogging.ts
 */

import type { PermissionDecision } from './classifierDecision';
import type { BashCommandClassification } from './bashClassifier';

export interface PermissionLogEntry {
  id: string;
  timestamp: Date;
  sessionId: string;
  toolName: string;
  arguments: Record<string, any>;
  decision: PermissionDecision;
  bashClassification?: BashCommandClassification;
  userResponse?: 'approved' | 'denied' | 'timeout';
  executionTime?: number;
  success?: boolean;
  errorMessage?: string;
  context?: {
    conversationLength: number;
    previousDecisions: number;
    approvalRate: number;
  };
}

export interface PermissionStats {
  totalRequests: number;
  approvedRequests: number;
  deniedRequests: number;
  autoApproved: number;
  userApproved: number;
  userDenied: number;
  averageResponseTime: number;
  riskLevelDistribution: Record<string, number>;
  toolUsageDistribution: Record<string, number>;
  timeRange: {
    start: Date;
    end: Date;
  };
}

export interface TelemetryConfig {
  enableLogging: boolean;
  logRetentionDays: number;
  enableStats: boolean;
  enableAnomalyDetection: boolean;
  maxLogEntries: number;
}

/**
 * Permission telemetry and logging system
 */
export class PermissionTelemetry {
  private logs: PermissionLogEntry[] = [];
  private config: TelemetryConfig;
  private statsCache?: { stats: PermissionStats; lastUpdated: Date };

  constructor(config: Partial<TelemetryConfig> = {}) {
    this.config = {
      enableLogging: true,
      logRetentionDays: 30,
      enableStats: true,
      enableAnomalyDetection: false,
      maxLogEntries: 10000,
      ...config,
    };

    // Load existing logs from storage
    this.loadLogs();
  }

  /**
   * Log a permission decision
   */
  logPermissionDecision(
    sessionId: string,
    toolName: string,
    args: Record<string, any>,
    decision: PermissionDecision,
    bashClassification?: BashCommandClassification
  ): string {
    if (!this.config.enableLogging) return '';

    const entry: PermissionLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      sessionId,
      toolName,
      arguments: { ...args }, // Clone to avoid mutations
      decision,
      bashClassification,
    };

    this.logs.push(entry);

    // Maintain log size limit
    if (this.logs.length > this.config.maxLogEntries) {
      this.logs = this.logs.slice(-this.config.maxLogEntries);
    }

    // Save to storage
    this.saveLogs();

    // Invalidate stats cache
    this.statsCache = undefined;

    return entry.id;
  }

  /**
   * Update log entry with user response and execution results
   */
  updateLogEntry(
    logId: string,
    updates: {
      userResponse?: 'approved' | 'denied' | 'timeout';
      executionTime?: number;
      success?: boolean;
      errorMessage?: string;
    }
  ): boolean {
    const entry = this.logs.find(log => log.id === logId);
    if (!entry) return false;

    Object.assign(entry, updates);
    this.saveLogs();
    this.statsCache = undefined;
    return true;
  }

  /**
   * Get permission statistics
   */
  getStats(timeRange?: { start: Date; end: Date }): PermissionStats {
    if (!this.config.enableStats) {
      return this.getEmptyStats();
    }

    // Check cache
    if (this.statsCache && !timeRange) {
      const cacheAge = Date.now() - this.statsCache.lastUpdated.getTime();
      if (cacheAge < 300000) { // 5 minutes
        return this.statsCache.stats;
      }
    }

    const logs = timeRange
      ? this.logs.filter(log =>
          log.timestamp >= timeRange.start && log.timestamp <= timeRange.end
        )
      : this.logs;

    const stats = this.calculateStats(logs, timeRange);
    this.statsCache = { stats, lastUpdated: new Date() };

    return stats;
  }

  /**
   * Calculate statistics from log entries
   */
  private calculateStats(logs: PermissionLogEntry[], timeRange?: { start: Date; end: Date }): PermissionStats {
    const totalRequests = logs.length;
    const approvedRequests = logs.filter(log => log.decision.approved).length;
    const deniedRequests = totalRequests - approvedRequests;

    const autoApproved = logs.filter(log =>
      log.decision.approved && !log.userResponse
    ).length;

    const userApproved = logs.filter(log =>
      log.userResponse === 'approved'
    ).length;

    const userDenied = logs.filter(log =>
      log.userResponse === 'denied'
    ).length;

    const responseTimes = logs
      .filter(log => log.executionTime !== undefined)
      .map(log => log.executionTime!);

    const averageResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

    // Risk level distribution
    const riskLevelDistribution: Record<string, number> = {};
    logs.forEach(log => {
      const level = log.decision.riskLevel;
      riskLevelDistribution[level] = (riskLevelDistribution[level] || 0) + 1;
    });

    // Tool usage distribution
    const toolUsageDistribution: Record<string, number> = {};
    logs.forEach(log => {
      const tool = log.toolName;
      toolUsageDistribution[tool] = (toolUsageDistribution[tool] || 0) + 1;
    });

    return {
      totalRequests,
      approvedRequests,
      deniedRequests,
      autoApproved,
      userApproved,
      userDenied,
      averageResponseTime,
      riskLevelDistribution,
      toolUsageDistribution,
      timeRange: timeRange || {
        start: logs.length > 0 ? logs[0].timestamp : new Date(),
        end: logs.length > 0 ? logs[logs.length - 1].timestamp : new Date(),
      },
    };
  }

  /**
   * Detect anomalies in permission patterns
   */
  detectAnomalies(): {
    unusualApprovalRate: boolean;
    suspiciousToolUsage: string[];
    highRiskConcentration: boolean;
  } {
    if (!this.config.enableAnomalyDetection) {
      return {
        unusualApprovalRate: false,
        suspiciousToolUsage: [],
        highRiskConcentration: false,
      };
    }

    const stats = this.getStats();
    const recentStats = this.getStats({
      start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      end: new Date(),
    });

    const anomalies = {
      unusualApprovalRate: false,
      suspiciousToolUsage: [] as string[],
      highRiskConcentration: false,
    };

    // Check approval rate anomaly
    if (stats.totalRequests > 10 && recentStats.totalRequests > 5) {
      const overallRate = stats.approvedRequests / stats.totalRequests;
      const recentRate = recentStats.approvedRequests / recentStats.totalRequests;
      if (Math.abs(recentRate - overallRate) > 0.3) { // 30% deviation
        anomalies.unusualApprovalRate = true;
      }
    }

    // Check for suspicious tool usage
    Object.entries(recentStats.toolUsageDistribution).forEach(([tool, count]) => {
      if (count > 10) { // More than 10 uses in 24 hours
        anomalies.suspiciousToolUsage.push(tool);
      }
    });

    // Check high risk concentration
    const highRiskCount = recentStats.riskLevelDistribution.high || 0;
    const criticalCount = recentStats.riskLevelDistribution.critical || 0;
    if ((highRiskCount + criticalCount) / recentStats.totalRequests > 0.5) {
      anomalies.highRiskConcentration = true;
    }

    return anomalies;
  }

  /**
   * Clean up old logs
   */
  cleanupOldLogs(): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.logRetentionDays);

    const oldCount = this.logs.length;
    this.logs = this.logs.filter(log => log.timestamp >= cutoffDate);

    const removedCount = oldCount - this.logs.length;
    if (removedCount > 0) {
      this.saveLogs();
      this.statsCache = undefined;
    }

    return removedCount;
  }

  /**
   * Export logs for analysis
   */
  exportLogs(format: 'json' | 'csv' = 'json'): string {
    if (format === 'csv') {
      const headers = [
        'id', 'timestamp', 'sessionId', 'toolName', 'approved', 'riskLevel',
        'confidence', 'userResponse', 'executionTime', 'success'
      ];

      const rows = this.logs.map(log => [
        log.id,
        log.timestamp.toISOString(),
        log.sessionId,
        log.toolName,
        log.decision.approved.toString(),
        log.decision.riskLevel,
        log.decision.confidence.toString(),
        log.userResponse || '',
        log.executionTime?.toString() || '',
        log.success?.toString() || '',
      ]);

      return [headers, ...rows].map(row => row.join(',')).join('\n');
    }

    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * Load logs from localStorage
   */
  private loadLogs(): void {
    try {
      const stored = localStorage.getItem('pipi-shrimp-permission-logs');
      if (stored) {
        const parsed = JSON.parse(stored);
        this.logs = parsed.map((log: any) => ({
          ...log,
          timestamp: new Date(log.timestamp),
        }));
      }
    } catch (error) {
      console.warn('Failed to load permission logs:', error);
      this.logs = [];
    }
  }

  /**
   * Save logs to localStorage
   */
  private saveLogs(): void {
    try {
      localStorage.setItem('pipi-shrimp-permission-logs', JSON.stringify(this.logs));
    } catch (error) {
      console.warn('Failed to save permission logs:', error);
    }
  }

  /**
   * Get empty stats object
   */
  private getEmptyStats(): PermissionStats {
    return {
      totalRequests: 0,
      approvedRequests: 0,
      deniedRequests: 0,
      autoApproved: 0,
      userApproved: 0,
      userDenied: 0,
      averageResponseTime: 0,
      riskLevelDistribution: {},
      toolUsageDistribution: {},
      timeRange: { start: new Date(), end: new Date() },
    };
  }
}

/**
 * Default telemetry instance
 */
export const defaultTelemetry = new PermissionTelemetry();