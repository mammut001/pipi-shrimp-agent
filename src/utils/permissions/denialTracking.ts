/**
 * Denial Tracking System
 * Tracks and analyzes permission denials to improve decision making
 *
 * Based on Claude Code's denialTracking.ts
 */

import type { PermissionDecision, PermissionRequest } from './classifierDecision';

export interface DenialRecord {
  id: string;
  timestamp: Date;
  sessionId: string;
  toolName: string;
  arguments: Record<string, any>;
  decision: PermissionDecision;
  denialReason: DenialReason;
  userFeedback?: string;
  context: {
    conversationState: string;
    previousAttempts: number;
    timeSinceLastDenial: number;
    patternMatch?: string;
  };
  metadata: {
    riskScore: number;
    confidence: number;
    classifierVersion: string;
  };
}

export type DenialReason =
  | 'high_risk'
  | 'critical_risk'
  | 'policy_violation'
  | 'unsafe_arguments'
  | 'suspicious_pattern'
  | 'user_preference'
  | 'system_protection'
  | 'unknown';

export interface DenialPattern {
  id: string;
  pattern: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  matches: number;
  lastMatch: Date;
  example: string;
}

export interface DenialStats {
  totalDenials: number;
  denialsByReason: Record<DenialReason, number>;
  denialsByTool: Record<string, number>;
  recentDenialRate: number; // Denials per hour in last 24h
  patternsDetected: DenialPattern[];
  timeRange: {
    start: Date;
    end: Date;
  };
}

export interface DenialAnalysis {
  shouldEscalate: boolean;
  suggestedPolicyChange?: string;
  riskTrend: 'increasing' | 'stable' | 'decreasing';
  commonPatterns: string[];
  recommendations: string[];
}

/**
 * Denial tracking and analysis system
 */
export class DenialTracker {
  private records: DenialRecord[] = [];
  private patterns: DenialPattern[] = [];
  private maxRecords = 1000;

  constructor() {
    this.loadData();
    this.initializePatterns();
  }

  /**
   * Record a permission denial
   */
  recordDenial(
    sessionId: string,
    request: PermissionRequest,
    decision: PermissionDecision,
    denialReason: DenialReason,
    userFeedback?: string
  ): string {
    const record: DenialRecord = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      sessionId,
      toolName: request.toolName,
      arguments: { ...request.arguments },
      decision,
      denialReason,
      userFeedback,
      context: {
        conversationState: this.getConversationState(sessionId),
        previousAttempts: this.getPreviousAttempts(sessionId, request.toolName),
        timeSinceLastDenial: this.getTimeSinceLastDenial(sessionId),
        patternMatch: this.detectPattern(request),
      },
      metadata: {
        riskScore: decision.metadata?.riskScore || 0,
        confidence: decision.confidence,
        classifierVersion: decision.metadata?.modelVersion || 'unknown',
      },
    };

    this.records.push(record);

    // Maintain size limit
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    // Update patterns
    this.updatePatterns(record);

    // Save to storage
    this.saveData();

    return record.id;
  }

  /**
   * Get denial statistics
   */
  getStats(timeRange?: { start: Date; end: Date }): DenialStats {
    const records = timeRange
      ? this.records.filter(r => r.timestamp >= timeRange.start && r.timestamp <= timeRange.end)
      : this.records;

    const denialsByReason: Record<DenialReason, number> = {} as any;
    const denialsByTool: Record<string, number> = {};

    records.forEach(record => {
      // Count by reason
      denialsByReason[record.denialReason] = (denialsByReason[record.denialReason] || 0) + 1;

      // Count by tool
      denialsByTool[record.toolName] = (denialsByTool[record.toolName] || 0) + 1;
    });

    // Calculate recent denial rate (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentRecords = this.records.filter(r => r.timestamp >= oneDayAgo);
    const recentDenialRate = recentRecords.length / 24; // per hour

    return {
      totalDenials: records.length,
      denialsByReason,
      denialsByTool,
      recentDenialRate,
      patternsDetected: this.patterns.filter(p => p.matches > 0),
      timeRange: timeRange || {
        start: records.length > 0 ? records[0].timestamp : new Date(),
        end: records.length > 0 ? records[records.length - 1].timestamp : new Date(),
      },
    };
  }

  /**
   * Analyze denial patterns and trends
   */
  analyzeDenials(): DenialAnalysis {
    const stats = this.getStats();
    const analysis: DenialAnalysis = {
      shouldEscalate: false,
      riskTrend: 'stable',
      commonPatterns: [],
      recommendations: [],
    };

    // Check for escalation conditions
    if (stats.recentDenialRate > 10) { // More than 10 denials per hour
      analysis.shouldEscalate = true;
      analysis.recommendations.push('High denial rate detected - review permission policies');
    }

    // Analyze risk trend
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const recentWeek = this.getStats({ start: oneWeekAgo, end: now });
    const previousWeek = this.getStats({ start: twoWeeksAgo, end: oneWeekAgo });

    if (recentWeek.totalDenials > previousWeek.totalDenials * 1.5) {
      analysis.riskTrend = 'increasing';
      analysis.recommendations.push('Denial rate increasing - monitor user behavior');
    } else if (recentWeek.totalDenials < previousWeek.totalDenials * 0.7) {
      analysis.riskTrend = 'decreasing';
    }

    // Find common patterns
    analysis.commonPatterns = this.patterns
      .filter(p => p.matches > 2)
      .sort((a, b) => b.matches - a.matches)
      .slice(0, 5)
      .map(p => p.description);

    // Generate recommendations
    if (stats.denialsByReason.high_risk > stats.totalDenials * 0.5) {
      analysis.recommendations.push('Many high-risk operations denied - consider adjusting risk thresholds');
    }

    const topDeniedTool = Object.entries(stats.denialsByTool)
      .sort(([,a], [,b]) => b - a)[0];
    if (topDeniedTool && topDeniedTool[1] > 5) {
      analysis.recommendations.push(`Tool "${topDeniedTool[0]}" frequently denied - review usage patterns`);
    }

    return analysis;
  }

  /**
   * Check if a request matches known denial patterns
   */
  shouldDenyBasedOnHistory(request: PermissionRequest): {
    shouldDeny: boolean;
    reason?: DenialReason;
    confidence: number;
  } {
    // Check for repeated denials of same tool
    const recentDenials = this.records
      .filter(r =>
        r.toolName === request.toolName &&
        Date.now() - r.timestamp.getTime() < 60 * 60 * 1000 // Last hour
      )
      .length;

    if (recentDenials >= 3) {
      return {
        shouldDeny: true,
        reason: 'suspicious_pattern',
        confidence: 0.8,
      };
    }

    // Check for pattern matches
    const patternMatch = this.detectPattern(request);
    if (patternMatch) {
      const pattern = this.patterns.find(p => p.pattern === patternMatch);
      if (pattern && pattern.severity === 'high') {
        return {
          shouldDeny: true,
          reason: 'policy_violation',
          confidence: 0.9,
        };
      }
    }

    return { shouldDeny: false, confidence: 0 };
  }

  /**
   * Get conversation state summary
   */
  private getConversationState(sessionId: string): string {
    // This would integrate with chat store to get conversation summary
    // For now, return a placeholder
    return `session_${sessionId}`;
  }

  /**
   * Get number of previous attempts for this tool in session
   */
  private getPreviousAttempts(sessionId: string, toolName: string): number {
    return this.records.filter(r =>
      r.sessionId === sessionId &&
      r.toolName === toolName
    ).length;
  }

  /**
   * Get time since last denial in session
   */
  private getTimeSinceLastDenial(sessionId: string): number {
    const lastDenial = this.records
      .filter(r => r.sessionId === sessionId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];

    return lastDenial
      ? Date.now() - lastDenial.timestamp.getTime()
      : Infinity;
  }

  /**
   * Detect if request matches known patterns
   */
  private detectPattern(request: PermissionRequest): string | undefined {
    // Simple pattern detection - could be enhanced with ML
    const patterns = [
      {
        pattern: 'system_file_access',
        condition: request.toolName === 'read_file' &&
          typeof request.arguments.path === 'string' &&
          (request.arguments.path as string).startsWith('/System'),
      },
      {
        pattern: 'destructive_command',
        condition: request.toolName === 'run_in_terminal' &&
          typeof request.arguments.command === 'string' &&
          (request.arguments.command as string).includes('rm -rf'),
      },
      {
        pattern: 'network_outbound',
        condition: ['run_in_terminal', 'run_vscode_command'].includes(request.toolName) &&
          JSON.stringify(request.arguments).includes('curl'),
      },
    ];

    const match = patterns.find(p => p.condition);
    return match?.pattern;
  }

  /**
   * Update pattern statistics
   */
  private updatePatterns(record: DenialRecord): void {
    if (record.context.patternMatch) {
      const pattern = this.patterns.find(p => p.pattern === record.context.patternMatch);
      if (pattern) {
        pattern.matches++;
        pattern.lastMatch = record.timestamp;
      }
    }
  }

  /**
   * Initialize common denial patterns
   */
  private initializePatterns(): void {
    this.patterns = [
      {
        id: 'system_file_access',
        pattern: 'system_file_access',
        description: 'Access to system-protected files',
        severity: 'high',
        matches: 0,
        lastMatch: new Date(0),
        example: 'Reading /System/Library files',
      },
      {
        id: 'destructive_command',
        pattern: 'destructive_command',
        description: 'Potentially destructive shell commands',
        severity: 'high',
        matches: 0,
        lastMatch: new Date(0),
        example: 'rm -rf commands',
      },
      {
        id: 'network_outbound',
        pattern: 'network_outbound',
        description: 'Outbound network connections',
        severity: 'medium',
        matches: 0,
        lastMatch: new Date(0),
        example: 'curl or wget commands',
      },
      {
        id: 'privilege_escalation',
        pattern: 'privilege_escalation',
        description: 'Attempts to gain elevated privileges',
        severity: 'high',
        matches: 0,
        lastMatch: new Date(0),
        example: 'sudo commands',
      },
    ];
  }

  /**
   * Load data from localStorage
   */
  private loadData(): void {
    try {
      const stored = localStorage.getItem('pipi-shrimp-denial-tracker');
      if (stored) {
        const parsed = JSON.parse(stored);
        this.records = parsed.records.map((r: any) => ({
          ...r,
          timestamp: new Date(r.timestamp),
        }));
        this.patterns = parsed.patterns.map((p: any) => ({
          ...p,
          lastMatch: new Date(p.lastMatch),
        }));
      }
    } catch (error) {
      console.warn('Failed to load denial tracker data:', error);
      this.records = [];
      this.initializePatterns();
    }
  }

  /**
   * Save data to localStorage
   */
  private saveData(): void {
    try {
      const data = {
        records: this.records,
        patterns: this.patterns,
      };
      localStorage.setItem('pipi-shrimp-denial-tracker', JSON.stringify(data));
    } catch (error) {
      console.warn('Failed to save denial tracker data:', error);
    }
  }

  /**
   * Clean up old records
   */
  cleanupOldRecords(daysToKeep: number = 30): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const oldCount = this.records.length;
    this.records = this.records.filter(r => r.timestamp >= cutoffDate);

    const removedCount = oldCount - this.records.length;
    if (removedCount > 0) {
      this.saveData();
    }

    return removedCount;
  }
}

/**
 * Default denial tracker instance
 */
export const defaultDenialTracker = new DenialTracker();