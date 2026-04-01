/**
 * AgentPanel - Redesigned Right panel for displaying agent instructions, task progress, and context.
 *
 * Inspired by Claude Code's sidebar layout.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useUIStore, useSettingsStore, useChatStore } from '@/store';
import { useBrowserAgentStore } from '@/store/browserAgentStore';
import { useCdpStore } from '@/store/cdpStore';
import { CdpConnectorModal } from './CdpConnectorModal';
import { PermissionModal, TypstPreview } from './index';
import { ProjectFilesView } from './ProjectFilesView';
import { BrowserMiniPreview } from './BrowserMiniPreview';
import { getLatestTypstBlock } from '@/utils/typst';
import { invoke } from '@tauri-apps/api/core';
import type { ProjectFingerprint } from '@/types/ui';

// Default roadmap template used when docs/tracker/roadmap.typ doesn't exist yet.
// AI will populate it once the file is created.
const DEFAULT_ROADMAP_TYP = `// ============================================================
// roadmap.typ — PiPi Shrimp Agent Feature Tracker
//
// AI 维护规则：
//   - 只修改 "== DATA START ==" 到 "== DATA END ==" 之间的内容
//   - 不要修改 DATA END 以下的任何渲染代码
//   - 每次修改后调用 render_typst_to_svg 重新渲染
//   - 渲染结果用 write_file 保存到 docs/tracker/roadmap.svg
// ============================================================

// ============================================================
// == DATA START ==
// ============================================================

#let last_updated = "—"

// ---- 主线里程碑 ----
// status: "done" | "in-progress" | "todo" | "blocked"
#let main_milestones = (
  (title: "Project Initialization", date: "", status: "done", desc: "Setting up basic structure"),
  (title: "Feature Implementation", date: "", status: "in-progress", desc: "AI is currently working on core features"),
  (title: "Future Milestone", date: "", status: "todo", desc: "Planned feature refinement"),
)

// ---- 功能线 (Side Tracks) ----
// status: "done" | "in-progress" | "todo" | "blocked"
#let side_tracks = (
  (
    name: "Development",
    branch: "main",
    branch_status: "open",
    changes: (
      (desc: "Environment setup", status: "done", date: ""),
      (desc: "Initial commit", status: "done", date: ""),
      (desc: "Ongoing development", status: "in-progress", date: ""),
    ),
  ),
)

// ============================================================
// == DATA END ==
// ============================================================

// ---- 颜色 ----
#let c-done       = rgb("#10b981")
#let c-progress   = rgb("#3b82f6")
#let c-todo       = rgb("#6b7280")
#let c-blocked    = rgb("#ef4444")
#let c-bg         = rgb("#0f172a")
#let c-surface    = rgb("#1e293b")
#let c-border     = rgb("#334155")
#let c-text       = rgb("#f8fafc")
#let c-muted      = rgb("#94a3b8")

#let status-color(s) = {
  if s == "done"         { c-done }
  else if s == "in-progress" { c-progress }
  else if s == "blocked" { c-blocked }
  else                   { c-todo }
}

#let status-icon(s) = {
  if s == "done"         { "✓" }
  else if s == "in-progress" { "•" }
  else if s == "blocked" { "!" }
  else                   { "○" }
}

#let branch-badge(bs) = {
  if bs == "merged"    { ([merged], rgb("#7c3aed")) }
  else if bs == "ready"{ ([ready], rgb("#0891b2")) }
  else if bs == "open" { ([open],  rgb("#059669")) }
  else if bs == "abandoned" { ([abandoned], rgb("#b91c1c")) }
  else                 { ([main],  rgb("#475569")) }
}

// ---- 页面 ----
#set page(
  width: 420pt,
  height: auto,
  margin: (x: 20pt, y: 20pt),
  fill: c-bg,
)
#set text(fill: c-text, size: 10pt, font: ("SF Pro Text", "Inter", "Helvetica Neue", "Arial"))

// ---- 标题 ----
#box(width: 100%, inset: (bottom: 12pt))[
  #grid(
    columns: (1fr, auto),
    align(left)[
      #text(size: 18pt, weight: 800, tracking: -0.02em)[ROADMAP]
      #h(6pt)
      #text(size: 9pt, fill: c-muted, weight: 500)[Agent Project]
    ],
    align(right + bottom)[
      #text(size: 8pt, fill: c-muted)[Update: #last_updated]
    ]
  )
  #line(length: 100%, stroke: 1.5pt + c-border)
]

#v(8pt)

// ---- MAIN MILESTONES (Vertical Timeline) ----
#text(size: 9pt, fill: c-muted, weight: 700, tracking: 0.05em)[MAIN MILESTONES]
#v(10pt)

#let n-main = main_milestones.len()
#for (i, m) in main_milestones.enumerate() [
  #grid(
    columns: (24pt, 1fr),
    column-gutter: 12pt,
    // Timeline connector
    align(center)[
      #circle(radius: 6pt, fill: status-color(m.status))
      #if i < n-main - 1 [
        #v(4pt)
        #line(start: (0pt, 0pt), end: (0pt, 24pt), stroke: 1.5pt + c-border)
      ]
    ],
    // Milestone content
    [
      #box(width: 100%, fill: c-surface, radius: 8pt, inset: 10pt)[
        #grid(
          columns: (1fr, auto),
          align(left)[
            #text(size: 11pt, weight: "bold")[#m.title]
          ],
          align(right)[
            #text(size: 8pt, fill: c-muted)[#if m.date != "" { m.date } else { "TBD" }]
          ]
        )
        #v(4pt)
        #text(size: 9pt, fill: c-muted)[#m.desc]
      ]
      #v(12pt)
    ]
  )
]

#v(12pt)

// ---- SIDE TRACKS ----
#text(size: 9pt, fill: c-muted, weight: 700, tracking: 0.05em)[SIDE TRACKS]
#v(10pt)

#for track in side_tracks [
  #let (badge-text, badge-color) = branch-badge(track.branch_status)
  
  #box(width: 100%, fill: c-surface, radius: 8pt, inset: 12pt, stroke: 1pt + c-border)[
    #grid(
      columns: (1fr, auto),
      align(horizon)[
        #text(weight: 700, size: 11pt)[#track.name]
      ],
      align(right + horizon)[
        #box(fill: badge-color, radius: 4pt, inset: (x: 6pt, y: 3pt))[
          #text(size: 7pt, fill: white, weight: 800)[#upper(track.branch)]
        ]
      ]
    )
    
    #v(10pt)
    
    #for (j, c) in track.changes.enumerate() [
      #grid(
        columns: (12pt, 1fr, auto),
        column-gutter: 8pt,
        align(horizon)[
          #circle(radius: 3pt, fill: status-color(c.status))
        ],
        align(left + horizon)[
          #text(size: 9pt, fill: if c.status == "done" { c-muted } else { c-text })[#c.desc]
        ],
        align(right + horizon)[
          #if c.date != "" [
            #text(size: 7pt, fill: c-muted)[#c.date]
          ]
        ]
      )
      #if j < track.changes.len() - 1 { v(6pt) }
    ]
  ]
  #v(10pt)
]

// ---- LEGEND ----
#v(10pt)
#align(center)[
  #grid(
    columns: (auto, auto, auto, auto),
    column-gutter: 14pt,
    align(horizon)[#circle(radius: 4pt, fill: c-done) #h(2pt) #text(size: 8pt, fill: c-muted)[Done]],
    align(horizon)[#circle(radius: 4pt, fill: c-progress) #h(2pt) #text(size: 8pt, fill: c-muted)[Working]],
    align(horizon)[#circle(radius: 4pt, fill: c-todo) #h(2pt) #text(size: 8pt, fill: c-muted)[Todo]],
    align(horizon)[#circle(radius: 4pt, fill: c-blocked) #h(2pt) #text(size: 8pt, fill: c-muted)[Blocked]],
  )
]
`;

/**
 * Section Container Component
 */
const Section: React.FC<{
  title: string;
  subtitle?: string;
  count?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}> = ({ title, subtitle, count, defaultExpanded = true, children }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="mx-3 mb-2 bg-white rounded-xl border border-gray-200/60 shadow-sm overflow-hidden transition-all duration-300">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50/50 transition-colors select-none"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-gray-800 uppercase tracking-tight">{title}</h3>
          {subtitle && <span className="text-[10px] text-gray-400 font-medium">{subtitle}</span>}
        </div>
        <div className="flex items-center gap-3">
          {count && <span className="text-[10px] text-gray-500 font-bold bg-gray-100 px-2 py-0.5 rounded-full">{count}</span>}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-4 w-4 text-gray-400 transition-transform duration-300 ${expanded ? '' : '-rotate-90'}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 animate-in fade-in slide-in-from-top-1 duration-300">
          {children}
        </div>
      )}
    </div>
  );
};

/**
 * ProjectScannerOverlay - Shows project analysis progress and results
 */
const ProjectScannerOverlay: React.FC<{
  workDir: string;
  onComplete: (fingerprint: ProjectFingerprint | null) => void;
}> = ({ workDir, onComplete }) => {
  const [step, setStep] = useState(0);
  const [fingerprint, setFingerprint] = useState<ProjectFingerprint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { setAnalyzingProject, setProjectFingerprint } = useUIStore();

  const steps = [
    'Scanning project structure...',
    'Detecting tech stack...',
    'Analyzing key files...',
    'Building summary...',
  ];

  useEffect(() => {
    let cancelled = false;

    const analyze = async () => {
      setAnalyzingProject(true, steps[0]);

      // Simulate step progression
      const stepInterval = setInterval(() => {
        if (!cancelled) {
          setStep(s => {
            if (s < steps.length - 1) return s + 1;
            return s;
          });
        }
      }, 800);

      try {
        setAnalyzingProject(true, 'Analyzing project...');
        const result = await invoke<ProjectFingerprint>('analyze_project_structure', { workDir });

        if (!cancelled) {
          setStep(steps.length - 1);
          setFingerprint(result);
          setProjectFingerprint(result);
          clearInterval(stepInterval);

          // Brief delay before completing
          await new Promise(r => setTimeout(r, 500));
          setAnalyzingProject(false);
          onComplete(result);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(String(e));
          setAnalyzingProject(false);
          clearInterval(stepInterval);
          onComplete(null);
        }
      }
    };

    analyze();

    return () => {
      cancelled = true;
    };
  }, [workDir, onComplete, setAnalyzingProject, setProjectFingerprint]);

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <div className="relative mb-6">
        {/* Animated progress ring */}
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
          <circle
            cx="40"
            cy="40"
            r="36"
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="4"
          />
          <circle
            cx="40"
            cy="40"
            r="36"
            fill="none"
            stroke="#3b82f6"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 36}`}
            strokeDashoffset={`${2 * Math.PI * 36 * (1 - (step + 1) / steps.length)}`}
            className="transition-all duration-500 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <svg className="w-8 h-8 text-blue-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      <h3 className="text-sm font-bold text-gray-700 mb-2">Understanding Project</h3>
      <p className="text-xs text-gray-500 mb-4 max-w-[200px]">{steps[step]}</p>

      {/* Tech stack badges */}
      {fingerprint && (
        <div className="flex flex-wrap gap-1 justify-center max-w-[240px]">
          {fingerprint.tech_stack.slice(0, 5).map((tech, i) => (
            <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-full">
              {tech}
            </span>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 max-w-[240px]">
          {error}
        </div>
      )}
    </div>
  );
};

/**
 * File Icon Helper - Supports multiple file types with type-specific icons
 */
const FileIcon: React.FC<{ filename: string }> = ({ filename }) => {
  const ext = filename.split('.').pop()?.toLowerCase();

  // TypeScript / TSX
  if (ext === 'ts' || ext === 'tsx') return (
    <div className="p-1 px-1.5 bg-blue-50 rounded text-blue-600 font-bold text-[8px] uppercase ring-1 ring-blue-100 flex-shrink-0">TS</div>
  );
  // Rust
  if (ext === 'rs') return (
    <div className="p-1 px-1.5 bg-orange-50 rounded text-orange-600 font-bold text-[8px] uppercase ring-1 ring-orange-100 flex-shrink-0">RS</div>
  );
  // Markdown
  if (ext === 'md' || ext === 'mdx') return (
    <div className="p-1 px-1.5 bg-gray-100 rounded text-gray-600 font-bold text-[8px] uppercase ring-1 ring-gray-200 flex-shrink-0">MD</div>
  );
  // JSON
  if (ext === 'json') return (
    <div className="p-1 px-1.5 bg-yellow-50 rounded text-yellow-600 font-bold text-[8px] uppercase ring-1 ring-yellow-100 flex-shrink-0">{'{}'}</div>
  );
  // Python
  if (ext === 'py') return (
    <div className="p-1 px-1.5 bg-yellow-100 rounded text-yellow-700 font-bold text-[8px] uppercase ring-1 ring-yellow-200 flex-shrink-0">PY</div>
  );
  // Go
  if (ext === 'go') return (
    <div className="p-1 px-1.5 bg-cyan-50 rounded text-cyan-600 font-bold text-[8px] uppercase ring-1 ring-cyan-100 flex-shrink-0">GO</div>
  );
  // Java
  if (ext === 'java') return (
    <div className="p-1 px-1.5 bg-red-50 rounded text-red-600 font-bold text-[8px] uppercase ring-1 ring-red-100 flex-shrink-0">JV</div>
  );
  // CSS
  if (ext === 'css') return (
    <div className="p-1 px-1.5 bg-blue-100 rounded text-blue-700 font-bold text-[8px] uppercase ring-1 ring-blue-200 flex-shrink-0">CSS</div>
  );
  // HTML
  if (ext === 'html' || ext === 'htm') return (
    <div className="p-1 px-1.5 bg-orange-100 rounded text-orange-700 font-bold text-[8px] uppercase ring-1 ring-orange-200 flex-shrink-0">HTML</div>
  );
  // Image files
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext || '')) return (
    <div className="p-1 px-1.5 bg-purple-50 rounded text-purple-600 font-bold text-[8px] uppercase ring-1 ring-purple-100 flex-shrink-0">IMG</div>
  );
  // Config files
  if (['yaml', 'yml', 'toml', 'ini', 'conf'].includes(ext || '')) return (
    <div className="p-1 px-1.5 bg-gray-100 rounded text-gray-600 font-bold text-[8px] uppercase ring-1 ring-gray-200 flex-shrink-0">CFG</div>
  );

  // Default file icon
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
};

/**
 * AgentPanel component
 */
export const AgentPanel: React.FC = () => {
  const {
    agentInstructions,
    setAgentInstructions,
    taskProgress,
    addNotification,
    agentPanelTab: activeTab,
    setAgentPanelTab: setActiveTab,
  } = useUIStore();
  const { importedFiles: globalImportedFiles, removeImportedFile, clearImportedFiles } = useSettingsStore();
  const { currentMessages, currentSessionId, sessions, removeSessionWorkingFile, updateSessionPermissionMode, isStreaming, pendingToolCalls } = useChatStore();
  const { status: browserStatus } = useBrowserAgentStore();
  const cdpStatus = useCdpStore(s => s.status);
  const [showCdpModal, setShowCdpModal] = useState(false);

  // Get session-level working files and permissionMode for current session
  const currentSession = sessions.find(s => s.id === currentSessionId);
  const sessionWorkingFiles = currentSession?.workingFiles ?? [];
  // Get permissionMode from current session (defaults to 'standard')
  const permissionMode = currentSession?.permissionMode || 'standard';

  // Combine session files and global files (deduplicated by path) - memoized
  const allWorkingFiles = useMemo(() => [
    ...sessionWorkingFiles,
    ...globalImportedFiles.filter(f => !sessionWorkingFiles.some(sf => sf.path === f.path))
  ], [sessionWorkingFiles, globalImportedFiles]);

  const [showBypassConfirm, setShowBypassConfirm] = useState(false);
  const [showPermissionWarning, setShowPermissionWarning] = useState(false);
  const [localInstructions, setLocalInstructions] = useState(agentInstructions);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingModeChange, setPendingModeChange] = useState<string | null>(null);

  // Preview related state
  const [previewContent, setPreviewContent] = useState('');
  const [autoSync, setAutoSync] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Roadmap SVG state
  const [roadmapSvg, setRoadmapSvg] = useState<string>('');
  const [roadmapLoading, setRoadmapLoading] = useState(false);
  const [roadmapError, setRoadmapError] = useState<string | null>(null);
  const [roadmapZoom, setRoadmapZoom] = useState(1.0);
  const [roadmapFullscreen, setRoadmapFullscreen] = useState(false);

  // Project scanner state
  const [showScanner, setShowScanner] = useState(false);
  const { isAnalyzingProject } = useUIStore();

  const messages = currentMessages();

  const loadRoadmap = useCallback(async () => {
    setRoadmapLoading(true);
    setRoadmapError(null);
    try {
      const session = sessions.find(s => s.id === currentSessionId);
      const baseDir = session?.workDir || undefined;

      let typSource: string;
      try {
        typSource = await invoke<string>('read_project_file', {
          relativePath: 'docs/tracker/roadmap.typ',
          baseDir,
        });
      } catch (readErr: any) {
        const msg = String(readErr);
        if (msg.includes('No such file') || msg.includes('Cannot read') || msg.includes('os error 2')) {
          // Auto-initialize with default template
          await invoke('write_project_file', {
            relativePath: 'docs/tracker/roadmap.typ',
            content: DEFAULT_ROADMAP_TYP,
            baseDir,
          });
          typSource = DEFAULT_ROADMAP_TYP;
        } else {
          throw readErr;
        }
      }
      const svg = await invoke<string>('render_typst_to_svg', { source: typSource });
      // Make SVG fill container width — replace fixed width with 100%, keep viewBox for aspect ratio
      const scaledSvg = svg
        .replace(/(<svg[^>]*)\swidth="[^"]*"/, '$1 width="100%"')
        .replace(/(<svg[^>]*)\sheight="[^"]*"/, '$1 height="auto"');
      setRoadmapSvg(scaledSvg);
    } catch (e: any) {
      setRoadmapError(String(e));
    } finally {
      setRoadmapLoading(false);
    }
  }, [currentSessionId, sessions]);

  // Auto-switch to browser tab when browser starts running
  useEffect(() => {
    if (browserStatus === 'running' && activeTab !== 'browser') {
      const { presentationMode } = useBrowserAgentStore.getState();
      if (presentationMode !== 'expanded') {
        setActiveTab('browser');
      }
    }
  }, [browserStatus, activeTab, setActiveTab]);

  // Sync on mount (immediate, not debounced)
  useEffect(() => {
    if (autoSync && messages.length > 0) {
      const latestBlock = getLatestTypstBlock(messages);
      if (latestBlock && isInitialLoad) {
        setPreviewContent(latestBlock);
        setIsInitialLoad(false);
      }
    }
  }, []); // Only run on mount

  // Load roadmap when switching to roadmap tab OR when project context changes
  useEffect(() => {
    if (activeTab === 'roadmap') {
      if (currentSession?.workDir) {
        loadRoadmap();
      } else {
        // No project bound — clear roadmap state
        setRoadmapSvg('');
        setRoadmapError(null);
      }
    }
  }, [activeTab, currentSessionId, currentSession?.workDir, loadRoadmap]);

  // Auto-trigger scanner when workDir is first bound (only once per session)
  const prevWorkDirRef = useRef<string | null>(null);
  useEffect(() => {
    const workDir = currentSession?.workDir;
    if (workDir && workDir !== prevWorkDirRef.current) {
      prevWorkDirRef.current = workDir;
      // Auto-start scanner if this is a new workDir binding
      if (!isAnalyzingProject && !showScanner) {
        setShowScanner(true);
      }
    }
  }, [currentSession?.workDir, isAnalyzingProject, showScanner]);


  // Sync immediately when switching to typst-preview tab
  useEffect(() => {
    if (activeTab === 'typst-preview' && autoSync && messages.length > 0) {
      const latestBlock = getLatestTypstBlock(messages);
      if (latestBlock) {
        setPreviewContent(latestBlock);
      }
    }
  }, [activeTab]); // Run when tab changes

  // Auto-sync latest Typst block from messages (for new messages while on tab)
  useEffect(() => {
    if (autoSync && messages.length > 0) {
      const latestBlock = getLatestTypstBlock(messages);
      if (latestBlock) {
        setPreviewContent(latestBlock);
      }
    }
  }, [messages, autoSync]);

  React.useEffect(() => {
    setLocalInstructions(agentInstructions);
  }, [agentInstructions]);

  const handleModeChange = (mode: string) => {
    // Check if there are pending tool operations
    if (isStreaming || pendingToolCalls > 0) {
      setPendingModeChange(mode);
      setShowPermissionWarning(true);
      return;
    }

    if (mode === 'bypass' && permissionMode !== 'bypass') {
      setShowBypassConfirm(true);
    } else {
      if (currentSessionId) {
        updateSessionPermissionMode(currentSessionId, mode as 'standard' | 'auto-edits' | 'bypass' | 'plan-only');
      }
      setShowBypassConfirm(false);
    }
  };

  const confirmPermissionSwitch = () => {
    if (currentSessionId && pendingModeChange) {
      updateSessionPermissionMode(currentSessionId, pendingModeChange as 'standard' | 'auto-edits' | 'bypass' | 'plan-only');
    }
    setShowPermissionWarning(false);
    setPendingModeChange(null);
  };

  const confirmBypass = () => {
    if (currentSessionId) {
      updateSessionPermissionMode(currentSessionId, 'bypass');
    }
    setShowBypassConfirm(false);
  };

  const handleSaveSoul = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 800));
      setAgentInstructions(localInstructions);
      addNotification('success', 'Agent Soul saved successfully');
    } catch (error) {
      addNotification('error', 'Failed to save Agent Soul');
    } finally {
      setIsSaving(false);
    }
  };

  // Calculate completed steps
  const completedSteps = taskProgress.filter(s => s.status === 'done').length;
  const totalSteps = taskProgress.length;

  return (
    <div className="flex flex-col h-full bg-[#fbfbfd] text-gray-800 border-l border-gray-200/60 transition-all duration-300 select-none">

      {/* Top Tab Bar */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-2 border-b border-gray-200/60 bg-white/70">
        {/* Main tab */}
        <button
          onClick={() => setActiveTab('main')}
          className={`px-2.5 py-1 text-[10px] font-bold rounded-lg uppercase tracking-tight transition-all ${
            activeTab === 'main'
              ? 'bg-gray-900 text-white'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
        >
          Main
        </button>

        {/* Browser tab */}
        <button
          onClick={() => setActiveTab('browser')}
          className={`p-1.5 rounded-lg transition-all ${
            activeTab === 'browser'
              ? 'bg-gray-100 text-gray-900'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
          title="Browser"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        </button>

        {/* Typst Preview tab */}
        <button
          onClick={() => setActiveTab('typst-preview')}
          className={`p-1.5 rounded-lg transition-all ${
            activeTab === 'typst-preview'
              ? 'bg-gray-100 text-gray-900'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
          title="Typst Preview"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </button>

        {/* Typst Code tab */}
        <button
          onClick={() => setActiveTab('typst-code')}
          className={`p-1.5 rounded-lg transition-all ${
            activeTab === 'typst-code'
              ? 'bg-gray-100 text-gray-900'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
          title="Typst Code"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        </button>
        
        {/* Project Files tab */}
        <button
          onClick={() => setActiveTab('files')}
          className={`p-1.5 rounded-lg transition-all ${
            activeTab === 'files'
              ? 'bg-gray-100 text-gray-900'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
          title="Project Files"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
        </button>

        {/* Roadmap tab */}
        <button
          onClick={() => setActiveTab('roadmap')}
          className={`p-1.5 rounded-lg transition-all ${
            activeTab === 'roadmap'
              ? 'bg-gray-100 text-gray-900'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
          title="Feature Roadmap"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </button>

        {/* Sync toggle (only relevant for Typst tabs) */}
        {(activeTab === 'typst-preview' || activeTab === 'typst-code') && (
          <button
            onClick={() => setAutoSync(!autoSync)}
            className={`ml-auto px-2 py-1 text-[9px] font-bold rounded-lg uppercase tracking-tight flex items-center gap-1 transition-all ${
              autoSync ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
            }`}
            title={autoSync ? 'Auto-sync on' : 'Auto-sync off'}
          >
            <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
            Sync
          </button>
        )}
      </div>

      {/* Tab content: Browser - Always show mini browser + task + logs */}
      {activeTab === 'browser' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <BrowserMiniPreview />
        </div>
      )}

      {/* Tab content: Typst Preview */}
      {activeTab === 'typst-preview' && (
        <div className="flex-1 overflow-hidden p-3">
          <TypstPreview rawContent={previewContent} className="h-full" />
        </div>
      )}

      {/* Tab content: Typst Code */}
      {activeTab === 'typst-code' && (
        <div className="flex-1 overflow-hidden p-3">
          <textarea
            value={previewContent}
            onChange={(e) => {
              setPreviewContent(e.target.value);
              setAutoSync(false);
            }}
            className="w-full h-full resize-none font-mono text-xs p-3 border border-gray-200 rounded-xl focus:outline-none focus:border-gray-400 bg-white"
            placeholder="Enter Typst source code..."
            spellCheck={false}
          />
        </div>
      )}

      {/* Tab content: Roadmap */}
      {activeTab === 'roadmap' && (
        <>
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Toolbar */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-200/60 bg-white/70 flex-shrink-0">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mr-auto">Roadmap</span>

              {/* Understand Project button */}
              {currentSession?.workDir && !showScanner && (
                <button
                  onClick={() => setShowScanner(true)}
                  disabled={isAnalyzingProject}
                  className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50 transition-colors"
                  title="Understand Project"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  Understand
                </button>
              )}

              {/* Zoom out */}
              <button
                onClick={() => setRoadmapZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)))}
                className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors"
                title="Zoom out"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                </svg>
              </button>

              {/* Zoom label (click to reset) */}
              <button
                onClick={() => setRoadmapZoom(1.0)}
                className="text-[9px] font-mono text-gray-500 w-8 text-center hover:text-gray-800 transition-colors"
                title="Reset zoom"
              >
                {Math.round(roadmapZoom * 100)}%
              </button>

              {/* Zoom in */}
              <button
                onClick={() => setRoadmapZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))}
                className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors"
                title="Zoom in"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>

              {/* Refresh */}
              <button
                onClick={loadRoadmap}
                disabled={roadmapLoading}
                className="p-1 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-40 transition-colors"
                title="Refresh"
              >
                <svg className={`w-3 h-3 ${roadmapLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>

              {/* Fullscreen */}
              <button
                onClick={() => {
                  setRoadmapFullscreen(true);
                  setRoadmapZoom(1.0);
                }}
                className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors"
                title="Fullscreen"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              </button>
            </div>

            {/* SVG content */}
            <div className="flex-1 overflow-auto">
              {/* Show scanner overlay when triggered */}
              {showScanner && currentSession?.workDir ? (
                <ProjectScannerOverlay
                  workDir={currentSession.workDir}
                  onComplete={async (fingerprint) => {
                    setShowScanner(false);
                    if (fingerprint) {
                      addNotification('success', `Analyzed ${fingerprint.name}: ${fingerprint.tech_stack.slice(0, 3).join(', ')}`);
                      
                      // Auto-generate roadmap content if it doesn't exist
                      const baseDir = currentSession.workDir;
                      const hasRoadmap = await invoke<boolean>('path_exists', { 
                        path: 'docs/tracker/roadmap.typ', 
                        workDir: baseDir 
                      });

                      if (!hasRoadmap) {
                        addNotification('info', "Generating smart roadmap...");
                        // For now, we'll use a basic logic to customize the template
                        // In the future, this will be a real LLM call to create custom milestones
                        let customTyp = DEFAULT_ROADMAP_TYP
                          .replace('Agent Project', fingerprint.name)
                          .replace('Setting up basic structure', `Initialized ${fingerprint.name} with ${fingerprint.tech_stack.join(', ')}`)
                          .replace('INITIALIZING...', `AI analyzed project - Found ${Object.keys(fingerprint.language_stats).length} languages`);
                          
                        await invoke('write_project_file', {
                          fileName: 'docs/tracker/roadmap.typ',
                          content: customTyp,
                          baseDir: baseDir
                        });
                      }

                      // Refresh roadmap after analysis
                      loadRoadmap();
                    }
                  }}
                />
              ) : !currentSession?.workDir ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 text-xs gap-4 p-8 text-center bg-gray-50/30">
                  <div className="p-4 bg-white rounded-full shadow-sm border border-gray-100">
                    <svg className="w-10 h-10 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                    </svg>
                  </div>
                  <div className="max-w-[200px] flex flex-col gap-1">
                    <span className="font-bold text-gray-500 uppercase tracking-widest text-[10px]">No Project Bound</span>
                    <span className="leading-relaxed opacity-70">Bind a folder in the message input area below to use the Feature Roadmap.</span>
                  </div>
                </div>
              ) : (
                <>
                  {roadmapLoading && (
                    <div className="flex items-center justify-center h-32 text-gray-400 text-xs gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Rendering...
                    </div>
                  )}
                  {roadmapError && !roadmapLoading && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-600">
                      <div className="font-bold mb-1">Failed to load roadmap</div>
                      <div className="font-mono text-[10px] whitespace-pre-wrap break-all">{roadmapError}</div>
                    </div>
                  )}
                  {!roadmapLoading && !roadmapError && roadmapSvg && (
                    <div style={{ width: `${Math.max(100, roadmapZoom * 100).toFixed(0)}%`, minWidth: '100%', transition: 'width 0.15s ease' }}>
                      <div dangerouslySetInnerHTML={{ __html: roadmapSvg }} />
                    </div>
                  )}
                  {!roadmapLoading && !roadmapError && !roadmapSvg && (
                    <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-xs gap-2">
                      <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      <span>Click ↻ to load roadmap</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Fullscreen overlay */}
          {roadmapFullscreen && (
            <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setRoadmapFullscreen(false)}>
              <div
                className="bg-white rounded-2xl shadow-2xl overflow-auto relative"
                style={{ width: '90vw', maxHeight: '90vh' }}
                onClick={e => e.stopPropagation()}
              >
                {/* Fullscreen toolbar */}
                <div className="sticky top-0 flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white z-10">
                  <span className="text-sm font-bold text-gray-700 mr-auto">Feature Roadmap</span>
                  <button onClick={() => setRoadmapZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)))} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" title="Zoom out">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
                  </button>
                  <button onClick={() => setRoadmapZoom(1.0)} className="text-xs font-mono text-gray-500 w-10 text-center hover:text-gray-800">{Math.round(roadmapZoom * 100)}%</button>
                  <button onClick={() => setRoadmapZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" title="Zoom in">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  </button>
                  <div className="w-px h-4 bg-gray-200 mx-1" />
                  <button onClick={() => setRoadmapFullscreen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" title="Close">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                {/* SVG in fullscreen */}
                <div className="p-6 overflow-auto">
                  <div
                    style={{ transform: `scale(${roadmapZoom})`, transformOrigin: 'top left', transition: 'transform 0.15s ease' }}
                    dangerouslySetInnerHTML={{ __html: roadmapSvg }}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Tab content: Files */}
      {activeTab === 'files' && (
        <ProjectFilesView 
          workDir={currentSession?.workDir || null} 
          onFileSelect={(path: string) => {
            // Optional: AI actions when clicking file
            console.log("Selected file:", path);
          }}
        />
      )}

      {/* Tab content: Main (original AgentPanel) */}
      {activeTab === 'main' && <>

      {/* Header / Mode Control */}
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">Execution Mode</span>
            <div className={`h-1.5 w-1.5 rounded-full ${permissionMode === 'bypass' ? 'bg-red-500 animate-pulse' :
              permissionMode === 'standard' ? 'bg-blue-500' :
                permissionMode === 'auto-edits' ? 'bg-indigo-500' :
                  'bg-green-500'
              }`} />
            {permissionMode === 'bypass' && (
              <span className="text-[9px] text-red-600 font-bold uppercase tracking-tight ml-auto">Bypass Active</span>
            )}
          </div>
        </div>

        <div className="flex p-1 bg-gray-200/50 rounded-xl">
          {[
            { id: 'standard', label: 'Ask' },
            { id: 'auto-edits', label: 'Auto' },
            { id: 'bypass', label: 'Bypass' },
            { id: 'plan-only', label: 'Plan' },
          ].map((mode) => (
            <button
              key={mode.id}
              onClick={() => handleModeChange(mode.id)}
              className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all uppercase ${permissionMode === mode.id
                ? 'bg-white shadow-sm text-gray-900'
                : 'text-gray-400 hover:text-gray-600'
                }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {showBypassConfirm && (
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl animate-in slide-in-from-top-2">
            <p className="text-[10px] text-red-700 font-bold mb-2 uppercase leading-snug">Caution: AI will execute commands without approval.</p>
            <div className="flex gap-2">
              <button onClick={confirmBypass} className="flex-1 py-1.5 bg-red-600 text-white text-[9px] font-bold rounded-lg uppercase">Confirm</button>
              <button onClick={() => setShowBypassConfirm(false)} className="flex-1 py-1.5 bg-white text-gray-600 text-[9px] font-bold rounded-lg border border-gray-200 uppercase">Cancel</button>
            </div>
          </div>
        )}

        {/* Permission Switch Warning - when there are pending tool calls */}
        {showPermissionWarning && (
          <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl animate-in slide-in-from-top-2">
            <div className="flex items-start gap-2 mb-2">
              <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="text-[10px] text-amber-800 font-bold uppercase leading-snug">Cannot switch permissions now</p>
                <p className="text-[9px] text-amber-700 mt-1 leading-relaxed">
                  {isStreaming && 'AI is still generating a response. '}
                  {pendingToolCalls > 0 && `There ${pendingToolCalls === 1 ? 'is' : 'are'} ${pendingToolCalls} pending tool call${pendingToolCalls === 1 ? '' : 's'} waiting for results.`}
                </p>
                <p className="text-[9px] text-amber-600 mt-1 leading-relaxed">
                  Switching permissions now may cause API errors with in-progress tool calls.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={confirmPermissionSwitch} className="flex-1 py-1.5 bg-amber-600 text-white text-[9px] font-bold rounded-lg uppercase">Switch Anyway</button>
              <button onClick={() => { setShowPermissionWarning(false); setPendingModeChange(null); }} className="flex-1 py-1.5 bg-white text-gray-600 text-[9px] font-bold rounded-lg border border-gray-200 uppercase">Wait</button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pb-6 scrollbar-hide hover:scrollbar-default transition-all">

        {/* Progress Section */}
        <Section
          title="Progress"
          count={totalSteps > 0 ? `${completedSteps} of ${totalSteps}` : undefined}
          defaultExpanded={totalSteps > 0}
        >
          {taskProgress.length > 0 ? (
            <div className="space-y-3 pt-2">
              {taskProgress.map((step, idx) => (
                <div key={step.id} className="flex gap-3 items-start relative group">
                  {idx < taskProgress.length - 1 && (
                    <div className="absolute left-[9px] top-5 bottom-0 w-[1px] bg-gray-100" />
                  )}
                  <div className={`mt-0.5 h-4.5 w-4.5 rounded-full flex items-center justify-center flex-shrink-0 z-10 transition-all ${step.status === 'done' ? 'bg-green-500 text-white' :
                    step.status === 'running' ? 'bg-blue-600 text-white shadow-[0_0_8px_rgba(37,99,235,0.3)]' :
                      step.status === 'failed' ? 'bg-red-500 text-white' :
                        'bg-white border-2 border-gray-100 text-gray-300'
                    }`}>
                    {step.status === 'done' ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <span className="text-[9px] font-bold">{idx + 1}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-[11px] font-medium leading-[1.4] transition-colors ${step.status === 'running' ? 'text-gray-900 font-bold' :
                      step.status === 'done' ? 'text-gray-500' : 'text-gray-400'
                      }`}>
                      {step.label}
                    </p>
                    {step.status === 'running' && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <div className="flex gap-0.5">
                          <div className="h-1 w-1 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="h-1 w-1 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="h-1 w-1 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                        <span className="text-[9px] text-blue-600 font-bold uppercase tracking-tight">Thinking</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 flex flex-col items-center justify-center opacity-25">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span className="text-[10px] font-bold uppercase tracking-widest">No Active Task</span>
            </div>
          )}
        </Section>

        {/* Working Folders Section */}
        <Section
          title="Working folders"
          count={allWorkingFiles.length > 0 ? allWorkingFiles.length.toString() : undefined}
        >
          <div className="pt-2 space-y-1">
            {allWorkingFiles.length > 0 ? (
              allWorkingFiles.map((file) => {
                // Check if file is from session or global
                const isSessionFile = sessionWorkingFiles.some(sf => sf.id === file.id);
                const handleRemove = () => {
                  if (isSessionFile && currentSessionId) {
                    removeSessionWorkingFile(currentSessionId, file.id);
                  } else {
                    removeImportedFile(file.id);
                  }
                };
                return (
                  <div key={file.id} className="group flex items-center gap-3 p-2 hover:bg-gray-100/50 rounded-xl transition-all">
                    <FileIcon filename={file.name} />
                    <span className="flex-1 text-[11px] text-gray-700 truncate font-medium" title={file.path}>
                      {file.name}
                    </span>
                    {isSessionFile ? (
                      <span className="text-[8px] text-blue-400 font-bold">session</span>
                    ) : (
                      <span className="text-[8px] text-orange-400 font-bold">global</span>
                    )}
                    <button
                      onClick={handleRemove}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 text-red-400 hover:text-red-500 rounded-lg transition-all"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="py-6 flex flex-col items-center justify-center opacity-25">
                <p className="text-[10px] font-bold uppercase tracking-tight text-center px-4 leading-normal">Drop files here to add to context</p>
              </div>
            )}
            {globalImportedFiles.length > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
                <span className="text-[9px] text-gray-400 font-medium">
                  {globalImportedFiles.length} global file{globalImportedFiles.length !== 1 ? 's' : ''} (all sessions)
                </span>
                <button
                  onClick={clearImportedFiles}
                  className="text-[9px] text-orange-500 hover:text-orange-700 font-bold uppercase tracking-tight hover:underline transition-colors"
                >
                  Clear global
                </button>
              </div>
            )}
          </div>
        </Section>

        {/* Context / Skills Section */}
        <Section title="Context">
          <div className="pt-2 space-y-4">
            <div>
              <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-2.5">Skills</h4>
              <div className="flex flex-wrap gap-2">
                {['read_file', 'write_file', 'bash', 'ripgrep', 'glob'].map(skill => (
                  <div key={skill} className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-[10px] font-bold text-gray-600 shadow-sm flex items-center gap-1.5 hover:border-blue-200 transition-colors cursor-default">
                    <div className="h-1 w-1 bg-blue-500 rounded-full" />
                    {skill}
                  </div>
                ))}
                <div className="px-2 py-1 bg-gray-50 border border-dashed border-gray-200 rounded-lg text-[10px] font-medium text-gray-400">
                  + 12 more
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-2.5">Connectors</h4>
              <div className="space-y-2">
                <button
                  onClick={() => {
                    if (cdpStatus !== 'connected') {
                      setShowCdpModal(true);
                    }
                  }}
                  className="w-full flex items-center justify-between p-2.5 bg-white border border-gray-200 rounded-xl shadow-sm hover:border-blue-200 transition-all group text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-blue-50 rounded-lg text-blue-600">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[11px] font-bold text-gray-800">
                        {cdpStatus === 'connected' ? 'Pipi Shrimp in Chrome' : 'Chrome Browser'}
                      </p>
                      <p className="text-[9px] text-gray-400 font-medium uppercase tracking-tight">
                        {cdpStatus === 'connected' && 'Active Connection'}
                        {cdpStatus === 'connecting' && 'Connecting...'}
                        {cdpStatus === 'disconnected' && 'Click to Connect'}
                        {cdpStatus === 'error' && 'Connection Failed — Retry'}
                      </p>
                    </div>
                  </div>
                  <div className={`h-1.5 w-1.5 rounded-full shadow-sm ${
                    cdpStatus === 'connected' ? 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]' :
                    cdpStatus === 'connecting' ? 'bg-yellow-400 animate-pulse' :
                    cdpStatus === 'error' ? 'bg-red-400' :
                    'bg-gray-300'
                  }`} />
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2.5">
                <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Agent Soul (Default)</h4>
                {localInstructions !== agentInstructions && (
                  <button onClick={handleSaveSoul} className="text-[9px] font-bold text-blue-600 uppercase tracking-tight hover:underline">
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                )}
              </div>
              <textarea
                value={localInstructions}
                onChange={(e) => setLocalInstructions(e.target.value)}
                className="w-full text-[11px] text-gray-600 leading-relaxed bg-gray-100/50 p-3 rounded-xl border border-transparent focus:border-blue-200 focus:bg-white focus:outline-none transition-all resize-none min-h-[80px]"
                placeholder="Agent identity and background..."
              />
            </div>
          </div>
        </Section>

      </div>

      </> /* end activeTab === 'main' */}

      {/* Footer / Status Area */}
      <div className="px-4 py-3 border-t border-gray-200/60 bg-white/50 flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase tracking-tighter cursor-default">
        <div className="flex items-center gap-2">
          <div className={`h-1.5 w-1.5 rounded-full ${taskProgress.some(s => s.status === 'running') ? 'bg-blue-500 animate-pulse' : 'bg-green-500'}`} />
          {taskProgress.some(s => s.status === 'running') ? 'Processing' : 'System Ready'}
        </div>
        <div className="opacity-60">v0.1.0-alpha</div>
      </div>

      {showCdpModal && (
        <CdpConnectorModal
          onClose={() => {
            setShowCdpModal(false);
          }}
        />
      )}
    </div>
  );
};

export default AgentPanel;
